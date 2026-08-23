import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type CoinArtUpgradeUploadJobStatus =
  | 'queued'
  | 'validating'
  | 'validated'
  | 'uploading'
  | 'seeding'
  | 'completed'
  | 'failed'

export type CoinArtUpgradeUploadFileEntry = {
  path: string
  kind: 'image' | 'metadata' | 'other'
  index: number | null
  /** Set after Irys upload succeeds for this file. */
  uri?: string
}

export type CoinArtUpgradeUploadProgress = {
  staged_zip_bytes?: number
  total_files?: number
  uploaded_files?: number
  file_list?: CoinArtUpgradeUploadFileEntry[]
  /** coin_number → { image, metadata } after Irys. */
  manifest?: Record<string, { image: string; metadata: string }>
  catalog_upserted?: number
  catalog_skipped?: number
}

export type CoinArtUpgradeValidationScan = {
  ok: boolean
  pair_count: number
  missing_png: number[]
  missing_json: number[]
  other_files: number
  error?: string
}

export type CoinArtUpgradeUploadJob = {
  id: string
  staged_zip_path: string
  original_filename: string | null
  status: CoinArtUpgradeUploadJobStatus
  validation_scan: CoinArtUpgradeValidationScan | null
  upload_progress: CoinArtUpgradeUploadProgress
  error_message: string | null
  created_by: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

function emptyProgress(): CoinArtUpgradeUploadProgress {
  return {}
}

function parseProgress(raw: unknown): CoinArtUpgradeUploadProgress {
  if (!raw || typeof raw !== 'object') return emptyProgress()
  return raw as CoinArtUpgradeUploadProgress
}

function mapRow(row: Record<string, unknown>): CoinArtUpgradeUploadJob {
  return {
    id: String(row.id),
    staged_zip_path: String(row.staged_zip_path),
    original_filename: row.original_filename != null ? String(row.original_filename) : null,
    status: String(row.status) as CoinArtUpgradeUploadJobStatus,
    validation_scan: (row.validation_scan as CoinArtUpgradeValidationScan | null) ?? null,
    upload_progress: parseProgress(row.upload_progress),
    error_message: row.error_message != null ? String(row.error_message) : null,
    created_by: row.created_by != null ? String(row.created_by) : null,
    started_at: row.started_at != null ? String(row.started_at) : null,
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export async function getCoinArtUpgradeUploadJobById(
  jobId: string
): Promise<CoinArtUpgradeUploadJob | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_upload_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()
  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function getLatestCoinArtUpgradeUploadJob(): Promise<CoinArtUpgradeUploadJob | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_upload_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function insertCoinArtUpgradeUploadJob(input: {
  staged_zip_path: string
  original_filename: string | null
  created_by: string | null
  staged_zip_bytes?: number
}): Promise<{ job: CoinArtUpgradeUploadJob | null; error: string | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_upload_jobs')
    .insert({
      staged_zip_path: input.staged_zip_path,
      original_filename: input.original_filename,
      created_by: input.created_by,
      status: 'queued',
      upload_progress: {
        staged_zip_bytes: input.staged_zip_bytes ?? 0,
      },
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error || !data) {
    console.error('insertCoinArtUpgradeUploadJob', error)
    const msg = error?.message?.trim() || 'Insert returned no row.'
    const missingTable =
      /relation .*coin_art_upgrade_upload_jobs.* does not exist/i.test(msg) ||
      /Could not find the table/i.test(msg)
    return {
      job: null,
      error: missingTable
        ? 'Missing table coin_art_upgrade_upload_jobs — apply migration 220 (or 227) in Supabase.'
        : `Could not create upload job: ${msg}`,
    }
  }
  return { job: mapRow(data as Record<string, unknown>), error: null }
}

export async function updateCoinArtUpgradeUploadJob(
  jobId: string,
  patch: Partial<{
    status: CoinArtUpgradeUploadJobStatus
    validation_scan: CoinArtUpgradeValidationScan | null
    upload_progress: CoinArtUpgradeUploadProgress
    error_message: string | null
    completed_at: string | null
  }>
): Promise<CoinArtUpgradeUploadJob | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_upload_jobs')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select('*')
    .single()
  if (error || !data) {
    console.error('updateCoinArtUpgradeUploadJob', error)
    return null
  }
  return mapRow(data as Record<string, unknown>)
}

export async function listCoinArtUpgradeUploadJobsForWorker(
  limit = 2
): Promise<CoinArtUpgradeUploadJob[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('coin_art_upgrade_upload_jobs')
    .select('*')
    .in('status', ['queued', 'uploading', 'seeding'])
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapRow)
}

export async function upsertCoinArtUpgradeCatalogRows(
  rows: Array<{
    asset_id: string
    coin_number: number
    name: string | null
    new_uri: string
    new_image_uri: string | null
    original_uri: string | null
  }>
): Promise<number> {
  if (rows.length === 0) return 0
  const CHUNK = 500
  let upserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await getSupabaseAdmin()
      .from('coin_art_upgrade_catalog')
      .upsert(chunk, { onConflict: 'asset_id' })
    if (error) throw new Error(error.message)
    upserted += chunk.length
  }
  return upserted
}
