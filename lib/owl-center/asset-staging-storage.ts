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

/**
 * Stream an HTTP body into a single Buffer. When Content-Length is known the
 * buffer is pre-allocated and chunks are copied straight in, so peak memory is
 * ~1× the file instead of the ~3× (Blob + arrayBuffer + Buffer) that the SDK's
 * .download() incurs — the difference between fitting in the function and OOM
 * on ~1GB ZIPs.
 */
async function streamResponseToBuffer(res: Response): Promise<Buffer> {
  if (!res.ok || !res.body) throw new Error(`staged ZIP fetch failed (${res.status})`)
  const declaredLength = Number(res.headers.get('content-length') ?? 0)

  if (Number.isFinite(declaredLength) && declaredLength > 0) {
    const out = Buffer.allocUnsafe(declaredLength)
    let offset = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      buf.copy(out, offset)
      offset += buf.length
    }
    return offset === out.length ? out : out.subarray(0, offset)
  }

  const chunks: Buffer[] = []
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function downloadStagedSugarZip(storagePath: string): Promise<Buffer | null> {
  const admin = getSupabaseAdmin()

  // Prefer a signed URL + streamed fetch so we never hold the Blob, its
  // arrayBuffer, and the Buffer (~3× the file) in memory simultaneously.
  try {
    const { data: signed, error: signError } = await admin.storage
      .from(OWL_CENTER_STAGING_BUCKET)
      .createSignedUrl(storagePath, 600)
    if (!signError && signed?.signedUrl) {
      return await streamResponseToBuffer(await fetch(signed.signedUrl))
    }
    if (signError) console.error('downloadStagedSugarZip signed-url', signError)
  } catch (e) {
    console.error('downloadStagedSugarZip stream', e)
  }

  // Fallback: SDK download (fully buffers in memory).
  const { data, error } = await admin.storage.from(OWL_CENTER_STAGING_BUCKET).download(storagePath)
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
