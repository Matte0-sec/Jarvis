$allowedOrigins = @(
  "https://matte0-sec.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "file://"
)

Add-Type -AssemblyName System.Net.Http

$projectRoot = Split-Path -Parent $PSCommandPath
$knownPartsPath = Join-Path $projectRoot "parts\known-parts.json"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:51827/")
try {
  $listener.Start()
} catch {
  Write-Error "Der Jarvis-Dienst konnte auf http://127.0.0.1:51827 nicht starten: $($_.Exception.Message)"
  exit 1
}
Write-Host "Jarvis Desktop-Modus bereit auf http://127.0.0.1:51827"

function Send-JsonResponse($response, $statusCode, $payload) {
  try {
    $json = $payload | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
  } catch {
    try { $response.Abort() } catch {}
  }
}

function Get-LiveNews($topic) {
  $feeds = @{
    "world" = @{
      label = "Aktuelle Welt-News"
      url = "https://feeds.bbci.co.uk/news/world/rss.xml"
      source = "BBC News"
    }
    "elon-musk" = @{
      label = "Aktuelle News zu Elon Musk"
      url = "https://news.google.com/rss/search?q=Elon%20Musk%20when%3A7d&hl=de&gl=DE&ceid=DE:de"
      source = "Google News"
    }
  }

  if (-not $feeds.ContainsKey($topic)) { throw "Unbekanntes News-Thema" }
  $feed = $feeds[$topic]
  $rss = [xml](Invoke-WebRequest -UseBasicParsing -Uri $feed.url -TimeoutSec 15).Content
  $items = @($rss.rss.channel.item | Select-Object -First 3 | ForEach-Object {
      $headline = $_.title.InnerText
      $titleParts = $headline -split " - "
    [PSCustomObject]@{
      title = $titleParts[0].Trim()
      source = if ($titleParts.Count -gt 1) { $titleParts[-1].Trim() } else { $feed.source }
    }
  })

  if (-not $items.Count) { throw "Keine aktuellen News gefunden" }
  return @{ label = $feed.label; items = $items }
}

function Get-PlaceContext($query) {
  if ([string]::IsNullOrWhiteSpace($query) -or $query.Length -gt 100) { throw "Ungültiger Ortsname" }

  $encodedQuery = [Uri]::EscapeDataString($query)
  $headers = @{ "User-Agent" = "Jarvis-Local-Assistant/1.0" }
  $locations = Invoke-RestMethod -Uri "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=$encodedQuery" -Headers $headers -TimeoutSec 15
  $location = @($locations)[0]
  if (-not $location) { throw "Ort nicht gefunden" }

  $placeName = ($location.display_name -split ",")[0].Trim()
  $summary = ""
  try {
    $wikiTitle = [Uri]::EscapeDataString($placeName.Replace(" ", "_"))
    $wiki = Invoke-RestMethod -Uri "https://de.wikipedia.org/api/rest_v1/page/summary/$wikiTitle" -Headers $headers -TimeoutSec 15
    $summary = $wiki.extract
  } catch {}

  return @{
    name = $placeName
    displayName = $location.display_name
    latitude = $location.lat
    longitude = $location.lon
    summary = $summary
  }
}

function Get-Weather($query) {
  if ([string]::IsNullOrWhiteSpace($query) -or $query.Length -gt 100) { throw "Ungültiger Ortsname" }

  $encodedQuery = [Uri]::EscapeDataString($query)
  $headers = @{ "User-Agent" = "Jarvis-Local-Assistant/1.0" }
  $locations = Invoke-RestMethod -Uri "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=$encodedQuery" -Headers $headers -TimeoutSec 15
  $location = @($locations)[0]
  if (-not $location) { throw "Ort nicht gefunden" }

  $weatherUrl = "https://api.open-meteo.com/v1/forecast?latitude=$($location.lat)&longitude=$($location.lon)&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&wind_speed_unit=kmh&timezone=auto"
  $weather = Invoke-RestMethod -Uri $weatherUrl -TimeoutSec 15
  $weatherCodes = @{
    0 = "klar"
    1 = "überwiegend klar"
    2 = "teilweise bewölkt"
    3 = "bedeckt"
    45 = "neblig"
    48 = "Nebel mit Reif"
    51 = "leichter Nieselregen"
    53 = "mäßiger Nieselregen"
    55 = "starker Nieselregen"
    61 = "leichter Regen"
    63 = "mäßiger Regen"
    65 = "starker Regen"
    71 = "leichter Schneefall"
    73 = "mäßiger Schneefall"
    75 = "starker Schneefall"
    80 = "Regenschauer"
    81 = "mäßige Regenschauer"
    82 = "starke Regenschauer"
    95 = "Gewitter"
  }
  $current = $weather.current
  $placeName = ($location.display_name -split ",")[0].Trim()
  return @{
    place = $placeName
    temperature = $current.temperature_2m
    apparentTemperature = $current.apparent_temperature
    precipitation = $current.precipitation
    windSpeed = $current.wind_speed_10m
    condition = if ($weatherCodes.ContainsKey([int]$current.weather_code)) { $weatherCodes[[int]$current.weather_code] } else { "unbekannt" }
  }
}

