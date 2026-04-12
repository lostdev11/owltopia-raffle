/**
 * Read-only audit: Owltopia holder fee tier vs database snapshots.
 *
 * - Loads .env.local via Next (same as the app).
 * - For every distinct raffle creator wallet, runs the same full check as the dashboard
 *   (`getCreatorFeeTier` with skipCache + deep wallet scan).
 * - Flags settled raffles where `fee_bps_applied` does not match `fee_tier_reason`.
 * - Flags drift between **current** holder status and **settlement snapshot** (expected when
 *   someone buys/sells the Owl NFT after the draw; worth manual review if you suspect a bug).
 *
 * Run from repo root:
 *   npm run audit:owl-tiers
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HELIUS_API_KEY,
 *   OWLTOPIA_COLLECTION_ADDRESS (or NEXT_PUBLIC_*), same as production holder checks.
 */
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { HOLDER_FEE_BPS, STANDARD_FEE_BPS } from '@/lib/config/raffles'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { devSaveApiCredits } from '@/lib/dev-budget'

type RaffleRow = {
  id: string
  slug: string | null
  status: string | null
  creator_wallet: string | null
  created_by: string | null
  fee_tier_reason: string | null
  fee_bps_applied: number | string | null
  settled_at: string | null
}

function creatorKey(row: RaffleRow): string {
  return (row.creator_wallet || row.created_by || '').trim()
}

function expectedBpsForReason(reason: string | null): number | null {
  if (reason === 'holder') return HOLDER_FEE_BPS
  if (reason === 'standard') return STANDARD_FEE_BPS
  return null
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next++
      if (i >= items.length) break
      ret[i] = await fn(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return ret
}

async function main() {
  loadEnvConfig(process.cwd())

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  const HOLDER_LOOKUP_CONCURRENCY = devSaveApiCredits() ? 2 : 3

  const { data: raffles, error } = await supabase
    .from('raffles')
    .select(
      'id, slug, status, creator_wallet, created_by, fee_tier_reason, fee_bps_applied, settled_at'
    )

  if (error) {
    console.error(error)
    process.exit(1)
  }

  const rows = (raffles ?? []) as RaffleRow[]

  const wallets = new Set<string>()
  for (const r of rows) {
    const w = creatorKey(r)
    if (w) wallets.add(w)
  }

  const walletList = Array.from(wallets).sort()

  console.log(`Distinct creator wallets: ${walletList.length}`)
  console.log(`Raffle rows: ${rows.length}`)
  console.log(`Concurrency (Helius): ${HOLDER_LOOKUP_CONCURRENCY}\n`)

  const tierByWallet = new Map<string, { feeBps: number; reason: 'holder' | 'standard' }>()
  const tierResults = await mapWithConcurrency(walletList, HOLDER_LOOKUP_CONCURRENCY, async (w) => {
    try {
      const tier = await getCreatorFeeTier(w, { skipCache: true, listDisplayOnly: false })
      return { wallet: w, tier, err: null as string | null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { wallet: w, tier: null, err: msg }
    }
  })

  for (const r of tierResults) {
    if (r.err || !r.tier) {
      console.error(`[tier lookup failed] ${r.wallet}: ${r.err ?? 'unknown'}`)
      continue
    }
    tierByWallet.set(r.wallet, r.tier)
  }

  const bpsMismatch: { slug: string; id: string; reason: string | null; bps: number | null; expected: number | null }[] =
    []
  const driftCurrentHolderVsSnapshot: RaffleRow[] = []
  const driftCurrentStandardVsSnapshotHolder: RaffleRow[] = []

  for (const r of rows) {
    const w = creatorKey(r)
    if (!w) continue

    const reason = r.fee_tier_reason
    const bpsRaw = r.fee_bps_applied
    const bps =
      bpsRaw == null || bpsRaw === ''
        ? null
        : typeof bpsRaw === 'number'
          ? bpsRaw
          : parseInt(String(bpsRaw), 10)

    if (reason != null) {
      const expected = expectedBpsForReason(reason)
      if (expected != null && bps != null && bps !== expected) {
        bpsMismatch.push({
          slug: r.slug ?? r.id,
          id: r.id,
          reason,
          bps: Number.isFinite(bps) ? bps : null,
          expected,
        })
      }
    }

    if (reason == null || !r.settled_at) continue

    const live = tierByWallet.get(w)
    if (!live) continue

    if (live.reason === 'holder' && reason === 'standard') {
      driftCurrentHolderVsSnapshot.push(r)
    }
    if (live.reason === 'standard' && reason === 'holder') {
      driftCurrentStandardVsSnapshotHolder.push(r)
    }
  }

  const currentHolders = walletList.filter((w) => tierByWallet.get(w)?.reason === 'holder')
  const currentStandards = walletList.filter((w) => tierByWallet.get(w)?.reason === 'standard')

  console.log('--- Summary (live holder check, today) ---')
  console.log(`Wallets resolved as holder (3% tier if hosting now): ${currentHolders.length}`)
  console.log(`Wallets resolved as standard (6% tier if hosting now): ${currentStandards.length}`)

  console.log('\n--- Internal DB: fee_bps_applied vs fee_tier_reason ---')
  if (bpsMismatch.length === 0) {
    console.log('None (every row with a tier reason matches the expected bps).')
  } else {
    console.log(`MISMATCH count: ${bpsMismatch.length}`)
    for (const m of bpsMismatch) {
      console.log(
        `  - ${m.slug} | id=${m.id} | fee_tier_reason=${m.reason} → expected ${m.expected} bps, stored ${m.bps}`
      )
    }
  }

  console.log('\n--- Drift: current holder, but settlement snapshot says standard ---')
  console.log(
    '(Creator holds an Owl NFT **now**; raffle was settled as non-holder. Could mean they acquired the NFT after the draw, or a settlement-time detection bug — review if money is wrong.)'
  )
  if (driftCurrentHolderVsSnapshot.length === 0) {
    console.log('None.')
  } else {
    console.log(`Count: ${driftCurrentHolderVsSnapshot.length}`)
    for (const r of driftCurrentHolderVsSnapshot) {
      const w = creatorKey(r)
      console.log(`  - ${r.slug ?? r.id} | creator=${w} | settled_at=${r.settled_at}`)
    }
  }

  console.log('\n--- Drift: current non-holder, but settlement snapshot says holder ---')
  console.log('(Usually sold/transferred the Owl after the draw — snapshot can legitimately differ.)')
  if (driftCurrentStandardVsSnapshotHolder.length === 0) {
    console.log('None.')
  } else {
    console.log(`Count: ${driftCurrentStandardVsSnapshotHolder.length}`)
    for (const r of driftCurrentStandardVsSnapshotHolder) {
      const w = creatorKey(r)
      console.log(`  - ${r.slug ?? r.id} | creator=${w} | settled_at=${r.settled_at}`)
    }
  }

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
