async function main() {
  const wallet = process.argv[2]?.trim()
  const dryRun = process.argv.includes('--dry-run')
  if (!wallet) {
    console.error('Usage: node scripts/run-claim-ledger-catchup.mjs <wallet> [--dry-run]')
    process.exit(1)
  }

  const { catchUpClaimLedgerForWallet } = await import('../lib/nesting/claim-ledger-audit.ts')
  const result = await catchUpClaimLedgerForWallet({
    wallet,
    dryRun,
    adminWallet: 'script',
    note: 'script_catchup_after_ledger_sync_failure',
  })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
