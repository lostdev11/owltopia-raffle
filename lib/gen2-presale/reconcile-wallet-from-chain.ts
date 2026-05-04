import { Connection, PublicKey } from '@solana/web3.js'

import { executeGen2PresaleConfirmWithQuantitySearch } from '@/lib/gen2-presale/confirm-core'
import { getGen2PresalePublicOffer } from '@/lib/gen2-presale/config'
import { getBalanceByWallet, sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import type { Gen2PresaleBalance, Gen2PresaleStats } from '@/lib/gen2-presale/types'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** Default number of recent signatures to scan per wallet (newest first). */
export const GEN2_RECONCILE_DEFAULT_SIG_LIMIT = 30
export const GEN2_RECONCILE_MAX_SIG_LIMIT = 80

export type ReconcileWalletFromChainSuccess = {
  ok: true
  wallet: string
  signature_limit: number
  /** Signatures returned by RPC for this wallet. */
  rpc_signatures: number
  skipped_already_recorded: number
  skipped_signature_failed_on_chain: number
  /** Signatures we attempted to match as presale (not already in DB). */
  scanned: number
  inserted: number
  inserted_rows: { signature: string; quantity: number }[]
  balance: Gen2PresaleBalance
  stats: Pick<Gen2PresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
}

export type ReconcileWalletFromChainFailure = { ok: false; error: string }

/**
 * Walk recent on-chain transactions for a wallet, verify any that look like Gen2 presale
 * payments, and insert missing rows (same rules as POST /api/gen2-presale/confirm).
 */
export async function reconcileGen2PresaleWalletFromChain(params: {
  wallet: string
  signatureLimit?: number
}): Promise<ReconcileWalletFromChainSuccess | ReconcileWalletFromChainFailure> {
  const wallet = normalizeSolanaWalletAddress(params.wallet)
  if (!wallet) {
    return { ok: false, error: 'Invalid wallet' }
  }

  const signatureLimit = Math.min(
    GEN2_RECONCILE_MAX_SIG_LIMIT,
    Math.max(1, Math.floor(params.signatureLimit ?? GEN2_RECONCILE_DEFAULT_SIG_LIMIT))
  )

  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  let sigInfos: Awaited<ReturnType<Connection['getSignaturesForAddress']>>
  try {
    sigInfos = await connection.getSignaturesForAddress(new PublicKey(wallet), { limit: signatureLimit })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'RPC failed listing signatures'
    return { ok: false, error: msg }
  }

  const db = getSupabaseAdmin()
  const inserted_rows: { signature: string; quantity: number }[] = []
  let skipped_already_recorded = 0
  let skipped_signature_failed_on_chain = 0
  let scanned = 0
  let inserted = 0

  for (const info of sigInfos) {
    if (info.err) {
      skipped_signature_failed_on_chain++
      continue
    }

    const sig = info.signature

    const { data: existing } = await db
      .from('gen2_presale_purchases')
      .select('tx_signature')
      .eq('tx_signature', sig)
      .maybeSingle()

    if (existing) {
      skipped_already_recorded++
      continue
    }

    scanned++

    const r = await executeGen2PresaleConfirmWithQuantitySearch({
      buyerWallet: wallet,
      txSignature: sig,
    })

    if (r.ok && r.inserted) {
      inserted++
      inserted_rows.push({ signature: sig, quantity: r.quantity })
    }
  }

  const balRow = await getBalanceByWallet(wallet)
  const offer = getGen2PresalePublicOffer()
  const sold = await sumConfirmedPresaleSold()
  const remaining = Math.max(0, offer.presaleSupply - sold)
  const percent_sold = offer.presaleSupply > 0 ? (sold / offer.presaleSupply) * 100 : 0

  const balance: Gen2PresaleBalance =
    balRow ?? {
      wallet,
      purchased_mints: 0,
      gifted_mints: 0,
      used_mints: 0,
      available_mints: 0,
    }

  return {
    ok: true,
    wallet,
    signature_limit: signatureLimit,
    rpc_signatures: sigInfos.length,
    skipped_already_recorded,
    skipped_signature_failed_on_chain,
    scanned,
    inserted,
    inserted_rows,
    balance,
    stats: {
      presale_supply: offer.presaleSupply,
      sold,
      remaining,
      percent_sold,
    },
  }
}
