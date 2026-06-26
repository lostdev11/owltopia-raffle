import 'server-only'

import bs58 from 'bs58'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import {
  createSignerFromKeypair,
  isSome,
  publicKey,
  signerIdentity,
  some,
  type Umi,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  fetchCandyMachine,
  mplCandyMachine,
  safeFetchCandyGuard,
  updateCandyGuard,
  type CandyGuard,
} from '@metaplex-foundation/mpl-candy-machine'

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'
import { gen2GuardGroupLabel } from '@/lib/solana/gen2-guards'
import { getLaunchCandyMachineId, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import type { OwlMintNetwork } from '@/lib/solana/network'

/** Re-peg only when the live SOL price has moved this far from the on-chain guard (default 2%). */
const DEFAULT_DRIFT_BPS = 200

export type Gen2GuardGroupQuote = {
  label: string
  usd: number
  currentLamports: string
  targetLamports: string
  driftBps: number
  willUpdate: boolean
}

export type Gen2GuardRepriceResult =
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: true; status: 'noop'; solUsdPrice: number; groups: Gen2GuardGroupQuote[] }
  | {
      ok: true
      status: 'updated'
      signature: string
      solUsdPrice: number
      groups: Gen2GuardGroupQuote[]
    }
  | { ok: false; error: string }

type Gen2LaunchRepriceRow = {
  id: string
  slug: string
  mint_mode: string | null
  mint_network: string | null
  candy_machine_id: string | null
  devnet_candy_machine_id: string | null
  wl_price_usdc: number | null
  public_price_usdc: number | null
}

function repriceDriftBps(): number {
  const raw = process.env.GEN2_GUARD_REPRICE_DRIFT_BPS?.trim()
  if (!raw) return DEFAULT_DRIFT_BPS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DRIFT_BPS
}

/** Guard-authority secret (dedicated key, else the deploy/upload key). */
function parseGuardAuthoritySecret(): Uint8Array | null {
  const raw =
    process.env.GEN2_GUARD_AUTHORITY_SECRET_KEY?.trim() || process.env.IRYS_PRIVATE_KEY?.trim()
  if (!raw) return null
  try {
    return bs58.decode(raw)
  } catch {
    try {
      const parsed = JSON.parse(raw) as number[]
      if (Array.isArray(parsed) && parsed.length >= 64) return Uint8Array.from(parsed)
    } catch {
      // not JSON either
    }
  }
  return null
}

function rpcUrlForNetwork(network: OwlMintNetwork): string {
  if (network === 'devnet') {
    return (
      process.env.SOLANA_RPC_DEVNET_URL?.trim() ||
      process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim() ||
      'https://api.devnet.solana.com'
    )
  }
  return resolveServerSolanaRpcUrl()
}

function createGuardAuthorityUmi(network: OwlMintNetwork, secret: Uint8Array): Umi {
  const umi = createUmi(rpcUrlForNetwork(network), { commitment: 'confirmed' }).use(mplCandyMachine())
  const kp = umi.eddsa.createKeypairFromSecretKey(secret)
  umi.use(signerIdentity(createSignerFromKeypair(umi, kp)))
  return umi
}

async function loadGen2RepriceLaunch(): Promise<Gen2LaunchRepriceRow | null> {
  const db = getSupabaseAdmin()
  const { data } = await db
    .from('owl_center_launches')
    .select(
      'id, slug, mint_mode, mint_network, candy_machine_id, devnet_candy_machine_id, wl_price_usdc, public_price_usdc'
    )
    .eq('slug', 'gen2')
    .maybeSingle()
  return (data as Gen2LaunchRepriceRow | null) ?? null
}

/** Target lamports for a USD price at the current SOL/USD spot (exact integer). */
function usdToLamports(usd: number, solUsd: number): bigint {
  return BigInt(Math.round((usd / solUsd) * LAMPORTS_PER_SOL))
}

/**
 * Re-peg the Gen2 Candy Machine `solPayment` guard (WL / public groups) to their fixed
 * USD targets using the live SOL/USD price. Safe no-op until the CM is deployed and the
 * guard-authority key is configured. Only updates when drift exceeds the threshold.
 */
