# FLOW - system media bridge
# (kept pure ASCII: Windows PowerShell 5.1 reads a BOM-less script as ANSI)
# Reads the Windows media sessions (what Spotify, browsers and other players report to
# the volume flyout) and prints one JSON line whenever the one worth showing changes:
#   {"t":"state", app,title,artist,album,status,pos,dur,at,prev,next,seek,key}  or  {"t":"state","none":true}
#   {"t":"art", key, url}   artwork as a data: URL, re-read for a few polls after a track change
#   {"t":"err", msg}        then exits with code 2: this Windows can't do it
# Takes commands on stdin, one per line: toggle | play | pause | next | prev | seek <seconds>
# main.js starts it with Windows PowerShell 5.1 (it has the WinRT bridge PowerShell 7 lacks);
# it exits when stdin closes, so it never outlives FLOW.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$own = $env:FLOW_AUMID   # FLOW's own session (its library player) is never shown

function Send($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $MgrT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $PropsT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $StreamT = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
  # the awaited artwork stream arrives as a bare COM object PowerShell can't call into,
  # so convert it to a .NET stream through reflection (which casts it for us)
  $toStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@(
    [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]))
} catch { Send ([ordered]@{ t = 'err'; msg = "$_" }); exit 2 }

# WinRT async -> result, with a timeout so a hung player can't stall the bridge
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'timed out' }
  $task.Result
}

try { $mgr = Await ($MgrT::RequestAsync()) $MgrT }
catch { Send ([ordered]@{ t = 'err'; msg = "$_" }); exit 2 }

$lastApp = ''; $last = ''
$artKey = ''; $artLeft = 0; $artSent = ''

function Sessions { @($mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -ne $own }) }
function Find($list, $id) { if ($id) { $list | Where-Object { $_.SourceAppUserModelId -eq $id } | Select-Object -First 1 } }

# the session to show: Windows' current one if it's playing, else the one we showed if it's
# still playing, else anything playing; with nothing playing, stay on the last one shown
function Pick {
  $all = Sessions
  if (-not $all.Count) { return $null }
  $cur = $mgr.GetCurrentSession()
  $curId = if ($cur) { $cur.SourceAppUserModelId } else { '' }
  $playing = @($all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' })
  foreach ($id in @($curId, $script:lastApp)) { $m = Find $playing $id; if ($m) { return $m } }
  if ($playing.Count) { return $playing[0] }
  foreach ($id in @($script:lastApp, $curId)) { $m = Find $all $id; if ($m) { return $m } }
  $all[0]
}

# players often swap the artwork a moment after the title, so read it on a few polls
function Art($props, $key) {
  if ($key -ne $script:artKey) { $script:artKey = $key; $script:artLeft = 4; $script:artSent = '' }
  if ($script:artLeft -le 0) { return }
  $script:artLeft--
  if (-not $props.Thumbnail) { return }
  $rs = Await ($props.Thumbnail.OpenReadAsync()) $StreamT
  $ns = $toStream.Invoke($null, @($rs))
  $ms = New-Object System.IO.MemoryStream
  try { $ns.CopyTo($ms) } finally { $ns.Dispose() }
  $b = $ms.ToArray()
  if ($b.Length -lt 4) { return }
  $type = if ($b[0] -eq 0xFF -and $b[1] -eq 0xD8) { 'image/jpeg' } elseif ($b[0] -eq 0x52 -and $b[1] -eq 0x49) { 'image/webp' } else { 'image/png' }
  $url = "data:$type;base64," + [Convert]::ToBase64String($b)
  if ($url -ne $script:artSent) { $script:artSent = $url; Send ([ordered]@{ t = 'art'; key = $key; url = $url }) }
}

function Emit($o) {
  $json = $o | ConvertTo-Json -Compress
  if ($json -ne $script:last) { $script:last = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
}

function Poll {
  $s = Pick
  if (-not $s) { Emit ([ordered]@{ t = 'state'; none = $true }); return }
  $script:lastApp = $s.SourceAppUserModelId
  $p = Await ($s.TryGetMediaPropertiesAsync()) $PropsT
  $pi = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties(); $c = $pi.Controls
  $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
  Emit ([ordered]@{
    t = 'state'; app = $s.SourceAppUserModelId
    title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
    status = [string]$pi.PlaybackStatus
    pos = [math]::Round(($tl.Position - $tl.StartTime).TotalSeconds, 2)
    dur = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 2)
    at = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
    prev = $c.IsPreviousEnabled; next = $c.IsNextEnabled; seek = $c.IsPlaybackPositionEnabled
    key = $key
  })
  Art $p $key
}

function Command($line) {
  $verb, $arg = $line.Trim() -split '\s+', 2
  $s = Find (Sessions) $script:lastApp
  if (-not $s) { return }
  $op = switch ($verb) {
    'toggle' { $s.TryTogglePlayPauseAsync() }
    'play'   { $s.TryPlayAsync() }
    'pause'  { $s.TryPauseAsync() }
    'next'   { $s.TrySkipNextAsync() }
    'prev'   { $s.TrySkipPreviousAsync() }
    'seek'   { $s.TryChangePlaybackPositionAsync([long]([double]$arg * 10000000)) }
  }
  if ($op) { $null = Await $op ([bool]) }
  $script:last = ''   # report the result even if nothing changed, so FLOW's guess gets corrected
}

$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput())
$read = $stdin.ReadLineAsync()
while ($true) {
  try { $got = $read.Wait(600) } catch { break }
  if ($got) {
    $line = $read.Result
    if ($null -eq $line) { break }   # FLOW closed our stdin: it quit
    try { Command $line } catch { Send ([ordered]@{ t = 'warn'; msg = "$_" }) }
    $read = $stdin.ReadLineAsync()
    Start-Sleep -Milliseconds 150    # give the player a moment to act before looking again
  }
  try { Poll } catch { Send ([ordered]@{ t = 'warn'; msg = "$_" }) }
}
