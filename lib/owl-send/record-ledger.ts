import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import type { OwlSendLedgerAssetKind, OwlSendLedgerLine, OwlSendLedgerMode } from '@/lib/db/owl-send-ledger'
import { OwlSendSolscanTxUrl } from '@/lib/owl-send/explorer'
import { fetchSiwsSessionWallet } from '@/hooks/use-siws-session'

export type RecordOwlSendLedgerParams = {
  fromWallet: string
  mode: OwlSendLedgerMode
  assetKind: OwlSendLedgerAssetKind
  txSignature: string
  lines: OwlSendLedgerLine[]
  batchIndex?: number | null
  /**
   * Optional: ensure SIWS cookie matches fromWallet (sign message / memo-tx).
   * Called when session is missing or for a different wallet. Return true if signed in.
   */
  ensureSiws?: () => Promise<boolean>
}

/** Best-effort: record a confirmed OwlSend tx. Never throws — ledger must not break send UX. */
export async function recordOwlSendLedger(params: RecordOwlSendLedgerParams): Promise<void> {
  try {
    let sessionWallet = await fetchSiwsSessionWallet()
    if (sessionWallet !== params.fromWallet && params.ensureSiws) {
      const ok = await params.ensureSiws()
      if (!ok) return
      sessionWallet = await fetchSiwsSessionWallet()
    }
    if (sessionWallet !== params.fromWallet) return

    const feeLamports = getOwlSendFeeLamportsForCount(params.lines.length)
    const post = () =>
      fetch('/api/owl-send/ledger', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-connected-wallet': params.fromWallet,
        },
        body: JSON.stringify({
          fromWallet: params.fromWallet,
          mode: params.mode,
          assetKind: params.assetKind,
          txSignature: params.txSignature,
          lines: params.lines,
          feeLamports,
          batchIndex: params.batchIndex ?? null,
        }),
      })

    let res = await post()
    if (res.status === 401 && params.ensureSiws) {
      const ok = await params.ensureSiws()
      if (!ok) return
      res = await post()
    }
    // Ignore non-OK — send already succeeded on-chain
    void res
  } catch {
    /* ignore */
  }
}

export function ledgerModeLabel(mode: OwlSendLedgerMode): string {
  switch (mode) {
    case 'nft_one':
      return 'NFTs → one wallet'
    case 'nft_scatter':
      return 'NFTs → many wallets'
    case 'token_one':
      return 'Tokens → one wallet'
    case 'token_scatter':
      return 'Tokens → many wallets'
    default:
      return mode
  }
}

export { OwlSendSolscanTxUrl }
