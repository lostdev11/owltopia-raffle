/**
 * Spot USD prices for Solana mints — Jupiter lite API (v3 then v2), then Helius getAsset when configured.
 * Used to suggest raffle floor (listing currency) for partner token prizes.
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

async function fetchHeliusMintUsdPrice(mint: string): Promise<number | null> {
  const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
  if (!heliusApiKey) return null
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'partner-token-helius-price',
        method: 'getAsset',
        params: { id: mint.trim() },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json: {
      result?: { token_info?: { price_info?: { price_per_token?: number; currency?: string } } }
      error?: { message?: string }
    } = await res.json().catch(() => ({}))
    if (json.error) return null
    const v = json.result?.token_info?.price_info?.price_per_token
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

/**
 * USD price per token unit for each mint. Fills gaps from Jupiter using Helius per-mint (when key set).
 */
export async function resolveUsdPricesForMints(mints: string[]): Promise<{
  prices: Record<string, number>
  source: TokenUsdPriceSource
}> {
  const unique = [...new Set(mints.map((m) => m.trim()).filter(Boolean))]
  const { prices: jup, source: jupSource } = await fetchUsdPricesForMints(unique)
  const out = { ...jup }
  let source: TokenUsdPriceSource = jupSource

  for (const mint of unique) {
    if (out[mint] != null) continue
    const h = await fetchHeliusMintUsdPrice(mint)
    if (h != null) {
      out[mint] = h
      if (jupSource !== 'jupiter') source = 'helius'
    }
  }
  if (Object.keys(out).length === 0) return { prices: {}, source: 'none' }
  if (source === 'none') source = 'helius'
  return { prices: out, source }
}
