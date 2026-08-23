'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readApiJsonResponse } from '@/lib/fetch-api-json'
import {
  stageSugarZipViaDirectUpload,
  type StageSugarUploadProgress,
} from '@/lib/owl-center/stage-sugar-zip-client'
import { cn } from '@/lib/utils'

type JobRow = {
  id: string
  status: string
  original_filename: string | null
  error_message: string | null
  validation_scan?: {
    ok?: boolean
    pair_count?: number
    error?: string
    remapped_from_zero?: boolean
  } | null
  upload_progress?: {
    catalog_upserted?: number
    catalog_skipped?: number
    remapped_from_zero?: boolean
  }
}

type JobResponse = {
  job: JobRow | null
  progress: { total_files: number; uploaded_files: number; percent: number } | null
  catalog_size: number
  irys_configured: boolean
  error?: string
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued — validation pending',
  validating: 'Validating numbered pairs…',
  validated: 'Validated — ready for Arweave',
  uploading: 'Uploading to Arweave (Irys)…',
  seeding: 'Seeding upgrade catalog…',
  completed: 'Complete — catalog seeded',
  failed: 'Failed',
}

/**
 * Admin panel: stage a ZIP of {n}.png + {n}.json, push to Irys, seed
 * coin_art_upgrade_catalog. Same ZIP→Irys pattern as Owl Center Phase B.
 */
