/**
 * Auto-whitelist the three "should also have WL" groups for the Gen2 mint, granting each
 * qualifying wallet a fixed number of WL spots (default 2) in owl_center_wl_allocations:
 *
 *   1. Gen1 owl holders        — OWLTOPIA_COLLECTION_ADDRESS (on-chain snapshot via Helius)
 *   2. Owltopia coin NFT holders — NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS (on-chain snapshot)
 *   3. Presale participants     — paid + gifted credits + overage list (gen2_presale_* tables)
 *
 * These WL spots draw from the existing WL supply pool (wl_supply) and are enforced by the
 * mint RPC exactly like any other WL allocation, so qualifying wallets can actually mint in
 * the WHITELIST phase and see it on the wallet checker.
 *
 * RAISE-ONLY: a wallet's allocation is only ever raised to max(existing, --mints) and an
 * existing community tag is preserved, so this is safe to re-run and never lowers a larger
 * admin-set allocation. A wallet in multiple groups still gets just --mints spots (not stacked).
 *
 * Dry run (default — NO writes, just prints counts):
 *   npx --yes tsx scripts/auto-wl-gen2-eligible-groups.ts
 *
 * Commit (writes rows to owl_center_wl_allocations):
 *   npx --yes tsx scripts/auto-wl-gen2-eligible-groups.ts --commit
 *
 * Options:
 *   --mints=2                 WL spots per wallet (default 2)
 *   --skip=gen1,owl_coin,presale   comma list of groups to skip
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY,
 *   HELIUS_API_KEY, OWLTOPIA_COLLECTION_ADDRESS, NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS.
 *
 * IMPORTANT: after committing, re-set the WHITELIST on-chain merkle root from
 *   /api/owl-center/gen2/wl-proof?phase=WHITELIST before WL goes live, or the newly added
 *   wallets will have proofs that do not match the on-chain root and cannot mint.
 */
import { loadEnvConfig } from '@next/env'

import { bulkUpsertWlAllocations } from '@/lib/db/owl-center-wl-allocations'
import { listGen2PresaleMerkleWallets } from '@/lib/gen2-presale/db'
import { scanCollectionHolders } from '@/lib/owl-center/scan-collection-holders'

type Group = 'gen1' | 'owl_coin' | 'presale'

function getArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function resolveGen1Collection(): string | null {
  const raw =
    process.env.OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_OWLTOPIA_COLLECTION_ADDRESS?.trim() ||
    ''
  if (!raw || raw === 'REPLACE_WITH_COLLECTION') return null
  return raw
}

function resolveCoinCollection(): string | null {
  const raw = process.env.NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS?.trim() || ''
  return raw || null
}

async function main() {
  loadEnvConfig(process.cwd())

  const mints = Math.max(1, Math.floor(Number(getArg('mints') ?? '2')))
  const commit = hasFlag('commit')
  const skip = new Set(
    (getArg('skip') ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )

  const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  console.log(`WL mints per wallet: ${mints} · mode: ${commit ? 'COMMIT' : 'DRY RUN'}`)
  console.log('Allocation mode: RAISE-ONLY (never lowers existing, dedupes across groups)\n')

  // First group to claim a wallet wins its community tag (priority gen1 > owl_coin > presale).
  const walletGroup = new Map<string, Group>()
  const counts: Record<Group, number> = { gen1: 0, owl_coin: 0, presale: 0 }

  const addWallets = (wallets: string[], group: Group) => {
    counts[group] = wallets.length
    for (const w of wallets) {
      if (!walletGroup.has(w)) walletGroup.set(w, group)
    }
  }

  // 1. Gen1 owl holders
  if (!skip.has('gen1')) {
    const collection = resolveGen1Collection()
    if (!collection) {
      console.warn('SKIP gen1: OWLTOPIA_COLLECTION_ADDRESS not configured.')
    } else if (!heliusApiKey) {
      console.warn('SKIP gen1: HELIUS_API_KEY missing (needed for on-chain holder scan).')
    } else {
      console.log(`Scanning Gen1 owl holders (${collection})…`)
      const { wallets, assetsScanned } = await scanCollectionHolders(collection, heliusApiKey)
      console.log(`  Gen1: ${assetsScanned} NFTs · ${wallets.length} holder wallets`)
      addWallets(wallets, 'gen1')
    }
  }

  // 2. Owltopia coin NFT holders
  if (!skip.has('owl_coin')) {
    const collection = resolveCoinCollection()
    if (!collection) {
      console.warn('SKIP owl_coin: NESTING_OWLTOPIA_COIN_COLLECTION_ADDRESS not configured.')
    } else if (!heliusApiKey) {
      console.warn('SKIP owl_coin: HELIUS_API_KEY missing (needed for on-chain holder scan).')
    } else {
      console.log(`Scanning Owltopia coin NFT holders (${collection})…`)
      const { wallets, assetsScanned } = await scanCollectionHolders(collection, heliusApiKey)
      console.log(`  Owltopia coin: ${assetsScanned} NFTs · ${wallets.length} holder wallets`)
      addWallets(wallets, 'owl_coin')
    }
  }

  // 3. Presale participants (paid + gifted + overage list)
  if (!skip.has('presale')) {
    console.log('Loading presale participants (paid + gifted + overage)…')
    const wallets = await listGen2PresaleMerkleWallets()
    console.log(`  Presale: ${wallets.length} participant wallets`)
    addWallets(wallets, 'presale')
  }

  const allWallets = [...walletGroup.keys()].sort()
  console.log(
    `\nGroup totals — gen1: ${counts.gen1} · owl_coin: ${counts.owl_coin} · presale: ${counts.presale}`
  )
  console.log(`Distinct wallets to auto-WL (deduped across groups): ${allWallets.length}`)

  if (allWallets.length === 0) {
    console.error('No wallets found across any group — check env/config and try again.')
    process.exit(1)
  }

  if (!commit) {
    console.log('\nDRY RUN complete — re-run with --commit to write these wallets into WL.')
    return
  }

  const result = await bulkUpsertWlAllocations(
    allWallets.map((wallet) => ({ wallet, allowed_mints: mints, community: walletGroup.get(wallet) })),
    { raiseOnly: true }
  )
  console.log(`\nUpserted: ${result.upserted} · failed: ${result.failed.length}`)
  for (const f of result.failed.slice(0, 20)) console.log(`  - ${f.wallet}: ${f.error}`)
  console.log(
    '\nNEXT STEP: re-set the WHITELIST merkle root on-chain from /api/owl-center/gen2/wl-proof?phase=WHITELIST'
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
