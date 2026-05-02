/**
 * Live SOL/USD for Gen2 presale (Jupiter lite API, ~60s in-process cache).
 * Fetched on demand; stale cache is returned if a recent fetch exists and Jupiter fails on refresh.
 */
import { NATIVE_MINT } from '@solana/spl-token'

import { fetchUsdPricesForMints } from '@/lib/partner-token-price-fetch'

const WSOL_MINT = NATIVE_MINT.toBase58()
const CACHE_MS = 60_000

type SolUsdCache = { price: number; fetchedAt: number }

function readGlobalCache(): SolUsdCache | undefined {
  const g = globalThis as typeof globalThis & { __gen2SolUsdCache?: SolUsdCache }
  return g.__gen2SolUsdCache
}

function writeGlobalCache(entry: SolUsdCache): void {
  const g = globalThis as typeof globalThis & { __gen2SolUsdCache?: SolUsdCache }
  g.__gen2SolUsdCache = entry
}

/** USD price of one SOL (spot) via Jupiter WSOL; uses stale cache if refresh fails. */
export async function resolveGen2SolUsdPrice(): Promise<number> {
  const now = Date.now()
  const stale = readGlobalCache()

  if (stale && now - stale.fetchedAt < CACHE_MS) {
    return stale.price
  }

  try {
    const { prices } = await fetchUsdPricesForMints([WSOL_MINT])
    const jup = prices[WSOL_MINT]
    if (jup != null && Number.isFinite(jup) && jup > 0) {
      writeGlobalCache({ price: jup, fetchedAt: now })
      return jup
    }
  } catch {
    // fall through to stale cache or throw
  }

  if (stale) {
    return stale.price
  }

  throw new Error('Could not resolve SOL/USD: Jupiter quote unavailable. Retry shortly.')
}
