import { readApiJsonResponse } from '@/lib/fetch-api-json'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'

type StageApiPayload = {
  ok?: boolean
  error?: string
  job?: OwlCenterAssetUploadJob
  validation?: { ok?: boolean; status?: string; error?: string }
}

type PrepareApiPayload = {
  ok?: boolean
  error?: string
  job_id?: string
  path?: string
  signed_url?: string
  token?: string
}

async function uploadBlobToSignedUploadUrl(signedUrl: string, blob: Blob): Promise<void> {
  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', blob)

  const res = await fetch(signedUrl, {
    method: 'PUT',
    body: form,
    headers: { 'x-upsert': 'false' },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text.slice(0, 160).trim() || `Direct storage upload failed (${res.status})`)
  }
}

/** Stage a Sugar ZIP via signed Supabase upload (bypasses app-server body size limits). */
export async function stageSugarZipViaDirectUpload(input: {
  blob: Blob
  filename: string
  prepareUrl: string
  prepareBody: Record<string, unknown>
  completeUrl: string
  completeBody: Record<string, unknown>
}): Promise<
  | { ok: true; job: OwlCenterAssetUploadJob; validation: StageApiPayload['validation'] }
  | { ok: false; error: string }
> {
  const prepRes = await fetch(input.prepareUrl, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input.prepareBody,
      filename: input.filename,
      byte_size: input.blob.size,
    }),
  })
  const prep = await readApiJsonResponse<PrepareApiPayload>(prepRes)
  if (!prepRes.ok || !prep.ok || !prep.job_id || !prep.path || !prep.signed_url) {
    return { ok: false, error: prep.error || 'prepare_failed' }
  }

  await uploadBlobToSignedUploadUrl(prep.signed_url, input.blob)

  const completeRes = await fetch(input.completeUrl, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input.completeBody,
      job_id: prep.job_id,
      path: prep.path,
      filename: input.filename,
      byte_size: input.blob.size,
    }),
  })
  const complete = await readApiJsonResponse<StageApiPayload>(completeRes)
  if (!completeRes.ok || !complete.ok || !complete.job) {
    return { ok: false, error: complete.error || 'complete_failed' }
  }

  return { ok: true, job: complete.job, validation: complete.validation }
}
