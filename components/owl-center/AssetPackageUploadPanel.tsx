'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'

import { ArweaveUploadEstimateBanner } from '@/components/owl-center/ArweaveUploadEstimateBanner'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { PhaseBRecommendedWorkflow } from '@/components/owl-center/PhaseBRecommendedWorkflow'
import type { ArweaveUploadEstimate } from '@/lib/owl-center/arweave-upload-estimate-types'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'

type JobResponse = {
  job: OwlCenterAssetUploadJob | null
  progress: { total_files: number; uploaded_files: number; percent: number } | null
  irys_configured: boolean
  arweave_estimate: ArweaveUploadEstimate | null
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued — validation pending',
  validating: 'Validating Sugar batch…',
  validated: 'Validated — ready for Arweave',
  uploading: 'Uploading to Arweave (Irys)…',
  completed: 'Upload complete',
  failed: 'Failed',
}

export function AssetPackageUploadPanel({
  launchId,
  onApplied,
}: {
  launchId: string
  onApplied: () => void
}) {
  const [jobState, setJobState] = useState<JobResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pendingEstimateBytes, setPendingEstimateBytes] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets/upload-job`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as JobResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setJobState(j)
    } catch (e) {
      setJobState(null)
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [launchId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const status = jobState?.job?.status
    const shouldPoll = status === 'queued' || status === 'validating' || status === 'uploading'
    if (pollRef.current) clearInterval(pollRef.current)
    if (!shouldPoll) return undefined
    pollRef.current = setInterval(() => void load(), 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [jobState?.job?.status, load])

  async function stageZip(file: File) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    setPendingEstimateBytes(file.size)
    try {
      const fd = new FormData()
      fd.append('zip', file)
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets/stage`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      const j = (await res.json()) as {
        ok?: boolean
        error?: string
        job?: OwlCenterAssetUploadJob
        validation?: { ok?: boolean; error?: string; status?: string }
      }
      if (!res.ok) throw new Error(j.error || 'stage_failed')
      setMsg('ZIP staged — validation applied to asset package when complete.')
      if (j.validation?.ok) {
        onApplied()
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'stage_failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function runAction(action: 'validate' | 'start_arweave' | 'process_batch') {
    const jobId = jobState?.job?.id
    if (!jobId) return
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(
        `/api/admin/owl-center/collections/${launchId}/assets/upload-job/process`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, action }),
        }
      )
      const j = (await res.json()) as {
        error?: string
        result?: { ok?: boolean; error?: string; status?: string; remaining_files?: number }
        job?: OwlCenterAssetUploadJob
      }
      if (!res.ok) throw new Error(j.error || j.result?.error || 'process_failed')
      if (j.result?.status === 'completed' || j.job?.status === 'validated') {
        onApplied()
      }
      setMsg(
        j.result?.remaining_files != null && j.result.remaining_files > 0
          ? `Batch processed — ${j.result.remaining_files} file(s) remaining (cron continues).`
          : 'Job updated.'
      )
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'process_failed')
    } finally {
      setBusy(false)
    }
  }

  const job = jobState?.job
  const progress = jobState?.progress
  const irysOk = jobState?.irys_configured === true
  const estimate = jobState?.arweave_estimate

  return (
    <CommandCard label="phase_b.sys · STAGE → ARWEAVE">
      <PhaseBRecommendedWorkflow />

      <p className="mb-4 text-xs leading-relaxed text-[#9BA8B4]">
        Upload a Sugar export ZIP from the generator (or Sugar). The server validates pairs, fills the asset package,
        then pushes to <strong className="font-normal text-[#E8EEF2]">Arweave via Irys</strong> in batches — no long
        browser request. After Arweave completes, run <code className="text-[#7D8A93]">sugar deploy</code> only (skip{' '}
        <code className="text-[#7D8A93]">sugar upload</code>).
      </p>

      {estimate ? (
        <ArweaveUploadEstimateBanner estimate={estimate} irysConfigured={irysOk} />
      ) : pendingEstimateBytes ? (
        <p className="mb-4 font-mono text-xs text-[#5C6773]">
          Staged {(pendingEstimateBytes / (1024 * 1024)).toFixed(1)} MB — estimate appears after job loads.
        </p>
      ) : null}

      {!irysOk ? (
        <p className="mb-4 rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 font-mono text-xs text-[#FFD769]">
          IRYS_PRIVATE_KEY not set — staging + validate works; Arweave push requires a funded wallet in env.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <label className="inline-flex min-h-[44px] cursor-pointer touch-manipulation items-center gap-2 border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-4 font-mono text-xs uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/18">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? 'Uploading…' : 'Stage Sugar ZIP'}
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void stageZip(f)
            }}
          />
        </label>

        {job?.status === 'queued' ? (
          <DeployButton type="button" variant="ghost" disabled={busy} onClick={() => void runAction('validate')}>
            Run validation
          </DeployButton>
        ) : null}

        {job?.status === 'validated' && irysOk ? (
          <DeployButton type="button" disabled={busy} onClick={() => void runAction('start_arweave')}>
            Push to Arweave
          </DeployButton>
        ) : null}

        {job?.status === 'failed' && irysOk && (job.upload_progress?.file_list?.length ?? 0) > 0 ? (
          <DeployButton type="button" disabled={busy} onClick={() => void runAction('start_arweave')}>
            Retry Push to Arweave
          </DeployButton>
        ) : null}

        {job?.status === 'uploading' ? (
          <DeployButton type="button" variant="ghost" disabled={busy} onClick={() => void runAction('process_batch')}>
            Process next batch
          </DeployButton>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-4 font-mono text-xs text-[#5C6773]">Loading job status…</p>
      ) : job ? (
        <dl className="mt-4 grid gap-2 font-mono text-xs text-[#9BA8B4] sm:grid-cols-2">
          <div>
            <dt className="text-[#5C6773]">Status</dt>
            <dd className={job.status === 'failed' ? 'text-[#FF9C9C]' : 'text-[#00FF9C]'}>
              {STATUS_LABEL[job.status] ?? job.status}
            </dd>
          </div>
          <div>
            <dt className="text-[#5C6773]">File</dt>
            <dd className="truncate">{job.original_filename ?? '—'}</dd>
          </div>
          {progress && progress.total_files > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-[#5C6773]">Arweave progress</dt>
              <dd>
                {progress.uploaded_files} / {progress.total_files} ({progress.percent}%)
              </dd>
            </div>
          ) : null}
          {job.error_message ? (
            <div className="sm:col-span-2">
              <dt className="text-[#5C6773]">Error</dt>
              <dd className="text-[#FF9C9C]">{job.error_message}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-4 font-mono text-xs text-[#5C6773]">No upload jobs yet — stage a ZIP to begin.</p>
      )}

      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </CommandCard>
  )
}
