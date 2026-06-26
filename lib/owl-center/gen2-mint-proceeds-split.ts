import 'server-only'

import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import {
  GEN2_MINT_FUND_SPLITS_FALLBACK,
  loadGen2MintProceedsKeypair,
} from '@/lib/owl-center/gen2-mint-proceeds'

/** SOL kept in the distribution wallet for tx fees / rent (not swept). */
const DEFAULT_RESERVE_SOL = 0.05
/** Only sweep when the distributable balance exceeds this (avoids dust txs + their fees). */
const DEFAULT_MIN_SWEEP_SOL = 0.05

type SplitRow = { address: string; share: number }

export type Gen2MintProceedsSplitResult =
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: true; status: 'noop'; balanceSol: number; distributableSol: number; reason: string }
  | {
      ok: true
      status: 'swept'
      signature: string
      balanceSol: number
      sweptSol: number
      payouts: Array<{ address: string; sol: number }>
    }
  | { ok: false; error: string }

function reserveLamports(): bigint {
  const raw = process.env.GEN2_MINT_PROCEEDS_RESERVE_SOL?.trim()
  const sol = raw && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : DEFAULT_RESERVE_SOL
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL))
}

function minSweepLamports(): bigint {
  const raw = process.env.GEN2_MINT_PROCEEDS_MIN_SWEEP_SOL?.trim()
  const sol = raw && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : DEFAULT_MIN_SWEEP_SOL
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL))
}

async function loadSplits(): Promise<{ launchId: string | null; splits: SplitRow[] }> {
  try {
    const { data } = await getSupabaseAdmin()
      .from('owl_center_launches')
      .select('id, mint_fund_splits')
      .eq('slug', 'gen2')
      .maybeSingle()
    const raw = (data as { id?: string; mint_fund_splits?: unknown } | null)?.mint_fund_splits
    const launchId = (data as { id?: string } | null)?.id ?? null
    if (Array.isArray(raw)) {
      const splits = raw
        .map((r) => r as { address?: unknown; share?: unknown })
        .filter((r) => typeof r.address === 'string' && Number(r.share) > 0)
        .map((r) => ({ address: String(r.address), share: Number(r.share) }))
      if (splits.length > 0) return { launchId, splits }
    }
    return { launchId, splits: [...GEN2_MINT_FUND_SPLITS_FALLBACK] }
  } catch {
    return { launchId: null, splits: [...GEN2_MINT_FUND_SPLITS_FALLBACK] }
  }
}

/** Largest-remainder allocation so the sum of payouts equals `total` exactly (no dust left behind). */
function allocate(total: bigint, splits: SplitRow[]): Array<{ address: string; lamports: bigint }> {
  const totalShare = splits.reduce((s, r) => s + r.share, 0)
  if (totalShare <= 0) return []
  const out = splits.map((r) => ({ address: r.address, lamports: (total * BigInt(Math.round(r.share))) / BigInt(totalShare) }))
  const assigned = out.reduce((s, r) => s + r.lamports, 0n)
  let remainder = total - assigned
  // Hand any rounding remainder to the first recipient.
  if (remainder > 0n && out.length > 0) out[0]!.lamports += remainder
  return out.filter((r) => r.lamports > 0n)
}

/**
 * Sweep accumulated (enforced) mint proceeds from the distribution wallet to the founder split
 * wallets. Idempotent: a no-op until the distributable balance clears the reserve + threshold.
 * Safe no-op until `GEN2_MINT_PROCEEDS_SECRET_KEY` is configured.
 */
export async function sweepGen2MintProceeds(): Promise<Gen2MintProceedsSplitResult> {
  if (process.env.GEN2_MINT_PROCEEDS_SPLIT_ENABLED === 'false') {
    return { ok: true, status: 'skipped', reason: 'split disabled (GEN2_MINT_PROCEEDS_SPLIT_ENABLED=false)' }
  }

  const kp = loadGen2MintProceedsKeypair()
  if (!kp) {
    return { ok: true, status: 'skipped', reason: 'distribution wallet not configured (GEN2_MINT_PROCEEDS_SECRET_KEY)' }
  }

  const { launchId, splits } = await loadSplits()
  if (splits.length === 0) {
    return { ok: true, status: 'skipped', reason: 'no mint_fund_splits configured' }
  }

  let recipients: PublicKey[]
  try {
    recipients = splits.map((s) => new PublicKey(s.address))
  } catch {
    return { ok: false, error: 'mint_fund_splits contains an invalid wallet address' }
  }

  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  const balance = BigInt(await connection.getBalance(kp.publicKey, 'confirmed'))
  const reserve = reserveLamports()
  const distributable = balance > reserve ? balance - reserve : 0n
  const balanceSol = Number(balance) / LAMPORTS_PER_SOL

  if (distributable < minSweepLamports()) {
    return {
      ok: true,
      status: 'noop',
      balanceSol,
      distributableSol: Number(distributable) / LAMPORTS_PER_SOL,
      reason: 'below sweep threshold',
    }
  }

  const allocations = allocate(distributable, splits)
  if (allocations.length === 0) {
    return { ok: true, status: 'noop', balanceSol, distributableSol: 0, reason: 'nothing to allocate' }
  }

  const tx = new Transaction()
  allocations.forEach((a, i) => {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: recipients[i]!,
        lamports: Number(a.lamports),
      })
    )
  })

  let signature: string
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.lastValidBlockHeight = lastValidBlockHeight
    tx.feePayer = kp.publicKey
    tx.sign(kp)
    signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false })
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const payouts = allocations.map((a) => ({ address: a.address, sol: Number(a.lamports) / LAMPORTS_PER_SOL }))
  const sweptSol = payouts.reduce((s, p) => s + p.sol, 0)

  if (launchId) {
    try {
      const summary = payouts.map((p) => `${p.address.slice(0, 4)}…=${p.sol.toFixed(4)}`).join(', ')
      await getSupabaseAdmin()
        .from('owl_center_activity_logs')
        .insert({
          launch_id: launchId,
          message: `Mint proceeds swept ${sweptSol.toFixed(4)} SOL — ${summary} (${signature.slice(0, 8)}…)`,
          event_type: 'system',
        })
    } catch (e) {
      console.error('[gen2-mint-proceeds-split] activity log failed', e)
    }
  }

  return { ok: true, status: 'swept', signature, balanceSol, sweptSol, payouts }
}
