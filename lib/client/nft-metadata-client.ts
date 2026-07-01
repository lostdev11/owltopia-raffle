export type MintNftMetadata = {
  image: string | null
  name: string | null
}

const EMPTY_META: MintNftMetadata = { image: null, name: null }
const BATCH_SIZE = 12
const FLUSH_MS = 48
const MAX_IN_FLIGHT_BATCHES = 2

const cache = new Map<string, MintNftMetadata>()
const inflight = new Map<string, Promise<MintNftMetadata>>()

type QueueEntry = {
  mint: string
  preferMainnet: boolean
  resolve: (meta: MintNftMetadata) => void
}

let queue: QueueEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let inFlightBatches = 0

function cacheKey(mint: string, preferMainnet: boolean): string {
  return `${preferMainnet ? 'm:' : ''}${mint}`
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void drainQueue()
  }, FLUSH_MS)
}

async function drainQueue() {
  while (queue.length > 0 && inFlightBatches < MAX_IN_FLIGHT_BATCHES) {
    const batch = queue.splice(0, BATCH_SIZE)
    if (!batch.length) break
    inFlightBatches += 1
    void runBatch(batch).finally(() => {
      inFlightBatches -= 1
      if (queue.length) scheduleFlush()
    })
  }
}

async function runBatch(batch: QueueEntry[]) {
  const preferMainnet = batch[0]?.preferMainnet === true
  const mints = batch.map((b) => b.mint)
  try {
    const res = await fetch('/api/nft/metadata-image/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mints, preferMainnet }),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => ({}))) as {
      items?: Record<string, MintNftMetadata | undefined>
      error?: string
    }
    if (!res.ok) throw new Error(json.error || 'batch_failed')

    for (const entry of batch) {
      const key = cacheKey(entry.mint, entry.preferMainnet)
      const meta = json.items?.[entry.mint] ?? EMPTY_META
      const normalized: MintNftMetadata = {
        image: meta.image ?? null,
        name: meta.name ?? null,
      }
      cache.set(key, normalized)
      inflight.delete(key)
      entry.resolve(normalized)
    }
  } catch {
    for (const entry of batch) {
      const key = cacheKey(entry.mint, entry.preferMainnet)
      cache.set(key, EMPTY_META)
      inflight.delete(key)
      entry.resolve(EMPTY_META)
    }
  }
}

/** Batched, cached metadata lookup for mint grids (avoids dozens of parallel GETs). */
export function fetchMintNftMetadata(mint: string, preferMainnet: boolean): Promise<MintNftMetadata> {
  const id = mint.trim()
  if (!id) return Promise.resolve(EMPTY_META)

  const key = cacheKey(id, preferMainnet)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)

  const pending = inflight.get(key)
  if (pending) return pending

  const promise = new Promise<MintNftMetadata>((resolve) => {
    queue.push({ mint: id, preferMainnet, resolve })
    scheduleFlush()
  })
  inflight.set(key, promise)
  return promise
}
