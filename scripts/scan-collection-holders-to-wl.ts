/**
 * Scan a Metaplex Core collection's current holders (mainnet Helius DAS) and import them
 * into owl_center_wl_allocations as WL spots for the Gen2 mint.
 *
 * Use case: auto-WL the Owltopia Coin NFT holders (and any other collection) by snapshotting
 * current holders and giving each wallet WL mints.
 *
 * Dry run (default — NO database writes, just prints counts):
 *   npx --yes tsx scripts/scan-collection-holders-to-wl.ts --collection=<MINT> --mints=2 --community=owl_coin
 *
 * Commit (writes rows to owl_center_wl_allocations):
 *   npx --yes tsx scripts/scan-collection-holders-to-wl.ts --collection=<MINT> --mints=2 --community=owl_coin --commit
 *
 * Defaults: --collection falls back to NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS, --mints=2.
 *
 * Requires (same as production holder checks): NEXT_PUBLIC_SUPABASE_URL,
 *   SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY, HELIUS_API_KEY.
 *
 * IMPORTANT: after committing, the WHITELIST on-chain merkle root must be re-set from
 *   /api/owl-center/gen2/wl-proof?phase=WHITELIST before WL goes live, or the new
 *   wallets will have proofs that do not match the on-chain root and cannot mint.
 */
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

import { bulkUpsertWlAllocations } from '@/lib/db/owl-center-wl-allocations'
import { scanCollectionHolders } from '@/lib/owl-center/scan-collection-holders'

function getArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function scanHolders(collectionAddress: string, heliusApiKey: string): Promise<string[]> {
  const { wallets, assetsScanned } = await scanCollectionHolders(collectionAddress, heliusApiKey)
  console.log(`Assets scanned: ${assetsScanned} · distinct holder wallets: ${wallets.length}`)
  return wallets
}

async function main() {
  loadEnvConfig(process.cwd())

  const collection =
    getArg('collection') || process.env.NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim()
  const mints = Math.max(1, Math.floor(Number(getArg('mints') ?? '2')))
  const community = getArg('community') ?? 'owl_coin'
  const commit = hasFlag('commit')
  const raiseOnly = hasFlag('raise-only')

  if (!collection) {
    console.error('Missing --collection=<MINT> (or NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS)')
    process.exit(1)
  }
  const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
  if (!heliusApiKey) {
    console.error('Missing HELIUS_API_KEY')
    process.exit(1)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  console.log(`Collection: ${collection}`)
  console.log(`WL mints per wallet: ${mints} · community tag: ${community}`)
  console.log(`Allocation mode: ${raiseOnly ? 'RAISE-ONLY (never lower existing)' : 'SET (overwrite allowed_mints)'}`)
  console.log(`Mode: ${commit ? 'COMMIT (writes to owl_center_wl_allocations)' : 'DRY RUN (no writes)'}\n`)

  const holders = await scanHolders(collection, heliusApiKey)
  if (holders.length === 0) {
    console.error('No holders found — check the collection address and Helius key.')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  const { data: existingRows, error } = await supabase
    .from('owl_center_wl_allocations')
    .select('wallet')
  if (error) {
    console.error('Failed to read existing WL allocations:', error.message)
    process.exit(1)
  }
  const existing = new Set((existingRows ?? []).map((r) => String((r as { wallet: string }).wallet)))
  const newWallets = holders.filter((w) => !existing.has(w))

  console.log(`Current WL wallets: ${existing.size}`)
  console.log(`Coin holders already in WL: ${holders.length - newWallets.length}`)
  console.log(`Coin holders NOT yet in WL (would be added): ${newWallets.length}`)

  if (!commit) {
    console.log('\nDRY RUN complete — re-run with --commit to write these wallets into WL.')
    return
  }

  const result = await bulkUpsertWlAllocations(
    holders.map((wallet) => ({ wallet, allowed_mints: mints, community })),
    { raiseOnly }
  )
  console.log(`\nUpserted: ${result.upserted} · failed: ${result.failed.length}`)
  for (const f of result.failed.slice(0, 20)) console.log(`  - ${f.wallet}: ${f.error}`)
  console.log('\nNEXT STEP: re-set the WHITELIST merkle root on-chain from /api/owl-center/gen2/wl-proof?phase=WHITELIST')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
