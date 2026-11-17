# D-07 recovery drill: the three crash and interruption scenarios, run for real on a test machine.
#
#   powershell -ExecutionPolicy Bypass -File d07-recovery.ps1
#   powershell -ExecutionPolicy Bypass -File d07-recovery.ps1 -Only answer,writer
#   powershell -ExecutionPolicy Bypass -File d07-recovery.ps1 -Only download -Entry minicpm5-2b-q4_k_m-openbmb-gguf
#
# Before: AIOS installed, first run done, a model installed, and the app CLOSED. The drill starts
# the installed backend.exe itself, the way the app does (token over stdin, nothing in argv or the
# environment), so it can hard-kill it. It works on this user's real AIOS data: it adds a project
# named "D-07 drill" and deletes it at the end. Use a test machine or the test VM, not a work PC.
#
#   answer    kill mid-answer: the question and the answer so far (status partial) survive, the
#             store opens, the evidence chain has no gap. Run twice: streamed, and the plain
#             request the app sends.
#   writer    kill the backend and restart it at once: exactly one evidence writer afterwards,
#             and the chain goes on with no gap.
#   download  cut the network mid-download: the download waits instead of failing, and goes on
#             from where it was once the network is back. The partial file is deleted at the end
#             unless -KeepDownload.
#
# Cutting the network: by default the drill asks you to do it and waits for Enter. On the test VM,
# from the host: sudo virsh domif-setlink win11 <interface> down / up
# (virsh domiflist win11 shows the interface). Or pass -NetOff / -NetOn commands to run here.
#
# Prints PASS/FAIL per check and exits 1 if any check failed. Logs nothing the backend does not.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\AIOS"),
  [ValidateSet("answer", "writer", "download")][string[]]$Only = @("answer", "writer", "download"),
  [int]$KillAfterSeconds = 8,
  [string]$Entry = "",
  [string]$NetOff = "",
  [string]$NetOn = "",
  [int]$OfflineSeconds = 45,
  [switch]$KeepDownload
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

$Exe = Join-Path $InstallDir "resources\backend\backend.exe"
$Prompt = "Write a long, detailed essay of at least 800 words about how rivers shape the land. " +
          "Use several paragraphs."
$script:Failed = 0
$script:Started = [DateTime]::UtcNow

# ------------------------------------------------------------------ helpers
function Check([string]$Name, [bool]$Ok, [string]$Detail = "") {
  $word = if ($Ok) { "PASS" } else { "FAIL" }
  if (-not $Ok) { $script:Failed++ }
  Write-Host ("{0}  {1}  {2}" -f $word, $Name, $Detail)
}