export function CoinArtUpgradeArtUploadPanel() {
  const [jobState, setJobState] = useState<JobResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<StageSugarUploadProgress | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/coin-upgrade/art/upload-job', {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = await readApiJsonResponse<JobResponse>(res)
      if (!res.ok) throw new Error(j.error || 'Could not load art upload job.')
      setJobState(j)
    } catch (e) {
      setJobState(null)
      setErr(e instanceof Error ? e.message : 'Could not load art upload job.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const status = jobState?.job?.status
    const shouldPoll =
      status === 'queued' ||
      status === 'validating' ||
      status === 'uploading' ||
      status === 'seeding'
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
    setUploadProgress({ phase: 'preparing', loaded: 0, total: file.size, percent: 0 })
    try {
      const result = await stageSugarZipViaDirectUpload({
        blob: file,
        filename: file.name || 'coin-upgrade.zip',
        prepareUrl: '/api/admin/coin-upgrade/art/stage/prepare',
        prepareBody: {},
        completeUrl: '/api/admin/coin-upgrade/art/stage/complete',
        completeBody: {},
        onProgress: setUploadProgress,
      })
      if (!result.ok) throw new Error(result.error || 'Staging failed.')
      setMsg('ZIP staged. Validate pairs, then push to Arweave.')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Staging failed.')
    } finally {
      setBusy(false)
      setUploadProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function runAction(
    action: 'validate' | 'start_arweave' | 'process_all' | 'reseed_catalog',
  ) {
    const jobId = jobState?.job?.id
    if (!jobId) return null
    const res = await fetch('/api/admin/coin-upgrade/art/upload-job/process', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, action }),
    })
    if (res.status === 502 || res.status === 504) {
      throw new Error(
        'Server timed out on this batch. The cron will keep going — refresh in a few minutes, or retry Push.'
      )
    }
    const j = await readApiJsonResponse<{
      error?: string
      result?: {
        ok?: boolean
        error?: string
        status?: string
        remaining_files?: number
        catalog_upserted?: number
        catalog_size?: number
        manifest_key_count?: number
        missing_art_coin_numbers?: number[]
      }
      catalog_size?: number
      job?: JobRow
      progress?: { total_files: number; uploaded_files: number; percent: number }
    }>(res)
    if (!res.ok) throw new Error(j.error || j.result?.error || 'Process failed.')
    return j
  }

  async function reseedCatalog() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const j = await runAction('reseed_catalog')
      if (!j) throw new Error('Re-seed failed.')
      if (j.result?.ok === false) {
        throw new Error(j.result.error || 'Re-seed failed.')
      }
      const catalogSize = j.catalog_size ?? j.result?.catalog_size ?? j.job?.upload_progress?.catalog_upserted
      const manifestKeys = j.result?.manifest_key_count
      const missing = j.result?.missing_art_coin_numbers
      let msg = `Catalog ${catalogSize ?? '—'} / 1000`
      if (manifestKeys != null) msg += ` (manifest ${manifestKeys} keys)`
      if (j.result?.error) msg += ` — ${j.result.error}`
      else if (catalogSize === 1000) msg += ' — ready to go live.'
      else if (missing?.length) msg += ` — still missing #${missing.join(', #')}.`
      setMsg(msg)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Re-seed failed.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function runValidate() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      await runAction('validate')
      setMsg('Validation complete.')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Validation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function pushAllToArweave() {
    setBusy(true)
    setErr(null)
    setMsg('Uploading to Arweave — large sets may take several minutes (cron continues if this times out).')
    try {
      let action: 'start_arweave' | 'process_all' =
        jobState?.job?.status === 'uploading' || jobState?.job?.status === 'seeding'
          ? 'process_all'
          : 'start_arweave'
      let guard = 0
      while (guard < 200) {
        guard += 1
        const j = await runAction(action)
        if (!j) throw new Error('Upload failed.')
        await load()
        if (j.job?.status === 'completed') {
          setMsg(
            `Done — catalog seeded (${j.job.upload_progress?.catalog_upserted ?? '—'} coins).`
          )
          break
        }
        if (j.job?.status === 'failed') {
          throw new Error(j.job.error_message || j.result?.error || 'Upload failed.')
        }
        if (j.job?.status !== 'uploading' && j.job?.status !== 'seeding') break
        setMsg(
          `Progress ${j.progress?.uploaded_files ?? '—'} / ${j.progress?.total_files ?? '—'} — continuing…`
        )
        action = 'process_all'
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const job = jobState?.job
  const progress = jobState?.progress
  const irysOk = jobState?.irys_configured === true

  return (
    <section className="rounded-2xl border border-border/60 bg-card/80 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">3. Upload new coin art</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Zip numbered pairs (<span className="font-mono">1.png</span> +{' '}
          <span className="font-mono">1.json</span>, …) matching on-chain coin #s. Owl Center Generator
          ZIPs that start at <span className="font-mono">0</span> are remapped to #1…#N automatically.
          Stage → validate → push to Arweave. Catalog fills automatically.
        </p>
      </div>

      {!irysOk ? (
        <p className="text-xs text-amber-500 rounded-lg border border-amber-500/40 px-3 py-2">
          IRYS_PRIVATE_KEY is not set — you can stage + validate, but Arweave push needs a funded Irys
          wallet in Vercel.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <label
          className={cn(
            'inline-flex min-h-[44px] cursor-pointer touch-manipulation items-center gap-2 rounded-md border border-border/60 px-4 text-sm',
            busy && 'opacity-60 pointer-events-none'
          )}
        >
          {busy && uploadProgress ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-4 w-4" aria-hidden />
          )}
          {busy
            ? uploadProgress?.phase === 'uploading'
              ? `Uploading ZIP… ${uploadProgress.percent}%`
              : uploadProgress?.phase === 'finalizing'
                ? 'Finalizing…'
                : 'Preparing…'
            : 'Stage art ZIP'}
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
          <Button type="button" variant="outline" disabled={busy} onClick={() => void runValidate()}>
            Validate pairs
          </Button>
        ) : null}

        {(job?.status === 'validated' || job?.status === 'uploading' || job?.status === 'seeding') &&
        irysOk ? (
          <Button type="button" disabled={busy} onClick={() => void pushAllToArweave()}>
            {busy ? 'Working…' : job.status === 'validated' ? 'Push to Arweave + seed catalog' : 'Continue upload'}
          </Button>
        ) : null}

        {job?.status === 'failed' && irysOk && job.validation_scan?.ok !== false ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void pushAllToArweave()}>
            Retry push
          </Button>
        ) : null}

        {job &&
        (job.status === 'completed' || job.status === 'failed') &&
        ((jobState?.catalog_size ?? 0) < 1000 || job.status === 'failed') ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            title="Rebuild catalog from this job’s Arweave URLs. Fixes 0-based Generator ZIPs so #1–#N match on-chain coins — no re-upload."
            onClick={() => void reseedCatalog()}
          >
            Re-seed catalog (fix # numbering)
          </Button>
        ) : null}
      </div>

      {uploadProgress ? (
        <div className="space-y-1" aria-live="polite">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>
              {uploadProgress.phase === 'uploading'
                ? 'Uploading ZIP to staging'
                : uploadProgress.phase === 'finalizing'
                  ? 'Finalizing'
                  : 'Preparing'}
            </span>
            <span>{uploadProgress.percent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-theme-prime transition-[width]"
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading job status…</p>
      ) : job ? (
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className={job.status === 'failed' ? 'text-destructive' : ''}>
              {STATUS_LABEL[job.status] ?? job.status}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">File</dt>
            <dd className="truncate">{job.original_filename ?? '—'}</dd>
          </div>
          {job.validation_scan?.pair_count != null ? (
            <div>
              <dt className="text-muted-foreground">Pairs found</dt>
              <dd>{job.validation_scan.pair_count}</dd>
            </div>
          ) : null}
          {job.validation_scan?.remapped_from_zero ||
          job.upload_progress?.remapped_from_zero ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Numbering</dt>
              <dd className="text-sky-600 dark:text-sky-300">
                Remapped 0-based Generator ZIP → on-chain #1… numbering for catalog matches.
              </dd>
            </div>
          ) : null}
          {progress && progress.total_files > 0 ? (
            <div>
              <dt className="text-muted-foreground">Arweave progress</dt>
              <dd>
                {progress.uploaded_files} / {progress.total_files} ({progress.percent}%)
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">Catalog size</dt>
            <dd>{jobState?.catalog_size ?? 0} / 1000</dd>
          </div>
          {job.status === 'failed' && job.error_message ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Error</dt>
              <dd className="text-destructive">{job.error_message}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">No art ZIP staged yet.</p>
      )}

      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      {msg ? <p className="text-xs text-emerald-500">{msg}</p> : null}
    </section>
  )
}
