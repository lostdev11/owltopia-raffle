/**
 * Spot USD prices for Solana mints — Jupiter lite API (v3 then v2) only.
 * Used to suggest raffle floor (listing currency) for partner token prizes (no Helius DAS fallback).
 */

const JUPITER_LITE_ENDPOINTS = ['https://lite-api.jup.ag/price/v3', 'https://lite-api.jup.ag/price/v2'] as const

function parseJupiterEntry(entry: unknown): number | null {
  if (!entry || typeof entry !== 'object') return null
  const e = entry as Record<string, unknown>
  const raw = e.usdPrice ?? e.price
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Read price for `mint` from Jupiter v2 (`data[mint]`) or v3-style flat `json[mint]`. */
function extractMintUsdFromJupiterJson(json: unknown, mint: string): number | null {
  if (!json || typeof json !== 'object') return null
  const root = json as Record<string, unknown>
  if (root.data && typeof root.data === 'object') {
    const inner = (root.data as Record<string, unknown>)[mint]
    const p = parseJupiterEntry(inner)
    if (p != null) return p
  }
  const flat = root[mint]
  return parseJupiterEntry(flat)
}

export type TokenUsdPriceSource = 'jupiter' | 'helius' | 'none'

export async function fetchUsdPricesForMints(mints: string[]): Promise<{
  prices: Record<string, number>
  source: TokenUsdPriceSource
}> {
  const unique = [...new Set(mints.map((m) => m.trim()).filter(Boolean))]
  if (unique.length === 0) return { prices: {}, source: 'none' }

  const ids = unique.join(',')
  for (const base of JUPITER_LITE_ENDPOINTS) {
    try {
      const url = `${base}?ids=${encodeURIComponent(ids)}`
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      const json: unknown = await res.json().catch(() => null)
      const prices: Record<string, number> = {}
      for (const mint of unique) {
        const p = extractMintUsdFromJupiterJson(json, mint)
        if (p != null) prices[mint] = p
      }
      if (Object.keys(prices).length > 0) {
        return { prices, source: 'jupiter' }
      }
    } catch {
      // try next endpoint
    }
  }

  return { prices: {}, source: 'none' }
}

/**
 * USD price per token unit for each mint (Jupiter only).
 */
export async function resolveUsdPricesForMints(mints: string[]): Promise<{
  prices: Record<string, number>
  source: TokenUsdPriceSource
}> {
  return fetchUsdPricesForMints(mints)
}
