'use client'

import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  stageSugarZipViaDirectUpload,
  type StageSugarUploadProgress,
} from '@/lib/owl-center/stage-sugar-zip-client'

/**
 * Finished-art upload for the launch wizard — partners bring a ZIP of images +
 * metadata files and we stage it through the same pipeline as generator exports.
 */
export function FinishedArtZipUpload({
  projectId,
  onStaged,
}: {
  /** Staging scope id — the wizard links the staged job to the launch on submit. */
  projectId: string
  onStaged: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState<StageSugarUploadProgress | null>(null)

  async function upload() {
    if (!file) return
    setBusy(true)
    setErr(null)
    setDone(false)
    try {
      const result = await stageSugarZipViaDirectUpload({
        blob: file,
        filename: file.name || 'collection-art.zip',
        prepareUrl: '/api/owl-center/generator/stage/prepare',
        prepareBody: { project_id: projectId },
        completeUrl: '/api/owl-center/generator/stage/complete',
        completeBody: { project_id: projectId },
        onProgress: setProgress,
      })
      if (!result.ok) throw new Error(result.error || 'upload_failed')
      setDone(true)
      onStaged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload_failed')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="rounded border border-[#1A222B] bg-[#0F1419]/80 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Upload your art</p>
      <p className="mt-2 text-xs leading-relaxed text-[#9BA8B4]">
        Have your art ready? Upload one ZIP with your images and their details files — we check it automatically and
        fill in the counts below. Our team handles storage and deployment after review.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null)
          setDone(false)
          setErr(null)
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <DeployButton
          type="button"
          variant="ghost"
          className="min-h-[44px] touch-manipulation"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {file ? `Change ZIP (${file.name})` : 'Choose ZIP file'}
        </DeployButton>
        {file ? (
          <DeployButton
            type="button"
            className="min-h-[44px] touch-manipulation gap-2"
            disabled={busy}
            onClick={() => void upload()}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {progress?.phase === 'uploading' ? `Uploading… ${progress.percent}%` : 'Uploading…'}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" aria-hidden />
                Upload art ZIP
              </>
            )}
          </DeployButton>
        ) : null}
      </div>

      {progress?.phase === 'uploading' ? (
        <div className="mt-3" aria-live="polite">
          <div
            className="h-2 w-full overflow-hidden rounded-full border border-[#1A222B] bg-[#0F1419]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <div
              className="h-full rounded-full bg-[#00FF9C] transition-[width] duration-200 ease-out"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      ) : null}

      {done ? (
        <p className="mt-3 font-mono text-xs text-[#00FF9C]">
          Art uploaded — check the status above; counts fill in automatically once the check finishes.
        </p>
      ) : null}
      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
    </div>
  )
}
