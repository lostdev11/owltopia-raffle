/**
 * Owl Council OWL escrow balances (Supabase + RPCs from migration 075).
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin'

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

export async function rpcFinalizeCouncilEscrowWithdrawal(
  wallet: string,
  amountRaw: bigint,
  txSignature: string
): Promise<{ ok: true } | { ok: false; code: 'duplicate_tx' | 'insufficient' | 'rpc_error'; message: string }> {
  const w = wallet.trim()
  const sig = txSignature.trim()
  if (!w || !sig || amountRaw <= 0n) {
    return { ok: false, code: 'rpc_error', message: 'Invalid withdrawal parameters.' }
  }

  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.rpc('owl_council_escrow_finalize_withdrawal', {
      p_wallet: w,
      p_delta_raw: amountRaw.toString(),
      p_sig: sig,
    })

    if (!error) return { ok: true }

    const msg = error.message || ''
    if (msg.includes('duplicate') || msg.includes('23505') || msg.includes('duplicate_tx')) {
      return { ok: false, code: 'duplicate_tx', message: 'This transaction was already recorded.' }
    }
    if (msg.includes('insufficient')) {
      return { ok: false, code: 'insufficient', message: 'Insufficient escrow balance.' }
    }
    return { ok: false, code: 'rpc_error', message: msg || 'Could not finalize withdrawal.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('insufficient')) {
      return { ok: false, code: 'insufficient', message: 'Insufficient escrow balance.' }
    }
    if (msg.includes('duplicate') || msg.includes('23505')) {
      return { ok: false, code: 'duplicate_tx', message: 'This transaction was already recorded.' }
    }
    return { ok: false, code: 'rpc_error', message: msg || 'Could not finalize withdrawal.' }
  }
}
