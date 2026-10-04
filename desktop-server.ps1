$allowedOrigins = @(
  "https://matte0-sec.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "file://"
)

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:3210/")
$listener.Start()
Write-Host "Jarvis Desktop-Modus bereit auf http://127.0.0.1:3210"

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