function New-Token {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$script:Live = New-Object System.Collections.Generic.List[object]

function Start-Backend {
  $token = New-Token
  $psi = New-Object Diagnostics.ProcessStartInfo $Exe
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.CreateNoWindow = $true
  # Same environment as the app: only what Windows and the data folder need.
  $psi.EnvironmentVariables.Clear()
  $psi.EnvironmentVariables["SystemRoot"] = $env:SystemRoot
  $psi.EnvironmentVariables["LOCALAPPDATA"] = $env:LOCALAPPDATA
  $proc = [Diagnostics.Process]::Start($psi)
  $proc.StandardInput.Write('{"token":"' + $token + '","api_port":0}' + "`n")
  $proc.StandardInput.Close()
  $read = $proc.StandardOutput.ReadLineAsync()
  if (-not $read.Wait(120000)) { $proc.Kill(); throw "backend.exe sent no READY line in 120 s" }
  $line = $read.Result
  if (-not $line -or -not $line.StartsWith("READY ")) {
    throw "backend.exe did not start (exit code $(if ($proc.HasExited) { $proc.ExitCode }))"
  }
  $port = ($line.Substring(6) | ConvertFrom-Json).api_port
  $http = New-Object Net.Http.HttpClient
  $http.BaseAddress = [Uri]"http://127.0.0.1:$port"
  $http.Timeout = [TimeSpan]::FromMinutes(15)
  $http.DefaultRequestHeaders.Authorization =
    New-Object Net.Http.Headers.AuthenticationHeaderValue("Bearer", $token)
  $backend = [pscustomobject]@{ Process = $proc; Http = $http }
  $script:Live.Add($proc)
  Wait-Healthy $backend
  $backend
}

function Stop-Backend($Backend) {
  # A hard kill (TerminateProcess). The Job Object ends the engine and the writer with it.
  if (-not $Backend.Process.HasExited) { $Backend.Process.Kill() }
  $Backend.Process.WaitForExit(30000) | Out-Null
  $Backend.Http.Dispose()
}

function Request($Backend, [string]$Method, [string]$Path, $Body = $null) {
  $req = New-Object Net.Http.HttpRequestMessage((New-Object Net.Http.HttpMethod $Method), $Path)
  if ($null -ne $Body) {
    $json = ConvertTo-Json $Body -Compress -Depth 6
    $req.Content = New-Object Net.Http.StringContent($json, [Text.Encoding]::UTF8, "application/json")
  }
  $req
}

function Api($Backend, [string]$Method, [string]$Path, $Body = $null) {
  $resp = $Backend.Http.SendAsync((Request $Backend $Method $Path $Body)).GetAwaiter().GetResult()
  $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $parsed = $null
  if ($text) { $parsed = $text | ConvertFrom-Json }
  [pscustomobject]@{ Status = [int]$resp.StatusCode; Body = $parsed }
}

function Wait-Healthy($Backend) {
  $deadline = (Get-Date).AddSeconds(60)
  do {
    $h = (Api $Backend GET "/health").Body
    if ($h.database -eq "ok" -and $h.evidence_writer -eq "ok") { return }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
}

function Writers { @(Get-Process -Name "evidence-writer" -ErrorAction SilentlyContinue) }

function Check-Store($Backend, [string]$Name) {
  $h = (Api $Backend GET "/health").Body
  Check "${Name}: the store opens after the restart" ($h.database -eq "ok") "database=$($h.database)"
  Check "${Name}: one evidence writer" ((Writers).Count -eq 1) "$((Writers).Count) running"
}

# Every event from this drill is chained: each one's prev_hash is the event_hash before it, with
# no missing sequence number. Waits for the outbox to empty first.
function Check-Chain($Backend, [string]$Name) {
  $deadline = (Get-Date).AddSeconds(60)
  do {
    $s = (Api $Backend GET "/evidence/status").Body
    if ($s.writer -eq "ok" -and $s.pending -eq 0) { break }
    Start-Sleep 1
  } while ((Get-Date) -lt $deadline)
  Check "${Name}: evidence writer ok, nothing pending" ($s.writer -eq "ok" -and $s.pending -eq 0) `
    "writer=$($s.writer) pending=$($s.pending)"
  $from = [Uri]::EscapeDataString($script:Started.ToString("yyyy-MM-ddTHH:mm:ssZ"))
  $seqs = @((Api $Backend GET "/evidence?from=$from").Body | Where-Object { $null -ne $_.seq } |
    ForEach-Object { [int]$_.seq } | Sort-Object)
  if ($seqs.Count -eq 0) { Check "${Name}: events chained" $false "no events since the drill began"; return }
  $first = [Math]::Max(0, $seqs[0] - 1)
  $last = $seqs[-1]
  $prev = $null
  $broken = @()
  foreach ($seq in $first..$last) {
    $r = Api $Backend GET "/evidence/$seq"
    if ($r.Status -ne 200 -or $r.Body.seq -ne $seq) { $broken += "missing $seq"; $prev = $null; continue }
    if ($null -ne $prev -and $r.Body.prev_hash -ne $prev) { $broken += "link $seq" }
    $prev = $r.Body.event_hash
  }
  Check "${Name}: events $first to $last chained, no gap" ($broken.Count -eq 0) ($broken -join ", ")
}

# ------------------------------------------------------------------ scenarios
function Answer-Streamed($Backend, [string]$ConversationId) {
  # Read the answer as it streams; kill the backend once it has streamed for a while.
  $req = Request $Backend POST "/conversations/$ConversationId/messages/stream" @{ text = $Prompt }
  $headersOnly = [Net.Http.HttpCompletionOption]::ResponseHeadersRead
  $resp = $Backend.Http.SendAsync($req, $headersOnly).GetAwaiter().GetResult()
  $reader = New-Object IO.StreamReader($resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
  $received = New-Object Text.StringBuilder
  $kind = ""
  $firstWord = $null
  while ($null -ne ($line = $reader.ReadLine())) {
    if ($line.StartsWith("event: ")) { $kind = $line.Substring(7); continue }
    if (-not $line.StartsWith("data: ")) { continue }
    if ($kind -eq "delta") {
      [void]$received.Append(($line.Substring(6) | ConvertFrom-Json).text)
      if ($null -eq $firstWord) { $firstWord = Get-Date }
    }
    if ($kind -eq "done" -or $kind -eq "error") { break }
    if ($null -ne $firstWord -and ((Get-Date) - $firstWord).TotalSeconds -ge $KillAfterSeconds) {
      Stop-Backend $Backend
      return $received.ToString()
    }
  }
  throw "the answer ended ($kind) before the kill; raise the prompt length or lower -KillAfterSeconds"
}

function Answer-Plain($Backend, [string]$ConversationId) {
  # The request the app sends: nothing comes back until the answer is done, so watch the live
  # text the app shows (GET .../generation) and kill once words have come for a while.
  $req = Request $Backend POST "/conversations/$ConversationId/messages" @{ text = $Prompt }
  $pending = $Backend.Http.SendAsync($req)
  $firstWord = $null
  $text = ""
  $deadline = (Get-Date).AddMinutes(5)
  while (-not $pending.IsCompleted -and (Get-Date) -lt $deadline) {
    $g = (Api $Backend GET "/conversations/$ConversationId/generation").Body
    if ($g.text) { $text = $g.text; if ($null -eq $firstWord) { $firstWord = Get-Date } }
    if ($null -ne $firstWord -and ((Get-Date) - $firstWord).TotalSeconds -ge $KillAfterSeconds) {
      Stop-Backend $Backend
      return $text
    }
    Start-Sleep -Milliseconds 250
  }
  throw "the answer ended (or never started) before the kill; raise the prompt length or lower -KillAfterSeconds"
}

function Drill-Answer([string]$How) {
  $name = "answer ($How)"
  $b = Start-Backend
  $project = (Api $b POST "/projects" @{ name = "D-07 drill"; classification = "internal" }).Body
  $conv = (Api $b POST "/projects/$($project.id)/conversations" @{}).Body
  $received = if ($How -eq "streamed") { Answer-Streamed $b $conv.id } else { Answer-Plain $b $conv.id }
  Write-Host "       killed backend.exe mid-answer; $((Writers).Count) writer(s) left running"

  $b = Start-Backend
  Check-Store $b $name
  $messages = @((Api $b GET "/conversations/$($conv.id)/messages").Body)
  $question = $messages | Where-Object { $_.role -eq "user" } | Select-Object -Last 1
  $answer = $messages | Select-Object -Last 1
  Check "${name}: the question is kept" ($null -ne $question -and $question.content -eq $Prompt)
  Check "${name}: the answer is kept as partial" ($answer.role -eq "assistant" -and $answer.status -eq "partial") `
    "status=$($answer.status)"
  Check "${name}: the answer so far has text" ($answer.content.Length -gt 0) "$($answer.content.Length) characters"
  # Streamed: everything saved was sent first. Plain: the last look at the live text may be a
  # little behind or ahead of the last save; either way one starts the other.
  $consistent = $received.StartsWith($answer.content) -or
    ($How -ne "streamed" -and $answer.content.StartsWith($received))
  Check "${name}: the saved text is the answer up to the last save" ($consistent -and $answer.content) `
    "$($answer.content.Length) characters saved, $($received.Length) seen before the kill"
  Check-Chain $b $name
  Api $b DELETE "/projects/$($project.id)" | Out-Null
  Stop-Backend $b
}

function Drill-Writer {
  $name = "writer"
  $b = Start-Backend
  $before = @(Writers | ForEach-Object { $_.Id })
  Stop-Backend $b
  $left = (Writers).Count
  $b = Start-Backend  # at once: the old writer may still be on its way out
  Write-Host "       killed backend.exe; $left writer(s) still running at the restart"
  $now = @(Writers | ForEach-Object { $_.Id })
  Check "${name}: the old writer is gone" (@($now | Where-Object { $before -contains $_ }).Count -eq 0)
  Check-Store $b $name
  # A new event after the restart must chain onto the ones before it.
  $project = (Api $b POST "/projects" @{ name = "D-07 drill"; classification = "internal" }).Body
  Api $b DELETE "/projects/$($project.id)" | Out-Null
  Check-Chain $b $name
  Stop-Backend $b
}

function Set-Network([string]$State, [string]$Command) {
  if ($Command) { Invoke-Expression $Command; return }
  Read-Host "       Turn the network $State now, then press Enter" | Out-Null
}

function Download-State($Backend, [string]$Id) { (Api $Backend GET "/models/downloads/$Id").Body }

function Drill-Download {
  $name = "download"
  $b = Start-Backend
  $id = $Entry
  if (-not $id) {
    $installed = @((Api $b GET "/models").Body | ForEach-Object { $_.id })
    $choice = @((Api $b GET "/models/catalogue").Body.entries) |
      Where-Object { $installed -notcontains $_.entry_id } | Sort-Object size_bytes | Select-Object -First 1
    if ($null -eq $choice) { throw "every catalogue model is installed; pass -Entry with one to download" }
    $id = $choice.entry_id
  }
  $start = Api $b POST "/models/downloads" @{ entry_id = $id }
  Check "${name}: $id started" ($start.Status -eq 202) "HTTP $($start.Status)"

  $deadline = (Get-Date).AddMinutes(5)
  do { Start-Sleep 2; $s = Download-State $b $id } while ($s.received_bytes -lt 50MB -and (Get-Date) -lt $deadline)
  Set-Network "OFF" $NetOff
  $cut = (Download-State $b $id).received_bytes
  Write-Host "       network off at $([Math]::Round($cut / 1MB)) MB; waiting $OfflineSeconds s"
  Start-Sleep $OfflineSeconds
  $s = Download-State $b $id
  Check "${name}: still waiting, not failed, while offline" ($s.status -eq "downloading") `
    "status=$($s.status) error=$($s.error)"

  Set-Network "ON" $NetOn
  $deadline = (Get-Date).AddMinutes(3)
  do { Start-Sleep 2; $s = Download-State $b $id } while ($s.received_bytes -le $cut + 1MB -and (Get-Date) -lt $deadline)
  Check "${name}: goes on from where it was" ($s.received_bytes -gt $cut + 1MB -and $s.status -ne "failed") `
    "$([Math]::Round($s.received_bytes / 1MB)) MB, status=$($s.status)"
  if (-not $KeepDownload) { Api $b DELETE "/models/downloads/$id" | Out-Null }
  Stop-Backend $b
}

# ------------------------------------------------------------------ run
if (-not (Test-Path $Exe)) { throw "no backend.exe at $Exe (pass -InstallDir)" }
if (Get-Process -Name "AIOS", "backend", "evidence-writer" -ErrorAction SilentlyContinue) {
  throw "AIOS is running; close the app first"
}
try {
  if ($Only -contains "answer") { Drill-Answer "streamed"; Drill-Answer "as the app sends it" }
  if ($Only -contains "writer") { Drill-Writer }
  if ($Only -contains "download") { Drill-Download }
} finally {
  foreach ($p in $script:Live) { if (-not $p.HasExited) { $p.Kill() } }
}

if ($script:Failed -gt 0) { Write-Host "$($script:Failed) check(s) failed"; exit 1 }
Write-Host "all checks passed"
