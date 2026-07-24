import type { WalletNft } from '@/lib/solana/wallet-tokens'

const RETRY_DELAY_MS = 1200

export type WalletNftsApiResult = {
  /** Last response received, if any (null when both attempts hit network errors). */
  res: Response | null
  nfts: WalletNft[]
}

/**
 * `GET /api/wallet/nfts` with one retry. Helius DAS intermittently 429s/5xxs or returns an
 * empty page for wallets that do hold NFTs (indexer hiccups) — the single biggest cause of
 * "my NFTs don't show until I reload" reports from Phantom's in-app browser. A short retry
 * recovers most of those without falling back to the metadata-less client RPC path.
 */
export async function fetchWalletNftsWithRetry(walletAddr: string): Promise<WalletNftsApiResult> {
  let last: Response | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`/api/wallet/nfts?wallet=${encodeURIComponent(walletAddr)}`, {
        credentials: 'include',
      })
      last = res
      if (res.ok) {
        const data = await res.json().catch(() => null)
        const nfts: WalletNft[] = Array.isArray(data) ? data : []
        // Empty on the first attempt may be a transient DAS miss; confirm before trusting it.
        if (nfts.length > 0 || attempt > 0) return { res, nfts }
      } else if (res.status === 503) {
        // Not configured (no HELIUS_API_KEY) — retrying cannot help; caller falls back to RPC.
        return { res, nfts: [] }
      }
    } catch {
      /* network error — retry below */
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
  }
  return { res: last, nfts: [] }
}
