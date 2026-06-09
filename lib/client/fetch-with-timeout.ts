/**
 * fetch that aborts after `timeoutMs` so checkout never hangs `checkoutBusy`
 * forever on a stalled mobile connection (same pattern as the 30s abort in
 * execute-raffle-purchase's create call). Throws AbortError on timeout, which
 * callers treat like any other network failure.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}
