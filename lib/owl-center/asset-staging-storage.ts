import { randomUUID } from 'node:crypto'

import {
  OWL_CENTER_STAGED_ZIP_MAX_BYTES,
  OWL_CENTER_STAGING_BUCKET,
} from '@/lib/owl-center/asset-staging-limits'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export function isAllowedStagedZip(file: { name?: string; size: number }): { ok: true } | { ok: false; error: string } {
  if (file.size < 1) return { ok: false, error: 'ZIP file is empty.' }
  if (file.size > OWL_CENTER_STAGED_ZIP_MAX_BYTES) {
    return {
      ok: false,
      error: `ZIP must be ${Math.floor(OWL_CENTER_STAGED_ZIP_MAX_BYTES / (1024 * 1024))}MB or smaller.`,
    }
  }
  const name = (file.name ?? '').toLowerCase()
  if (name && !name.endsWith('.zip')) {
    return { ok: false, error: 'Upload a .zip Sugar export.' }
  }
  return { ok: true }
}

export async function uploadStagedSugarZip(
  scopePrefix: string,
  jobId: string,
  buffer: Buffer,
  originalFilename: string
): Promise<{ path: string } | { error: string }> {
  const check = isAllowedStagedZip({ name: originalFilename, size: buffer.length })
  if (!check.ok) return { error: check.error }

  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || `${randomUUID()}.zip`
  const path = `${scopePrefix}/${jobId}/${safeName}`

  const { error } = await getSupabaseAdmin()
    .storage.from(OWL_CENTER_STAGING_BUCKET)
    .upload(path, buffer, {
      contentType: 'application/zip',
      upsert: false,
    })

  if (error) {
    console.error('uploadStagedSugarZip', error)
    const hint =
      typeof error.message === 'string' && error.message.toLowerCase().includes('bucket')
        ? ' Run migration 143 or create owl-center-asset-staging bucket in Supabase.'
        : ''
    return { error: `Staging upload failed.${hint}` }
  }

  return { path }
}

export async function downloadStagedSugarZip(storagePath: string): Promise<Buffer | null> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(OWL_CENTER_STAGING_BUCKET)
    .download(storagePath)
  if (error || !data) {
    console.error('downloadStagedSugarZip', error)
    return null
  }
  return Buffer.from(await data.arrayBuffer())
}

export async function removeStagedSugarZip(storagePath: string): Promise<void> {
  const { error } = await getSupabaseAdmin().storage.from(OWL_CENTER_STAGING_BUCKET).remove([storagePath])
  if (error) console.error('removeStagedSugarZip', error)
}
