$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'platform-overview'
$audio = Join-Path $root 'audio'
$clips = Join-Path $root 'clips'
$frames = Join-Path $root 'frames'
$ffmpeg = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools\ffmpeg-8.1.2\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe'
$narration = Get-Content -LiteralPath (Join-Path $root 'ATEC-Platform-Overview-Narration.txt') -Raw
$parts = $narration -split "\r?\n\r?\n"

$python = 'C:\Users\JacquesJonker\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:PYTHONPATH = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools\edge-tts'

$concatLines = @()
for ($i = 0; $i -lt $parts.Count; $i++) {
  $number = '{0:D2}' -f ($i + 1)
  $text = $parts[$i] -replace '^\d+\.\s*',''
  $wav = Join-Path $audio "scene-$number.mp3"
  $clip = Join-Path $clips "scene-$number.mp4"
  $frame = Join-Path $frames "scene-$number.png"
  & $python -m edge_tts --voice en-US-AndrewMultilingualNeural --rate=-8% --pitch=-2Hz --text $text --write-media $wav
  $durationText = & $ffmpeg.Replace('ffmpeg.exe','ffprobe.exe') -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $wav
  $duration = [double]::Parse($durationText.Trim(), [Globalization.CultureInfo]::InvariantCulture) + 0.8
  & $ffmpeg -y -loop 1 -i $frame -i $wav -filter_complex "[0:v]fade=t=in:st=0:d=0.35,fade=t=out:st=$($duration-0.35):d=0.35[v];[1:a]apad=pad_dur=0.8[a]" -map '[v]' -map '[a]' -t $duration -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k $clip | Out-Null
  $concatLines += "file '$($clip.Replace("'", "''"))'"
}
$concatPath = Join-Path $root 'concat.txt'
[IO.File]::WriteAllLines($concatPath, $concatLines)
$final = Join-Path $PSScriptRoot 'ATEC-Complete-Platform-Overview-Global-English-1080p.mp4'
& $ffmpeg -y -f concat -safe 0 -i $concatPath -c copy -movflags +faststart $final | Out-Null
Write-Output $final
