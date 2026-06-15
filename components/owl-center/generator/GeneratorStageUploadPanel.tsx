'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Upload } from 'lucide-react'

import { ArweaveUploadEstimateBanner } from '@/components/owl-center/ArweaveUploadEstimateBanner'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { PhaseBRecommendedWorkflow } from '@/components/owl-center/PhaseBRecommendedWorkflow'
import type { ArweaveUploadEstimate } from '@/lib/owl-center/arweave-upload-estimate-types'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import { readApiJsonResponse } from '@/lib/fetch-api-json'
import { stageSugarZipViaDirectUpload } from '@/lib/owl-center/stage-sugar-zip-client'
import {
  saveStagedAssetsHandoffToSession,
  type GeneratorStagedAssetsHandoff,
} from '@/lib/owl-center/generator/staged-assets-handoff'

type JobResponse = {
  job: OwlCenterAssetUploadJob | null
  progress: { total_files: number; uploaded_files: number; percent: number } | null
  irys_configured: boolean
  arweave_estimate: ArweaveUploadEstimate | null
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued — validation pending',
  validating: 'Validating Sugar batch…',
  validated: 'Validated — step 3 auto-filled on launch submit',
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

  const persistStagedHandoff = useCallback(
    (job: OwlCenterAssetUploadJob) => {
      const handoff: GeneratorStagedAssetsHandoff = {
        project_id: projectId,
        job_id: job.id,
        filename: job.original_filename,
        status: job.status,
        validation_scan: job.validation_scan,
        updated_at: job.updated_at || new Date().toISOString(),
      }
      saveStagedAssetsHandoffToSession(handoff)
    },
    [projectId]
  )

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/owl-center/generator/stage?project_id=${encodeURIComponent(projectId)}`,
        { credentials: 'include', cache: 'no-store' }
      )
      const j = await readApiJsonResponse<JobResponse & { error?: string }>(res)
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setJobState(j)
      if (j.job?.validation_scan) persistStagedHandoff(j.job)
      setErr(null)
    } catch (e) {
      setJobState(null)
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [projectId, persistStagedHandoff])

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
      const result = await stageSugarZipViaDirectUpload({
        blob: source,
        filename,
        prepareUrl: '/api/owl-center/generator/stage/prepare',
        prepareBody: { project_id: projectId },
        completeUrl: '/api/owl-center/generator/stage/complete',
        completeBody: { project_id: projectId },
      })
      if (!result.ok) throw new Error(result.error || 'stage_failed')
      persistStagedHandoff(result.job)
      setMsg(
        result.validation?.ok === false
          ? 'ZIP staged — validation reported issues. Step 3 will still pick up counts when you submit.'
          : 'ZIP staged — step 3 on launch submit auto-fills image/metadata counts from validation.'
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
      const j = await readApiJsonResponse<{ error?: string }>(res)
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
        Stage your Sugar ZIP here before launch submit. Step 3 on the launch form auto-fills image/metadata counts and
        JSON notes from validation — admin links this job on submit for Phase B Arweave upload (no duplicate{' '}
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
