/**
 * Take the Gen1 holder snapshot for the Gen2 AIRDROP allowlist (the `gen1` guard group).
 * Scans the Owltopia Gen1 collection on mainnet (Helius DAS) → owner→count, then writes the
 * frozen snapshot to gen2_gen1_airdrop_snapshot.
 *
 * Tell holders to DELIST before running — NFTs in marketplace escrow snapshot the escrow wallet.
 *
 * Safe by default (prints summary). Pass --confirm to replace the snapshot.
 *   npx --yes tsx --env-file=.env.local scripts/gen2-gen1-snapshot.ts
 *   npx --yes tsx --env-file=.env.local scripts/gen2-gen1-snapshot.ts --confirm
 *
 * After writing, re-run: scripts/gen2-guard-prep.ts (gen1 root) and
 * scripts/gen2-cm-setup.ts guards --confirm (so the gen1 group is set on-chain).
 */
import { scanGen1HoldersFromChain } from '@/lib/owl-center/gen1-holder-scan'
import { getGen1SnapshotSummary, replaceGen1Snapshot } from '@/lib/db/gen2-gen1-snapshot'

async function main() {
  const confirm = process.argv.includes('--confirm')

  const scan = await scanGen1HoldersFromChain()
  if (!scan.ok) throw new Error(scan.error)

  const maxHeld = scan.holders.reduce((m, h) => Math.max(m, h.gen1_nft_count), 0)
  console.log(`Gen1 scan: ${scan.holders.length} holders, ${scan.assets_scanned} NFTs, max held by one wallet = ${maxHeld}`)
  console.log(`(Set GEN1_MINT_LIMIT in scripts/gen2-cm-setup.ts to >= ${maxHeld}.)`)

  if (!confirm) {
    const before = await getGen1SnapshotSummary()
    console.log(`Current snapshot in DB: ${before.wallets} wallets. (dry-run) re-run with --confirm to replace.`)
    return
  }

  const res = await replaceGen1Snapshot(scan.holders, 'chain')
  console.log(`snapshot written: ${res.upserted} wallets upserted, ${res.failed.length} failed.`)
  if (res.failed.length) console.log('failures:', res.failed.slice(0, 5))
  const after = await getGen1SnapshotSummary()
  console.log(`snapshot now: ${after.wallets} wallets, ${after.total_nfts} NFTs, max/wallet ${after.max_nfts_per_wallet}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('snapshot failed:', e)
    process.exit(1)
  })
