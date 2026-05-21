/** Client fetch helper — avoids indefinite "Warming up your nest" when heal/RPC is slow. */

import { isMobileDevice } from '@/lib/utils'

export const NESTING_POSITIONS_FETCH_TIMEOUT_MS = 28_000
export const NESTING_CLAIM_FETCH_TIMEOUT_MS = 55_000

export type NestingFetchJsonResult<T> = {
  ok: boolean
  status: number
  json: T | null
  /** No HTTP response (timeout, abort, or browser "Failed to fetch"). */
  timedOut: boolean
  aborted: boolean
  /** True when our client timer fired (vs immediate network drop). */
  clientTimeout: boolean
}

/** Absolute same-origin URL — wallet in-app browsers sometimes break relative `/api/...` fetch. */
export function nestingClientApiUrl(path: string): string {
  if (typeof window === 'undefined') return path
  if (/^https?:\/\//i.test(path)) return path
  const p = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${p}`
}

function isLikelyFetchNetworkOrTimeout(e: unknown): boolean {
  if (!(e instanceof Error)) return true
  if (e.name === 'AbortError') return true
  const m = e.message.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('load failed') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('the operation was aborted') ||
    m.includes('aborted')
  )
}

export async function fetchNestingJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<NestingFetchJsonResult<T>> {
  const { timeoutMs = NESTING_POSITIONS_FETCH_TIMEOUT_MS, ...fetchInit } = init
  const resolvedUrl = nestingClientApiUrl(url)
  const controller = new AbortController()
  let clientTimeout = false
  const timeoutId = setTimeout(() => {
    clientTimeout = true
    controller.abort()
  }, timeoutMs)
  try {
    const res = await fetch(resolvedUrl, { ...fetchInit, signal: controller.signal })
    const json = (await res.json().catch(() => null)) as T | null
    return { ok: res.ok, status: res.status, json, timedOut: false, aborted: false, clientTimeout: false }
  } catch (e) {
    const networkOrTimeout = isLikelyFetchNetworkOrTimeout(e)
    return {
      ok: false,
      status: 0,
      json: null,
      timedOut: networkOrTimeout,
      aborted: e instanceof Error && e.name === 'AbortError',
      clientTimeout,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/** User-facing copy when fetch never got an HTTP response (common in Phantom/Solflare in-app browsers). */
export function nestingFetchNetworkErrorMessage(kind: 'positions' | 'claim' | 'generic'): string {
  const mobile = typeof window !== 'undefined' && isMobileDevice()
  if (kind === 'claim') {
    return mobile
      ? 'Could not reach Owltopia to finish your claim (wallet browser lost the connection). Wait a few seconds, refresh, and check your OWL balance before claiming again. If it repeats, open owltopia.xyz in Safari or Chrome, connect the same wallet, and claim there.'
      : 'Could not reach the server to finish your claim. Refresh the page and check your OWL balance before trying again.'
  }
  if (kind === 'positions') {
    return mobile
      ? 'Could not load your nest (wallet browser connection dropped). Try WiFi or mobile data, wait a few seconds, and tap Retry. If you still see "Failed to fetch", open the site in Safari or Chrome instead of only inside the wallet app, then connect the same wallet.'
      : 'Could not load your nest — the connection to Owltopia was interrupted. Check your network and tap Retry.'
  }
  return mobile
    ? 'Network error — try again on WiFi or mobile data, or open the site in your phone\'s browser.'
    : 'Network error — check your connection and try again.'
}

export function nestingFetchTimeoutMessage(kind: 'positions' | 'claim'): string {
  if (kind === 'claim') {
    return 'Claim is taking longer than usual. Wait a moment, refresh the page, and check your wallet OWL balance before trying again.'
  }
  return 'Loading your nest is taking longer than usual. Pull to refresh or tap Retry — your nests are safe; chain sync may still be running.'
}

export function formatNestingApiFetchError(
  err: unknown,
  kind: 'positions' | 'claim' | 'generic' = 'generic'
): string {
  if (isLikelyFetchNetworkOrTimeout(err)) {
    return nestingFetchNetworkErrorMessage(kind)
  }
  if (err instanceof Error && err.message.trim()) {
    const m = err.message.toLowerCase()
    if (m.includes('failed to fetch') || m.includes('load failed')) {
      return nestingFetchNetworkErrorMessage(kind)
    }
    return err.message
  }
  return kind === 'claim' ? 'Claim failed' : kind === 'positions' ? 'Failed to load positions' : 'Request failed'
}
