'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { AssetStepValues } from '@/lib/owl-center/asset-step-values'
import { applyStagedScanToAssetStep } from '@/lib/owl-center/apply-staged-scan-to-assets'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import {
  readStagedAssetsHandoffFromSession,
  saveStagedAssetsHandoffToSession,
} from '@/lib/owl-center/generator/staged-assets-handoff'
import { readApiJsonResponse } from '@/lib/fetch-api-json'

type JobResponse = {
  job: OwlCenterAssetUploadJob | null
  error?: string
}

export type StagedAssetsPrefillState = {
  loading: boolean
  job: OwlCenterAssetUploadJob | null
  appliedJobId: string | null
  refresh: () => Promise<void>
}

function applyJobToAssets(
  current: AssetStepValues,
  job: Pick<OwlCenterAssetUploadJob, 'id' | 'validation_scan' | 'original_filename' | 'status'>
): AssetStepValues | null {
  const scan = job.validation_scan
  if (!scan) return null
  return applyStagedScanToAssetStep(current, scan, {
    jobId: job.id,
    filename: job.original_filename,
    status: job.status,
  })
}

export function useStagedAssetsPrefill(
  projectId: string | null,
  assets: AssetStepValues,
  onChange: (next: AssetStepValues) => void
): StagedAssetsPrefillState {
  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<OwlCenterAssetUploadJob | null>(null)
  const [appliedJobId, setAppliedJobId] = useState<string | null>(null)
  const assetsRef = useRef(assets)
  const onChangeRef = useRef(onChange)
  const appliedJobIdRef = useRef<string | null>(null)
  assetsRef.current = assets
  onChangeRef.current = onChange

  const tryApply = useCallback((latest: Pick<OwlCenterAssetUploadJob, 'id' | 'validation_scan' | 'original_filename' | 'status'>) => {
    if (!latest.validation_scan || latest.id === appliedJobIdRef.current) return
    const next = applyJobToAssets(assetsRef.current, latest)
    if (!next) return
    onChangeRef.current(next)
    appliedJobIdRef.current = latest.id
    setAppliedJobId(latest.id)
  }, [])

  const refresh = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const handoff = readStagedAssetsHandoffFromSession(projectId)
      if (handoff?.validation_scan) {
        tryApply({
          id: handoff.job_id,
          validation_scan: handoff.validation_scan,
          original_filename: handoff.filename,
          status: handoff.status as OwlCenterAssetUploadJob['status'],
        })
      }

      const res = await fetch(
        `/api/owl-center/generator/stage?project_id=${encodeURIComponent(projectId)}`,
        { credentials: 'include', cache: 'no-store' }
      )
      const j = await readApiJsonResponse<JobResponse>(res)
      if (!res.ok) return

      const latest = j.job
      setJob(latest)
      if (!latest) return

      saveStagedAssetsHandoffToSession({
        project_id: projectId,
        job_id: latest.id,
        filename: latest.original_filename,
        status: latest.status,
        validation_scan: latest.validation_scan,
        updated_at: latest.updated_at || new Date().toISOString(),
      })

      tryApply(latest)
    } finally {
      setLoading(false)
    }
  }, [projectId, tryApply])

  useEffect(() => {
    if (!projectId) return
    void refresh()
  }, [projectId, refresh])

  useEffect(() => {
    const status = job?.status
    const shouldPoll = status === 'queued' || status === 'validating'
    if (!shouldPoll) return undefined
    const id = setInterval(() => void refresh(), 4000)
    return () => clearInterval(id)
  }, [job?.status, refresh])

  return { loading, job, appliedJobId, refresh }
}
