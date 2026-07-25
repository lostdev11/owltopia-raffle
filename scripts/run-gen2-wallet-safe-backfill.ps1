# Continues Gen2 wallet-safe metadata backfill (DAS-unsafe only).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$batchSize = 25
$concurrency = 1
$pauseSec = 25
$log = Join-Path $root 'scripts\_backfill-gen2-run.log'
$maxEmptyBatches = 3
$emptyBatches = 0

"==== RESTART $(Get-Date -Format o) ====" | Tee-Object -FilePath $log -Append

$totalFixed = 0
$totalSafe = 0
$totalFailed = 0

for ($i = 1; $i -le 120; $i++) {
  $header = "==== BATCH #$i max=$batchSize $(Get-Date -Format o) ===="
  $header | Tee-Object -FilePath $log -Append

  # Always take the current DAS-unsafe head (offset 0). Fixed mints drop out as Helius reindexes.
  $out = & node --env-file=.env.local scripts/backfill-gen2-wallet-safe-metadata.mjs `
    --execute --max=$batchSize --offset=0 --concurrency=$concurrency 2>&1
  $out | Tee-Object -FilePath $log -Append

  $done = ($out | Select-String -Pattern 'Done\. fixed=(\d+) already_safe=(\d+) dry_skipped=(\d+) failed=(\d+)').Matches
  $unsafe = ($out | Select-String -Pattern 'das-indexed-unsafe: (\d+)').Matches

  if ($done.Count -gt 0) {
    $fixed = [int]$done[0].Groups[1].Value
    $safe = [int]$done[0].Groups[2].Value
    $failed = [int]$done[0].Groups[4].Value
    $totalFixed += $fixed
    $totalSafe += $safe
    $totalFailed += $failed
    $unsafeLeft = if ($unsafe.Count -gt 0) { [int]$unsafe[0].Groups[1].Value } else { -1 }
    "BATCH totals so far: fixed=$totalFixed already_safe=$totalSafe failed=$totalFailed unsafe_left=$unsafeLeft" | Tee-Object -FilePath $log -Append

    if ($fixed -eq 0 -and $safe -eq 0) {
      $emptyBatches++
    } else {
      $emptyBatches = 0
    }

    if ($unsafeLeft -eq 0) {
      "==== COMPLETE no unsafe left $(Get-Date -Format o) ====" | Tee-Object -FilePath $log -Append
      break
    }
    if ($emptyBatches -ge $maxEmptyBatches) {
      "==== STOPPED after $maxEmptyBatches empty batches $(Get-Date -Format o) ====" | Tee-Object -FilePath $log -Append
      break
    }
  } else {
    "BATCH did not print Done line (exit=$LASTEXITCODE) - pausing longer" | Tee-Object -FilePath $log -Append
    Start-Sleep -Seconds 45
  }

  Start-Sleep -Seconds $pauseSec
}

"==== END $(Get-Date -Format o) fixed=$totalFixed already_safe=$totalSafe failed=$totalFailed ====" | Tee-Object -FilePath $log -Append
