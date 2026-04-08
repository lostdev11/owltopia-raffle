/**
 * Helius DAS burn flag for a single asset (getAsset).
 */
import { getHeliusRpcUrl } from '@/lib/helius-rpc-url'

const FETCH_TIMEOUT_MS = 4_500

/**
 * True when Helius DAS reports the asset as burned.
 * False if Helius is not configured, the request fails, or `burnt` is absent/false.
 */
export async function isNftBurntPerHeliusDas(assetId: string): Promise<boolean> {
  const id = assetId.trim()
  if (!id) return false

  const heliusUrl = getHeliusRpcUrl()
  if (!heliusUrl) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'helius-das-burn-check',
        method: 'getAsset',
        params: { id },
      }),
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return false
    const json: { result?: { burnt?: boolean }; error?: unknown } = await res.json().catch(() => ({}))
    if (json.error) return false
    return json.result?.burnt === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
