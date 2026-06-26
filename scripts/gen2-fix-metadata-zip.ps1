# Phase 1: rebuild the Gen2 staged ZIP with the FINAL branding for a clean MAINNET re-upload.
#
# Source: collections/owltopia-gen2/source/gen2.zip (recovered original; names "Owltopia G2"/"OWL2").
# Output: collections/owltopia-gen2/source/gen2-mainnet.zip with:
#   - every item JSON  name "Owltopia G2 #N" -> "Owltopia Gen2 #N", symbol "OWL2" -> "OWLGEN2"
#   - collection JSON  name "Owltopia G2" -> "Owltopia Gen2",       symbol "OWL2" -> "OWLGEN2"
#   - image refs left RELATIVE (e.g. "1.png") so the upload pipeline rewrites them to mainnet Arweave
#   - adds gen2/collection.png (copy of gen2/1.png) so the collection has a working image (placeholder)
#   - all PNGs + traits.csv copied through unchanged (streamed; low memory)
#
# Run: powershell -ExecutionPolicy Bypass -File scripts/gen2-fix-metadata-zip.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root   = (Resolve-Path "$PSScriptRoot\..").Path
$srcPath = Join-Path $root 'collections\owltopia-gen2\source\gen2.zip'
$dstPath = Join-Path $root 'collections\owltopia-gen2\source\gen2-mainnet.zip'

if (-not (Test-Path $srcPath)) { throw "Source zip not found: $srcPath (run gen2-fetch-staged-zip.mjs first)" }
if (Test-Path $dstPath) { Remove-Item $dstPath -Force }

Write-Host "rebuilding $srcPath -> $dstPath"

$utf8 = New-Object System.Text.UTF8Encoding($false)
$src  = [System.IO.Compression.ZipFile]::OpenRead($srcPath)
$fs   = [System.IO.File]::Open($dstPath, [System.IO.FileMode]::Create)
$dst  = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)

$store   = [System.IO.Compression.CompressionLevel]::NoCompression
$optimal = [System.IO.Compression.CompressionLevel]::Optimal

$jsonChanged = 0
$pngCopied = 0
$onePngBytes = $null
$collImageName = $null

try {
  foreach ($e in $src.Entries) {
    if ([string]::IsNullOrEmpty($e.Name)) { continue } # directory entry
    $isJson = $e.FullName.ToLower().EndsWith('.json')
    $isOnePng = $e.FullName.ToLower().EndsWith('/1.png') -or $e.FullName.ToLower() -eq '1.png'

    if ($isJson) {
      $rs = $e.Open(); $sr = New-Object System.IO.StreamReader($rs)
      $txt = $sr.ReadToEnd(); $sr.Dispose(); $rs.Dispose()
      $new = $txt.Replace('Owltopia G2', 'Owltopia Gen2').Replace('"OWL2"', '"OWLGEN2"')
      if ($new -ne $txt) { $jsonChanged++ }
      $ne = $dst.CreateEntry($e.FullName, $optimal)
      $os = $ne.Open(); $sw = New-Object System.IO.StreamWriter($os, $utf8)
      $sw.Write($new); $sw.Dispose(); $os.Dispose()
    }
    else {
      $ne = $dst.CreateEntry($e.FullName, $store)
      $is = $e.Open(); $os = $ne.Open()
      if ($isOnePng) {
        $ms = New-Object System.IO.MemoryStream
        $is.CopyTo($ms); $onePngBytes = $ms.ToArray(); $ms.Dispose()
        $os.Write($onePngBytes, 0, $onePngBytes.Length)
        $collImageName = ($e.FullName -replace '1\.png$', 'collection.png')
      } else {
        $is.CopyTo($os)
      }
      $is.Dispose(); $os.Dispose()
      if ($e.FullName.ToLower().EndsWith('.png')) { $pngCopied++ }
    }
  }

  # Add a placeholder collection.png (copy of 1.png) so collection.json's image resolves after upload.
  if ($onePngBytes -and $collImageName) {
    $ne = $dst.CreateEntry($collImageName, $store)
    $os = $ne.Open(); $os.Write($onePngBytes, 0, $onePngBytes.Length); $os.Dispose()
    Write-Host "added $collImageName (placeholder = copy of 1.png)"
  }
}
finally {
  $dst.Dispose(); $fs.Dispose(); $src.Dispose()
}

$sizeMB = [Math]::Round((Get-Item $dstPath).Length / 1MB, 1)
Write-Host "DONE. json updated=$jsonChanged png copied=$pngCopied  -> $dstPath ($sizeMB MB)"
