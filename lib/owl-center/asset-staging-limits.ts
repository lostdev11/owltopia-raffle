/** Supabase Storage bucket for staged Sugar ZIP packages (private). */
export const OWL_CENTER_STAGING_BUCKET = 'owl-center-asset-staging'

/** Max staged ZIP size (2 GB). Keep in sync with the bucket file_size_limit (migration 172). */
export const OWL_CENTER_STAGED_ZIP_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** Validate synchronously on upload when ZIP is below this (80 MB). */
export const OWL_CENTER_SYNC_VALIDATE_MAX_BYTES = 80 * 1024 * 1024

export type ArweaveUploadBatchMode = 'tick' | 'full'

/**
 * Parallel Irys uploads within a single batch. Each upload is an independent
 * bundler tx against the pre-funded balance, so uploading many at once is the
 * biggest throughput win (sequential one-at-a-time was the bottleneck).
 */
export function owlCenterAssetUploadConcurrency(): number {
  const raw = process.env.OWL_CENTER_ASSET_UPLOAD_CONCURRENCY
  const n = raw ? Number.parseInt(raw, 10) : 30
  if (!Number.isFinite(n) || n < 1) return 30
  return Math.min(n, 40)
}

/**
 * Files uploaded between DB checkpoints within one ZIP load. The staged ZIP is
 * downloaded + parsed once per invocation, then we stream chunks of this size
 * (buffers read lazily at `concurrency`), so memory stays bounded while a single
 * download serves the whole collection instead of re-downloading per chunk.
 */
export function owlCenterAssetUploadChunkSize(): number {
  const raw = process.env.OWL_CENTER_ASSET_UPLOAD_CHUNK
  const n = raw ? Number.parseInt(raw, 10) : 250
  if (!Number.isFinite(n) || n < 1) return 250
  return Math.min(n, 1000)
}

/**
 * Wall-clock budget for one upload invocation. Both the cron tick and the admin
 * full push keep uploading (from a single ZIP download) until the collection is
 * done or this budget elapses, then checkpoint and resume next run. Kept under
 * the route `maxDuration` (300s) with headroom for the final DB writes.
 */
export function owlCenterAssetUploadTimeBudgetMs(mode: ArweaveUploadBatchMode = 'tick'): number {
  const raw = process.env.OWL_CENTER_ASSET_UPLOAD_TIME_BUDGET_MS
  const n = raw ? Number.parseInt(raw, 10) : NaN
  if (Number.isFinite(n) && n >= 10_000) return Math.min(n, 290_000)
  return mode === 'full' ? 280_000 : 230_000
}
