/** OwlSend-specific confirm timeout copy (shared confirm helper defaults to raffle language). */
export const OWL_SEND_CONFIRM_TIMEOUT_HINT =
  'Check your wallet activity or Solscan. If the transfer already succeeded, dismiss and reload assets — common on mobile when the RPC lags after you return from the wallet app.'

export const OWL_SEND_CONFIRM_TIMEOUT_MS = 90_000

/** Max time to resolve holders + build the tx before opening the wallet (RPC can hang). */
export const OWL_SEND_BUILD_TIMEOUT_MS = 45_000

export const OWL_SEND_BUILD_TIMEOUT_HINT =
  'RPC is too slow to build this batch. Check WiFi/mobile data, try again, or send fewer NFTs per batch.'

/** Race a promise so a stuck RPC cannot leave the UI on BUILDING forever. */
export async function withOwlSendTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
