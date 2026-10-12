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

    if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/news") {
      try {
        Send-JsonResponse $response 200 (Get-LiveNews $request.QueryString["topic"])
      } catch {
        Send-JsonResponse $response 502 @{ error = "Live-News konnten nicht abgerufen werden" }
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
          if (-not $visionHttpResponse.IsSuccessStatusCode) { throw "OpenRouter antwortet mit $([int]$visionHttpResponse.StatusCode)" }
          $visionResponse = $visionHttpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        } finally {
          $httpClient.Dispose()
        }

        $content = $visionResponse.choices[0].message.content
        if ([string]::IsNullOrWhiteSpace($content)) { throw "Leere Bildanalyse" }
        Send-JsonResponse $response 200 @{ content = $content.Trim() }
      } catch {
        Send-JsonResponse $response 502 @{ error = "Bildanalyse fehlgeschlagen" }
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