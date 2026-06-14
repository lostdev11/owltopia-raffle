'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Upload } from 'lucide-react'

import { ArweaveUploadEstimateBanner } from '@/components/owl-center/ArweaveUploadEstimateBanner'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { PhaseBRecommendedWorkflow } from '@/components/owl-center/PhaseBRecommendedWorkflow'
import type { ArweaveUploadEstimate } from '@/lib/owl-center/arweave-upload-estimate'
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
  validated: 'Validated — links on launch submit',
  uploading: 'Uploading to Arweave…',
  completed: 'Upload complete',
  failed: 'Validation failed — fix ZIP and re-stage',
}

export function GeneratorStageUploadPanel({
  projectId,
  zipBlob,
  zipFilename,
}: {
  projectId: string
  zipBlob: Blob | null
  zipFilename: string | null
}) {
  const [jobState, setJobState] = useState<JobResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/owl-center/generator/stage?project_id=${encodeURIComponent(projectId)}`,
        { credentials: 'include', cache: 'no-store' }
      )
      const j = (await res.json()) as JobResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setJobState(j)
      setErr(null)
    } catch (e) {
      setJobState(null)
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const status = jobState?.job?.status
    const shouldPoll = status === 'queued' || status === 'validating'
    if (pollRef.current) clearInterval(pollRef.current)
    if (!shouldPoll) return undefined
    pollRef.current = setInterval(() => void load(), 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [jobState?.job?.status, load])

  async function stageZip(source: Blob, filename: string) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('project_id', projectId)
      fd.append('zip', source, filename)
      const res = await fetch('/api/owl-center/generator/stage', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      const j = (await res.json()) as {
        ok?: boolean
        error?: string
        job?: OwlCenterAssetUploadJob
        validation?: { ok?: boolean; status?: string }
      }
      if (!res.ok) throw new Error(j.error || 'stage_failed')
      setMsg(
        j.validation?.ok === false
          ? 'ZIP staged — validation reported issues (review after launch submit).'
          : 'ZIP staged — validation runs automatically. Submit to launch to link it.'
      )
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'stage_failed')
    } finally {
      setBusy(false)
    }
  }

  async function retryValidation() {
    const jobId = jobState?.job?.id
    if (!jobId) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/owl-center/generator/stage/process', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'validate_failed')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'validate_failed')
    } finally {
      setBusy(false)
    }
  }

  const job = jobState?.job
  const validated = job?.status === 'validated'
  const estimate = jobState?.arweave_estimate
  const irysOk = jobState?.irys_configured === true

  return (
    <CommandCard label="STAGE // Pre-launch upload">
      <PhaseBRecommendedWorkflow compact />
      <p className="mt-3 text-sm text-[#9BA8B4]">
        Stage your Sugar ZIP by project ID before launch submit. After you submit the launch form, admin links this
        job and validation to the collection assets page — then one Arweave push (no duplicate{' '}
        <code className="text-[#7D8A93]">sugar upload</code>).
      </p>

      {estimate ? (
        <div className="mt-4">
          <ArweaveUploadEstimateBanner estimate={estimate} irysConfigured={irysOk} />
        </div>
      ) : zipBlob ? (
        <p className="mt-4 font-mono text-xs text-[#5C6773]">
          After staging, an estimated SOL cost for Arweave will appear here.
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 flex items-center gap-2 font-mono text-xs text-[#5C6773]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking staged job…
        </p>
      ) : null}

      {job ? (
        <div className="mt-4 rounded border border-[#1A222B] bg-[#0F1419]/80 px-4 py-3">
          <p className="flex items-center gap-2 font-mono text-xs text-[#C5D0D8]">
            {validated ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#00FF9C]" aria-hidden />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#7D8A93]" aria-hidden />
            )}
            {STATUS_LABEL[job.status] ?? job.status}
          </p>
          {job.error_message ? (
            <p className="mt-2 text-xs text-[#FF9C9C]">{job.error_message}</p>
          ) : null}
          {job.status === 'queued' ? (
            <DeployButton type="button" variant="ghost" className="mt-3 min-h-[44px] touch-manipulation" disabled={busy} onClick={() => void retryValidation()}>
              Run validation now
            </DeployButton>
          ) : null}
        </div>
      ) : null}

      {zipBlob && zipFilename ? (
        <DeployButton
          type="button"
          className="mt-4 w-full min-h-[44px] touch-manipulation gap-2"
          disabled={busy}
          onClick={() => void stageZip(zipBlob, zipFilename)}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Staging…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" aria-hidden />
              Stage latest export ({zipFilename})
            </>
          )}
        </DeployButton>
      ) : (
        <p className="mt-4 text-xs text-[#5C6773]">Export a Sugar ZIP above to enable one-tap staging.</p>
      )}

      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
    </CommandCard>
  )
}
