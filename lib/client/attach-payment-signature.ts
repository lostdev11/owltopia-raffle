/**
 * Persist payment TX on pending/rejected entries immediately after wallet send,
 * so a second checkout cannot orphan an in-flight payment.
 *
 * Mobile-hardened: the tab is often still backgrounded (returning from the wallet
 * app) when this runs, so a single fetch can be dropped. We retry with backoff and
 * use `keepalive` so an in-flight request survives tab backgrounding/navigation.
 */

const ATTACH_BACKOFF_MS = [0, 800, 2000]

async function postAttachWithRetries(body: Record<string, unknown>): Promise<boolean> {
  for (const delay of ATTACH_BACKOFF_MS) {
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
    try {
      const res = await fetch('/api/entries/attach-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify(body),
      })
      if (res.ok) return true
      // 400 is definitive (wallet mismatch, sig already used elsewhere) — retrying won't help.
      if (res.status === 400 || res.status === 404) return false
      // 429/5xx: retry after backoff.
    } catch {
      /* network drop right after wallet return — retry */
    }
  }
  return false
}

export async function attachPaymentSignature(input: {
  entryId: string
  transactionSignature: string
  walletAddress: string
}): Promise<boolean> {
  return postAttachWithRetries(input)
}

export async function attachPaymentSignaturesBatch(input: {
  entryIds: string[]
  transactionSignature: string
  walletAddress: string
}): Promise<boolean> {
  return postAttachWithRetries(input)
}
