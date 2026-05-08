import { Connection, PublicKey } from '@solana/web3.js'

import { executeGen2PresaleConfirmWithQuantitySearch } from '@/lib/gen2-presale/confirm-core'
import { fetchSignaturesForAddressPaginated } from '@/lib/gen2-presale/fetch-signatures-paginated'
import { getGen2PresalePublicOffer } from '@/lib/gen2-presale/config'
import { getBalanceByWallet, sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import type { Gen2PresaleBalance, Gen2PresaleStats } from '@/lib/gen2-presale/types'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** Default page size for each RPC `getSignaturesForAddress` call (Solana max is 1000). */
export const GEN2_RECONCILE_PAGE_SIZE_DEFAULT = 100
/** Default number of pages (buyer wallet history may be long). */
export const GEN2_RECONCILE_MAX_PAGES_DEFAULT = 20
export const GEN2_RECONCILE_PAGE_SIZE_MAX = 1000
export const GEN2_RECONCILE_MAX_PAGES_CAP = 60

/** Legacy single-request scan limit when callers pass only {@link signatureLimit}. */
export const GEN2_RECONCILE_DEFAULT_SIG_LIMIT = 30
/** Upper bound for legacy single-request scans. */
export const GEN2_RECONCILE_LEGACY_SIG_LIMIT_MAX = 1000

export type ReconcileWalletFromChainSuccess = {
  ok: true
  wallet: string
  signature_limit?: number
  page_size: number
  max_pages: number
  pages_fetched: number
  /** Signatures returned by RPC for this wallet (after pagination). */
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
 * Walk on-chain transactions for a wallet, verify any Gen2 presale payments, and insert missing rows.
 *
 * Prefer {@link pageSize} + {@link maxPages} for deep scans; legacy callers may pass only
 * {@link signatureLimit} for a single-page fetch.
 */
export async function reconcileGen2PresaleWalletFromChain(params: {
  wallet: string
  /** Legacy: one RPC call with this limit (max {@link GEN2_RECONCILE_LEGACY_SIG_LIMIT_MAX}). */
  signatureLimit?: number
  pageSize?: number
  maxPages?: number
}): Promise<ReconcileWalletFromChainSuccess | ReconcileWalletFromChainFailure> {
  const wallet = normalizeSolanaWalletAddress(params.wallet)
  if (!wallet) {
    return { ok: false, error: 'Invalid wallet' }
  }

  /** Single RPC page — only when explicitly passing legacy `signatureLimit` alone. */
  const legacyOnly =
    params.signatureLimit != null && params.pageSize == null && params.maxPages == null

  let pageSize: number
  let maxPages: number
  let legacySignatureLimit: number | undefined

  if (legacyOnly) {
    legacySignatureLimit = Math.min(
      GEN2_RECONCILE_LEGACY_SIG_LIMIT_MAX,
      Math.max(1, Math.floor(params.signatureLimit as number))
    )
    pageSize = legacySignatureLimit
    maxPages = 1
  } else {
    pageSize = Math.min(
      GEN2_RECONCILE_PAGE_SIZE_MAX,
      Math.max(1, Math.floor(params.pageSize ?? GEN2_RECONCILE_PAGE_SIZE_DEFAULT))
    )
    maxPages = Math.min(
      GEN2_RECONCILE_MAX_PAGES_CAP,
      Math.max(1, Math.floor(params.maxPages ?? GEN2_RECONCILE_MAX_PAGES_DEFAULT))
    )
  }

  const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
  let sigInfos: Awaited<ReturnType<Connection['getSignaturesForAddress']>>
  let pagesFetched: number

  try {
    if (legacyOnly) {
      sigInfos = await connection.getSignaturesForAddress(new PublicKey(wallet), {
        limit: legacySignatureLimit!,
      })
      pagesFetched = 1
    } else {
      const res = await fetchSignaturesForAddressPaginated(
        connection,
        new PublicKey(wallet),
        pageSize,
        maxPages
      )
      sigInfos = res.signatures
      pagesFetched = res.pagesFetched
    }
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
    ...(legacySignatureLimit != null ? { signature_limit: legacySignatureLimit } : {}),
    page_size: pageSize,
    max_pages: maxPages,
    pages_fetched: pagesFetched,
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
