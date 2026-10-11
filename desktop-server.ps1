$allowedOrigins = @(
  "https://matte0-sec.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "file://"
)

Add-Type -AssemblyName System.Net.Http

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