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

export type StageSugarUploadProgress = {
  /** Which step of the staging flow we're in. */
  phase: 'preparing' | 'uploading' | 'finalizing'
  /** Bytes uploaded so far (only meaningful during `uploading`). */
  loaded: number
  /** Total bytes to upload. */
  total: number
  /** 0–100 upload completion of the storage transfer. */
  percent: number
}

/**
 * Uploads the blob to a Supabase signed upload URL using XMLHttpRequest so we can
 * surface upload progress (the fetch API does not expose request upload progress).
 */
function uploadBlobToSignedUploadUrl(
  signedUrl: string,
  blob: Blob,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('cacheControl', '3600')
    form.append('', blob)

    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signedUrl, true)
    xhr.setRequestHeader('x-upsert', 'false')

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return
      const total = event.lengthComputable && event.total > 0 ? event.total : blob.size
      onProgress(event.loaded, total)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      if (xhr.status === 413) {
        const mb = (blob.size / (1024 * 1024)).toFixed(0)
        reject(
          new Error(
            `Upload rejected — this ZIP (${mb} MB) exceeds your Supabase Storage upload limit. ` +
              'Raise Project Settings → Storage → "Upload file size limit" (and the bucket file_size_limit), or split the batch.'
          )
        )
        return
      }
      const text = (xhr.responseText || '').slice(0, 160).trim()
      reject(new Error(text || `Direct storage upload failed (${xhr.status})`))
    }
    xhr.onerror = () =>
      reject(new Error('Direct storage upload failed — check your connection (WiFi/mobile data) and retry.'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))

    xhr.send(form)
  })
}

/** Stage a Sugar ZIP via signed Supabase upload (bypasses app-server body size limits). */
export async function stageSugarZipViaDirectUpload(input: {
  blob: Blob
  filename: string
  prepareUrl: string
  prepareBody: Record<string, unknown>
  completeUrl: string
  completeBody: Record<string, unknown>
  onProgress?: (progress: StageSugarUploadProgress) => void
}): Promise<
  | { ok: true; job: OwlCenterAssetUploadJob; validation: StageApiPayload['validation'] }
  | { ok: false; error: string }
> {
  const total = input.blob.size
  input.onProgress?.({ phase: 'preparing', loaded: 0, total, percent: 0 })

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

  await uploadBlobToSignedUploadUrl(prep.signed_url, input.blob, (loaded, uploadTotal) => {
    const percent = uploadTotal > 0 ? Math.min(100, Math.round((loaded / uploadTotal) * 100)) : 0
    input.onProgress?.({ phase: 'uploading', loaded, total: uploadTotal, percent })
  })

  input.onProgress?.({ phase: 'finalizing', loaded: total, total, percent: 100 })

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