function Get-KnownPartsContext {
  if (-not (Test-Path $knownPartsPath)) { return @{ text = "Keine eigene Teilebibliothek verfügbar."; images = @() } }

  $parts = Get-Content -Raw -Path $knownPartsPath | ConvertFrom-Json
  $descriptions = @()
  $images = @()
  foreach ($part in $parts) {
    if ([string]::IsNullOrWhiteSpace($part.name)) { continue }
    $details = @($part.details) -join ", "
    $descriptions += "- $($part.name): $($part.description) Merkmale: $details"

    $imagePath = Join-Path $projectRoot (Join-Path "parts" $part.image)
    if (Test-Path $imagePath) {
      $extension = [IO.Path]::GetExtension($imagePath).TrimStart(".").ToLowerInvariant()
      if ($extension -in @("jpg", "jpeg", "png", "webp")) {
        $mimeType = if ($extension -eq "jpg") { "jpeg" } else { $extension }
        $base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($imagePath))
        $images += @{ name = $part.name; data = "data:image/$mimeType;base64,$base64" }
      }
    }
  }
  return @{ text = ($descriptions -join "`n"); images = $images }
}

function Invoke-QwenCoder($prompt) {
  if ([string]::IsNullOrWhiteSpace($prompt) -or $prompt.Length -gt 12000) { throw "Ungültige Programmieranfrage" }

  $ollamaRequest = @{
    model = "qwen2.5-coder:1.5b"
    stream = $false
    messages = @(
      @{
        role = "system"
        content = "Du bist Qwen Coder in Jarvis. Hilf bei Programmierung, Debugging und technischen Erklärungen. Antworte auf Deutsch, präzise und praktisch. Wenn Code nötig ist, liefere ein kleines vollständiges Beispiel. Erfinde keine Testergebnisse oder APIs."
      },
      @{ role = "user"; content = $prompt }
    )
    options = @{ temperature = 0.2; num_predict = 700 }
  } | ConvertTo-Json -Depth 6

  $ollamaResponse = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/chat" -Method Post -ContentType "application/json; charset=utf-8" -Body $ollamaRequest -TimeoutSec 120
  if ([string]::IsNullOrWhiteSpace($ollamaResponse.message.content)) { throw "Qwen Coder hat keine Antwort geliefert" }
  return $ollamaResponse.message.content.Trim()
}

