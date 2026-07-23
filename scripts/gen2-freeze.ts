/**
 * Gen2 freezeSolPayment lifecycle (mainnet). Thin CLI over `lib/owl-center/gen2-freeze-thaw`.
 *
 *   init    Create the freeze escrow (before first mint).
 *   thaw    Unfreeze every minted NFT (or use admin/cron batched thaw at mint-out).
 *   unlock  After ALL NFTs are thawed, close the freeze escrow.
 *
 * Safe by default (prints plan). Pass --confirm to send.
 *   npx --yes tsx --env-file=.env.local scripts/gen2-freeze.ts init   --confirm
 *   npx --yes tsx --env-file=.env.local scripts/gen2-freeze.ts thaw   --confirm
 *   npx --yes tsx --env-file=.env.local scripts/gen2-freeze.ts unlock --confirm
 */
import {
  fetchGen2CollectionAssets,
  initGen2FreezeEscrow,
  resolveGen2FreezeDistributionWallet,
  resolveGen2FreezeIds,
  thawGen2AllAssets,
  unlockGen2FreezeEscrow,
  GEN2_FREEZE_GROUP,
  GEN2_FREEZE_PERIOD_SECONDS,
} from '@/lib/owl-center/gen2-freeze-thaw'

function confirmFlag() {
  return process.argv.includes('--confirm')
}

async function doInit(confirm: boolean) {
  const ids = resolveGen2FreezeIds()
  const DEST = resolveGen2FreezeDistributionWallet()
  console.log(
    `init freeze escrow: destination=${DEST} period=${GEN2_FREEZE_PERIOD_SECONDS}s (~30d) group=${GEN2_FREEZE_GROUP} cm=${ids.candyMachineId}`
  )
  if (!confirm) return console.log('(dry-run) re-run with --confirm to send.')
  const res = await initGen2FreezeEscrow(ids)
  if (res.already) console.log('freeze escrow already initialized — nothing to do.')
  else console.log('freeze escrow initialized:', res.signature)
}

async function doThaw(confirm: boolean) {
  const ids = resolveGen2FreezeIds()
  const assets = await fetchGen2CollectionAssets(ids.collectionMint, ids.rpcUrl)
  console.log(`thaw: found ${assets.length} minted NFTs in collection ${ids.collectionMint}`)
  if (!confirm) return console.log('(dry-run) re-run with --confirm to thaw each NFT.')
  const res = await thawGen2AllAssets(ids)
  console.log(
    `thaw done: ${res.thawed} thawed, ${res.skipped} skipped (of ${res.total}). When all are thawed, run: unlock --confirm`
  )
}

async function doUnlock(confirm: boolean) {
  const DEST = resolveGen2FreezeDistributionWallet()
  console.log(`unlock funds -> ${DEST} (requires ALL NFTs already thawed)`)
  if (!confirm) return console.log('(dry-run) re-run with --confirm to send.')
  const res = await unlockGen2FreezeEscrow()
  console.log('funds unlocked:', res.signature)
}

async function main() {
  const cmd = process.argv[2]
  const confirm = confirmFlag()
  if (cmd === 'init') return doInit(confirm)
  if (cmd === 'thaw') return doThaw(confirm)
  if (cmd === 'unlock') return doUnlock(confirm)
  console.log('usage: gen2-freeze.ts <init|thaw|unlock> [--confirm]')
  process.exit(1)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('freeze op failed:', e)
    process.exit(1)
  })