export async function repriceGen2GuardIfDrifted(): Promise<Gen2GuardRepriceResult> {
  if (process.env.GEN2_GUARD_REPRICE_ENABLED === 'false') {
    return { ok: true, status: 'skipped', reason: 'reprice disabled (GEN2_GUARD_REPRICE_ENABLED=false)' }
  }

  const launch = await loadGen2RepriceLaunch()
  if (!launch) return { ok: true, status: 'skipped', reason: 'gen2 launch not found' }

  const network = resolveLaunchMintNetwork({
    mint_mode: launch.mint_mode as never,
    mint_network: launch.mint_network as never,
  })
  const cmId = getLaunchCandyMachineId(
    {
      slug: launch.slug,
      mint_mode: launch.mint_mode as never,
      mint_network: launch.mint_network as never,
      candy_machine_id: launch.candy_machine_id,
      collection_mint: null,
      devnet_candy_machine_id: launch.devnet_candy_machine_id,
      devnet_collection_mint: null,
    },
    network
  )
  if (!cmId) return { ok: true, status: 'skipped', reason: 'candy machine not deployed yet' }

  const secret = parseGuardAuthoritySecret()
  if (!secret) {
    return { ok: true, status: 'skipped', reason: 'guard authority key not configured' }
  }

  const umi = createGuardAuthorityUmi(network, secret)

  const candyMachine = await fetchCandyMachine(umi, publicKey(cmId))
  const candyGuard = await safeFetchCandyGuard(umi, candyMachine.mintAuthority)
  if (!candyGuard) return { ok: true, status: 'skipped', reason: 'candy guard not found on-chain' }

  if (String(candyGuard.authority) !== String(umi.identity.publicKey)) {
    console.error(
      `[gen2-reprice] guard authority ${String(candyGuard.authority)} does not match configured key ${String(umi.identity.publicKey)}`
    )
    return { ok: true, status: 'skipped', reason: 'configured key is not the guard authority' }
  }

  const solUsd = await resolveGen2SolUsdPrice()

  const usdByLabel = new Map<string, number>()
  const wlLabel = gen2GuardGroupLabel('WHITELIST')
  const pubLabel = gen2GuardGroupLabel('PUBLIC')
  if (wlLabel && launch.wl_price_usdc != null && launch.wl_price_usdc > 0) {
    usdByLabel.set(wlLabel, launch.wl_price_usdc)
  }
  if (pubLabel && launch.public_price_usdc != null && launch.public_price_usdc > 0) {
    usdByLabel.set(pubLabel, launch.public_price_usdc)
  }

  const driftThreshold = repriceDriftBps()
  const quotes: Gen2GuardGroupQuote[] = []

  const nextGroups = candyGuard.groups.map((group) => {
    const usd = usdByLabel.get(group.label)
    // Support either payment guard — Gen2 mints frozen NFTs via freezeSolPayment, but the
    // logic is identical for a plain solPayment group (whichever this group uses).
    const sp = group.guards.solPayment
    const fsp = group.guards.freezeSolPayment
    const paymentKind: 'solPayment' | 'freezeSolPayment' | null = isSome(sp)
      ? 'solPayment'
      : isSome(fsp)
        ? 'freezeSolPayment'
        : null
    if (usd == null || paymentKind == null) return group

    const payment = isSome(sp) ? sp.value : isSome(fsp) ? fsp.value : null
    if (payment == null) return group
    const current = payment.lamports.basisPoints
    const target = usdToLamports(usd, solUsd)
    const driftBps =
      current > 0n
        ? Number((target > current ? target - current : current - target) * 10_000n / current)
        : 10_000
    const willUpdate = driftBps >= driftThreshold

    quotes.push({
      label: group.label,
      usd,
      currentLamports: current.toString(),
      targetLamports: target.toString(),
      driftBps,
      willUpdate,
    })

    if (!willUpdate) return group
    const nextPayment = some({ ...payment, lamports: { ...payment.lamports, basisPoints: target } })
    return {
      ...group,
      guards: {
        ...group.guards,
        ...(paymentKind === 'solPayment' ? { solPayment: nextPayment } : { freezeSolPayment: nextPayment }),
      },
    }
  })

  if (!quotes.some((q) => q.willUpdate)) {
    return { ok: true, status: 'noop', solUsdPrice: solUsd, groups: quotes }
  }

  let signature: string
  try {
    const res = await updateCandyGuard(umi, {
      candyGuard: candyGuard.publicKey,
      guards: candyGuard.guards,
      groups: nextGroups,
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    signature = bs58.encode(res.signature)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  await logRepriceActivity(launch.id, solUsd, quotes, signature)

  return { ok: true, status: 'updated', signature, solUsdPrice: solUsd, groups: quotes }
}

async function logRepriceActivity(
  launchId: string,
  solUsd: number,
  quotes: Gen2GuardGroupQuote[],
  signature: string
): Promise<void> {
  const summary = quotes
    .filter((q) => q.willUpdate)
    .map((q) => `${q.label}=$${q.usd}→${(Number(q.targetLamports) / LAMPORTS_PER_SOL).toFixed(4)} SOL`)
    .join(', ')
  try {
    await getSupabaseAdmin()
      .from('owl_center_activity_logs')
      .insert({
        launch_id: launchId,
        message: `Guard re-priced @ $${solUsd.toFixed(2)}/SOL — ${summary} (${signature.slice(0, 8)}…)`,
        event_type: 'system',
      })
  } catch (e) {
    console.error('[gen2-reprice] activity log failed', e)
  }
}