function Get-OmegaWebsiteStatus($repositoryName, $fallbackUrl) {
  $headers = @{ "User-Agent" = "Jarvis-Omega-Control" }
  $repository = Invoke-RestMethod -Uri "https://api.github.com/repos/Matte0-sec/$repositoryName" -Headers $headers -TimeoutSec 15
  $workflowRun = (Invoke-RestMethod -Uri "https://api.github.com/repos/Matte0-sec/$repositoryName/actions/runs?per_page=1" -Headers $headers -TimeoutSec 15).workflow_runs[0]
  return @{
    name = $repository.name
    repository = $repository.full_name
    websiteUrl = if ($repository.homepage) { $repository.homepage } else { $fallbackUrl }
    repositoryUrl = $repository.html_url
    deployment = if ($workflowRun.conclusion -eq "success") { "erfolgreich" } elseif ($workflowRun.status -eq "completed") { "fehlgeschlagen" } else { "läuft" }
    updatedAt = $workflowRun.updated_at
  }
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $origin = $request.Headers["Origin"]

    if ($origin -and $origin -notin $allowedOrigins) {
      Send-JsonResponse $response 403 @{ error = "Origin nicht erlaubt" }
      continue
    }

    if ($origin) {
      $response.Headers.Add("Access-Control-Allow-Origin", $origin)
      $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
      $response.Headers.Add("Access-Control-Allow-Private-Network", "true")
    }

    if ($request.HttpMethod -eq "OPTIONS") {
      $response.StatusCode = 204
      $response.Close()
      continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/desktop/status") {
      Send-JsonResponse $response 200 @{ ready = $true }
      continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/ai/status") {
      $apiKey = [Environment]::GetEnvironmentVariable("JARVIS_GROQ_API_KEY", "User")
      Send-JsonResponse $response 200 @{ ready = -not [string]::IsNullOrWhiteSpace($apiKey) }
      continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/vision/status") {
      $apiKey = [Environment]::GetEnvironmentVariable("JARVIS_OPENROUTER_API_KEY", "User")
      Send-JsonResponse $response 200 @{ ready = -not [string]::IsNullOrWhiteSpace($apiKey) }
      continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/code/status") {
      try {
        $models = (Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5).models
        $ready = @($models | Where-Object { $_.name -eq "qwen2.5-coder:1.5b" }).Count -gt 0
        Send-JsonResponse $response 200 @{ ready = $ready }
      } catch {
        Send-JsonResponse $response 200 @{ ready = $false }
      }
      continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/websites/status") {
      try {
        Send-JsonResponse $response 200 @{ websites = @(
          Get-OmegaWebsiteStatus "Jarvis" "https://matte0-sec.github.io/Jarvis/"
          Get-OmegaWebsiteStatus "Naturwissenschaften" "https://matte0-sec.github.io/Naturwissenschaften/"
        ) }
      } catch {
        Send-JsonResponse $response 502 @{ error = "Website-Status konnte nicht abgerufen werden" }
      }
      continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/news") {
      try {
        Send-JsonResponse $response 200 (Get-LiveNews $request.QueryString["topic"])
      } catch {
        Send-JsonResponse $response 502 @{ error = "Live-News konnten nicht abgerufen werden" }
      }
      continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/places") {
      try {
        Send-JsonResponse $response 200 (Get-PlaceContext $request.QueryString["query"])
      } catch {
        Send-JsonResponse $response 404 @{ error = "Ort konnte nicht gefunden werden" }
      }
      continue
    }

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/weather") {
      try {
        Send-JsonResponse $response 200 (Get-Weather $request.QueryString["city"])
      } catch {
        Send-JsonResponse $response 404 @{ error = "Wetterdaten für diesen Ort konnten nicht abgerufen werden" }
      }
      continue
    }

    if ($request.HttpMethod -eq "POST" -and $request.Url.AbsolutePath -eq "/ai/chat") {
      $apiKey = [Environment]::GetEnvironmentVariable("JARVIS_GROQ_API_KEY", "User")
      if ([string]::IsNullOrWhiteSpace($apiKey)) {
        Send-JsonResponse $response 503 @{ error = "Groq-API-Schlüssel fehlt" }
        continue
      }

      try {
        $body = [System.IO.StreamReader]::new($request.InputStream).ReadToEnd() | ConvertFrom-Json
        $groqRequest = @{
          model = "openai/gpt-oss-20b"
          messages = $body.messages
          temperature = 0.5
          max_tokens = 400
        } | ConvertTo-Json -Depth 6
        $httpClient = [System.Net.Http.HttpClient]::new()
        try {
          $groqHttpRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "https://api.groq.com/openai/v1/chat/completions")
          $groqHttpRequest.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $apiKey)
          $groqHttpRequest.Content = [System.Net.Http.StringContent]::new($groqRequest, [System.Text.Encoding]::UTF8, "application/json")
          $groqHttpResponse = $httpClient.SendAsync($groqHttpRequest).GetAwaiter().GetResult()
          $groqResponse = $groqHttpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        } finally {
          $httpClient.Dispose()
        }
        Send-JsonResponse $response 200 @{ content = $groqResponse.choices[0].message.content }
      } catch {
        Send-JsonResponse $response 502 @{ error = "Groq-Anfrage fehlgeschlagen" }
      }
      continue
    }

    if ($request.HttpMethod -eq "POST" -and $request.Url.AbsolutePath -eq "/code/chat") {
      try {
        $body = [System.IO.StreamReader]::new($request.InputStream).ReadToEnd() | ConvertFrom-Json
        Send-JsonResponse $response 200 @{ content = Invoke-QwenCoder $body.prompt }
      } catch {
        $message = if ($_.Exception.Message -match "connection|connect|refused") {
          "Ollama läuft nicht. Starten Sie Ollama und versuchen Sie es erneut."
        } elseif ($_.Exception.Message -match "model|not found") {
          "Qwen Coder ist noch nicht installiert."
        } else {
          "Qwen Coder konnte die Anfrage nicht bearbeiten: $($_.Exception.Message)"
        }
        Send-JsonResponse $response 503 @{ error = $message }
      }
      continue
    }

    if ($request.HttpMethod -eq "POST" -and $request.Url.AbsolutePath -eq "/vision/analyze") {
      $apiKey = [Environment]::GetEnvironmentVariable("JARVIS_OPENROUTER_API_KEY", "User")
      if ([string]::IsNullOrWhiteSpace($apiKey)) {
        Send-JsonResponse $response 503 @{ error = "OpenRouter-API-Schlüssel fehlt" }
        continue
      }

      try {
        $body = [System.IO.StreamReader]::new($request.InputStream).ReadToEnd() | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace($body.image) -or $body.image.Length -gt 4000000 -or $body.image -notmatch '^data:image/jpeg;base64,') {
          throw "Ungültiges Kamerabild"
        }

        $knownParts = Get-KnownPartsContext
        $visionContent = @(
          @{ type = "text"; text = "Was ist auf diesem Kamerabild zu sehen? Vergleiche es mit den bekannten Referenzteilen. Nenne einen Eintrag aus der Bibliothek nur, wenn Bild und sichtbare Merkmale plausibel übereinstimmen.`n`nBekannte Teile:`n$($knownParts.text)" },
          @{ type = "image_url"; image_url = @{ url = $body.image } }
        )
        foreach ($reference in $knownParts.images) {
          $visionContent += @{ type = "text"; text = "Referenzbild für: $($reference.name)" }
          $visionContent += @{ type = "image_url"; image_url = @{ url = $reference.data } }
        }

        $visionRequest = @{
          model = "google/gemma-4-26b-a4b-it:free"
          messages = @(
            @{
              role = "system"
              content = "Du bist Jarvis. Analysiere das Kamerabild auf Deutsch. Beschreibe ausschließlich technische Geräte, Platinen, Anschlüsse und Komponenten. Analysiere, beschreibe oder identifiziere niemals Personen. Nenne ein konkretes Modell nur bei klaren sichtbaren Hinweisen. Beschreibe Unsicherheit ehrlich und antworte in höchstens vier kurzen Sätzen."
            },
            @{
              role = "user"
              content = $visionContent
            }
          )
          max_tokens = 300
        } | ConvertTo-Json -Depth 8

        $httpClient = [System.Net.Http.HttpClient]::new()
        try {
          $visionHttpRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "https://openrouter.ai/api/v1/chat/completions")
          $visionHttpRequest.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $apiKey)
          $visionHttpRequest.Headers.Add("HTTP-Referer", "https://matte0-sec.github.io/Jarvis/")
          $visionHttpRequest.Headers.Add("X-Title", "Jarvis")
          $visionHttpRequest.Content = [System.Net.Http.StringContent]::new($visionRequest, [System.Text.Encoding]::UTF8, "application/json")
          $visionHttpResponse = $httpClient.SendAsync($visionHttpRequest).GetAwaiter().GetResult()
          if (-not $visionHttpResponse.IsSuccessStatusCode) {
            $statusCode = [int]$visionHttpResponse.StatusCode
            if ($statusCode -eq 429) { throw "Die kostenlose Bild-KI ist gerade ausgelastet. Bitte später erneut versuchen oder OpenRouter-Guthaben verwenden." }
            throw "OpenRouter antwortet mit $statusCode"
          }
          $visionResponse = $visionHttpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        } finally {
          $httpClient.Dispose()
        }

        $content = $visionResponse.choices[0].message.content
        if ([string]::IsNullOrWhiteSpace($content)) { throw "Leere Bildanalyse" }
        Send-JsonResponse $response 200 @{ content = $content.Trim() }
      } catch {
        Send-JsonResponse $response 502 @{ error = $_.Exception.Message }
      }
      continue
    }

    if ($request.HttpMethod -ne "POST" -or $request.Url.AbsolutePath -ne "/desktop/action") {
      Send-JsonResponse $response 404 @{ error = "Unbekannter Endpunkt" }
      continue
    }

    $body = [System.IO.StreamReader]::new($request.InputStream).ReadToEnd() | ConvertFrom-Json
    switch ($body.action) {
      "calculator" { Start-Process "calc.exe" }
      "editor" { Start-Process "notepad.exe" }
      "files" { Start-Process "explorer.exe" $env:USERPROFILE }
      "settings" { Start-Process "ms-settings:" }
      "vscode" {
        if (-not (Get-Command "code" -ErrorAction SilentlyContinue)) {
          Send-JsonResponse $response 400 @{ error = "Visual Studio Code ist nicht installiert" }
          continue
        }
        Start-Process "code"
      }
      "teams" { Start-Process "msteams:" }
      "whatsapp" { Start-Process "whatsapp:" }
      "website" {
        try {
          $website = [Uri]$body.target
          if ($website.Scheme -notin @("http", "https")) { throw "Nicht erlaubtes Protokoll" }
          Start-Process $website.AbsoluteUri
        } catch {
          Send-JsonResponse $response 400 @{ error = "Ungültige Webadresse" }
          continue
        }
      }
      default {
        Send-JsonResponse $response 400 @{ error = "Aktion nicht erlaubt" }
        continue
      }
    }
    Send-JsonResponse $response 200 @{ success = $true; action = $body.action }
  }
} finally {
  $listener.Close()
}