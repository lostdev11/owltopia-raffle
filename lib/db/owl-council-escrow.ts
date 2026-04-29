/**
 * Owl Council OWL escrow balances (Supabase + RPCs from migration 075).
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { owlRawToDecimalString } from '@/lib/council/owl-amount-format'

function parseNumericToBigint(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined) return 0n
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 0n
    return BigInt(Math.floor(v))
  }
  const t = String(v).trim()
  if (!t || t === 'NaN') return 0n
  try {
    const i = t.indexOf('.')
    if (i === -1) return BigInt(t)
    return BigInt(t.slice(0, i))
  } catch {
    return 0n
  }
}

export async function getOwlCouncilEscrowBalanceRaw(walletAddress: string): Promise<bigint> {
  const w = walletAddress.trim()
  if (!w) return 0n

  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin
      .from('owl_council_escrow_balances')
      .select('balance_raw')
      .eq('wallet_address', w)
      .maybeSingle()

    if (error || !data) return 0n
    return parseNumericToBigint((data as { balance_raw?: string | number }).balance_raw)
  } catch {
    return 0n
  }
}

export async function rpcCreditCouncilEscrowDeposit(
  wallet: string,
  deltaRaw: bigint,
  txSignature: string
): Promise<{ ok: true } | { ok: false; code: 'duplicate_tx' | 'rpc_error'; message: string }> {
  const w = wallet.trim()
  const sig = txSignature.trim()
  if (!w || !sig || deltaRaw <= 0n) {
    return { ok: false, code: 'rpc_error', message: 'Invalid deposit parameters.' }
  }

  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.rpc('owl_council_escrow_credit_deposit', {
      p_wallet: w,
      p_delta_raw: deltaRaw.toString(),
      p_sig: sig,
    })

    if (!error) return { ok: true }

    const msg = error.message || ''
    if (msg.includes('duplicate') || msg.includes('23505') || msg.includes('duplicate_tx')) {
      return { ok: false, code: 'duplicate_tx', message: 'This transaction was already recorded.' }
    }
    return { ok: false, code: 'rpc_error', message: msg || 'Could not credit deposit.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('duplicate') || msg.includes('23505')) {
      return { ok: false, code: 'duplicate_tx', message: 'This transaction was already recorded.' }
    }
    return { ok: false, code: 'rpc_error', message: msg || 'Could not credit deposit.' }
  }
}

function parseLockedRawFromRpc(value: unknown): bigint {
  if (value === null || value === undefined) return 0n
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0n
    return BigInt(Math.floor(value))
  }
  const t = String(value).trim()
  if (!t || t === 'NaN') return 0n
  const whole = t.split(/[.eE]/)[0]
  if (!whole) return 0n
  try {
    return BigInt(whole)
  } catch {
    return 0n
  }
}

/** One open proposal row: voting weight from escrow credited for that ballot (until voting ends). */
export type OwlCouncilEscrowVoteLockRow = {
  proposalId: string
  slug: string
  title: string
  lockedRaw: bigint
  lockedDecimal: string
}

/**
 * Per-proposal escrow weight locked for the wallet while each proposal's vote is open.
 */
export async function listOwlCouncilEscrowVoteLocksForWallet(
  walletAddress: string,
  decimals: number
): Promise<OwlCouncilEscrowVoteLockRow[]> {
  const w = walletAddress.trim()
  if (!w || decimals < 0 || decimals > 9) return []

  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.rpc('owl_council_escrow_vote_lock_breakdown', {
      p_wallet: w,
      p_decimals: decimals,
    })

    if (error || !Array.isArray(data)) return []

    const out: OwlCouncilEscrowVoteLockRow[] = []
    for (const row of data as { proposal_id?: string; slug?: string; title?: string; locked_raw?: unknown }[]) {
      const raw = parseLockedRawFromRpc(row.locked_raw)
      if (raw <= 0n) continue
      const proposalId = typeof row.proposal_id === 'string' ? row.proposal_id : ''
      const slug = typeof row.slug === 'string' ? row.slug : ''
      const title = typeof row.title === 'string' ? row.title : 'Proposal'
      if (!proposalId || !slug) continue
      out.push({
        proposalId,
        slug,
        title,
        lockedRaw: raw,
        lockedDecimal: owlRawToDecimalString(raw, decimals),
      })
    }
    return out
  } catch {
    return []
  }
}

export async function getOwlCouncilEscrowVoteLockedRaw(
  walletAddress: string,
  decimals: number
): Promise<bigint> {
  const w = walletAddress.trim()
  if (!w || decimals < 0 || decimals > 9) return 0n

  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.rpc('owl_council_escrow_vote_locked_raw', {
      p_wallet: w,
      p_decimals: decimals,
    })

    if (error) return 0n
    return parseLockedRawFromRpc(data)
  } catch {
    return 0n
  }
}

export async function rpcFinalizeCouncilEscrowWithdrawal(
  wallet: string,
  amountRaw: bigint,
  txSignature: string,
  decimals: number
): Promise<{ ok: true } | { ok: false; code: 'duplicate_tx' | 'insufficient' | 'votes_locked' | 'rpc_error'; message: string }> {
  const w = wallet.trim()
  const sig = txSignature.trim()
  if (!w || !sig || amountRaw <= 0n) {
    return { ok: false, code: 'rpc_error', message: 'Invalid withdrawal parameters.' }
  }
  if (decimals < 0 || decimals > 9) {
    return { ok: false, code: 'rpc_error', message: 'Invalid token decimals.' }
  }

  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.rpc('owl_council_escrow_finalize_withdrawal', {
      p_wallet: w,
      p_delta_raw: amountRaw.toString(),
      p_sig: sig,
      p_decimals: decimals,
    })

    if (!error) return { ok: true }

    const msg = error.message || ''
    if (msg.includes('duplicate') || msg.includes('23505') || msg.includes('duplicate_tx')) {
      return { ok: false, code: 'duplicate_tx', message: 'This transaction was already recorded.' }
    }
    if (msg.includes('votes_locked_or_insufficient')) {
      return {
        ok: false,
        code: 'votes_locked',
        message:
          'Part of your escrow OWL is committed to active proposal votes and cannot be withdrawn until those voting windows end.',
      }
    }
    if (msg.includes('insufficient')) {
      return { ok: false, code: 'insufficient', message: 'Insufficient escrow balance.' }
    }
    return { ok: false, code: 'rpc_error', message: msg || 'Could not finalize withdrawal.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('votes_locked_or_insufficient')) {
      return {
        ok: false,
        code: 'votes_locked',
        message:
          'Part of your escrow OWL is committed to active proposal votes and cannot be withdrawn until those voting windows end.',
      }
    }
    if (msg.includes('insufficient')) {
      return { ok: false, code: 'insufficient', message: 'Insufficient escrow balance.' }
    }
    if (msg.includes('duplicate') || msg.includes('23505')) {
      return { ok: false, code: 'duplicate_tx', message: 'This transaction was already recorded.' }
    }
    return { ok: false, code: 'rpc_error', message: msg || 'Could not finalize withdrawal.' }
  }
}
