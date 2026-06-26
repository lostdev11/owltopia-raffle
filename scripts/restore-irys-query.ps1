param(
  [string]$Name = '@irys/query',
  [string]$Version = '0.0.9'
)
$ErrorActionPreference = 'Stop'

$root = 'c:\Dev\OwlRaffleSite\node_modules'
$pkg = Join-Path $root ($Name -replace '/', '\')
$base = "https://cdn.jsdelivr.net/npm/$Name@$Version"
$api = "https://data.jsdelivr.com/v1/packages/npm/$Name@$Version" + '?structure=flat'

$list = Invoke-RestMethod -Uri $api -TimeoutSec 60
Write-Host ("Reconstructing {0}@{1}: {2} files into {3}" -f $Name, $Version, $list.files.Count, $pkg)

$ok = 0; $fail = 0
foreach ($f in $list.files) {
  $rel = $f.name            # e.g. /build/esm/index.js
  $dest = Join-Path $pkg ($rel -replace '/', '\')
  $dir = Split-Path $dest -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $url = $base + $rel
  $done = $false
  for ($i = 1; $i -le 4 -and -not $done; $i++) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 60
      $done = $true; $ok++
    } catch {
      if ($i -eq 4) { Write-Host ("  FAIL {0}: {1}" -f $rel, $_.Exception.Message); $fail++ }
      else { Start-Sleep -Milliseconds 400 }
    }
  }
}
Write-Host ("Done. ok={0} fail={1}" -f $ok, $fail)
Write-Host ("package.json present: " + (Test-Path (Join-Path $pkg 'package.json')))
