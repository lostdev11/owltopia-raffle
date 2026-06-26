export type CollectionConfirmMintBody = {
  wallet: string
  txSignature: string
  quantity: number
  phase: string
  mintedNftMints: string[]
  network: string
}

export type CollectionConfirmMintResponse = {
  ok?: boolean
  error?: string
  duplicate_tx?: boolean
}

const CONFIRM_RETRY_DELAYS_MS = [0, 300, 700, 1500] as const
const CONFIRM_HARD_MAX_MS = 12_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** POST confirm-mint with retries — mints succeed on-chain before DB record is written. */
export async function postCollectionConfirmMintWithRetry(
  slug: string,
  body: CollectionConfirmMintBody
): Promise<CollectionConfirmMintResponse> {
  let lastError = 'confirm_failed'
  let lastJson: CollectionConfirmMintResponse = {}
  const started = Date.now()

  for (const delayMs of CONFIRM_RETRY_DELAYS_MS) {
    if (Date.now() - started >= CONFIRM_HARD_MAX_MS) break
    if (delayMs > 0) await sleep(delayMs)
    if (Date.now() - started >= CONFIRM_HARD_MAX_MS) break

    try {
      const res = await fetch(`/api/owl-center/collections/${encodeURIComponent(slug)}/confirm-mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // Let the confirm finish even if the user navigates away / the mobile tab is backgrounded
        // right after the wallet returns (small JSON, well under the 64KB keepalive cap).
        keepalive: true,
      })
      const json = (await res.json()) as CollectionConfirmMintResponse
      lastJson = json

      if (res.ok && json.ok) return json

      const err = json.error ?? 'confirm_failed'
      lastError = err

      if (res.status === 409 && /already recorded/i.test(err)) {
        return { ok: true, duplicate_tx: true }
      }
      if (res.status === 400 && /already recorded/i.test(err)) {
        return { ok: true, duplicate_tx: true }
      }
    } catch {
      lastError = 'confirm_failed'
    }
  }

  throw new Error(lastJson.error ?? lastError)
}
