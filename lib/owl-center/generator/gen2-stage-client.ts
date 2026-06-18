import { buildSugarZipBlob, type SugarZipProgress } from '@/lib/owl-center/generator/export-zip'
import { stageSugarZipViaDirectUpload } from '@/lib/owl-center/stage-sugar-zip-client'
import { generateBatch } from '@/lib/owl-center/generator/generate-batch'
import {
  generativeCountForSupply,
  mergeOneOfOnesIntoCollection,
  oneOfOnesForProject,
} from '@/lib/owl-center/generator/one-of-one'
import type { GeneratorProject } from '@/lib/owl-center/generator/types'

/** Build a full-supply Sugar ZIP blob (no browser download). */
export async function buildFullSupplySugarZip(
  project: GeneratorProject,
  targetSupply: number,
  onProgress?: (p: SugarZipProgress) => void
): Promise<{ blob: Blob; filename: string; count: number }> {
  const entries = oneOfOnesForProject(project)
  const generativeCount = generativeCountForSupply(targetSupply, entries.length)
  if (generativeCount <= 0 && !entries.length) {
    throw new Error('Set target supply or add 1/1 images before exporting')
  }
  const generative =
    generativeCount > 0 ? generateBatch(project, generativeCount, { requireAllCategories: true }) : []
  const batch = mergeOneOfOnesIntoCollection(
    generative,
    entries,
    project.oneOfOnePlacement,
    project.id
  )
  return buildSugarZipBlob(
    project,
    batch,
    `${project.name || 'gen2'}-supply-${targetSupply}`,
    onProgress
  )
}

export async function stageSugarZipToLaunch(
  launchId: string,
  blob: Blob,
  filename: string
): Promise<{ ok: true; job_id: string } | { ok: false; error: string }> {
  const base = `/api/admin/owl-center/collections/${encodeURIComponent(launchId)}/assets/stage`
  const result = await stageSugarZipViaDirectUpload({
    blob,
    filename: filename || 'gen2-supply.zip',
    prepareUrl: `${base}/prepare`,
    prepareBody: {},
    completeUrl: `${base}/complete`,
    completeBody: {},
  })
  if (!result.ok) return { ok: false, error: result.error || 'stage_failed' }
  const jobId = result.job.id?.trim()
  if (!jobId) return { ok: false, error: 'Stage succeeded but job id missing' }
  return { ok: true, job_id: jobId }
}

/** Kick validation / Arweave prep on a staged job (same as admin upload panel). */
export async function processStagedUploadJob(
  launchId: string,
  jobId: string,
  action: 'validate' | 'start_arweave' = 'validate'
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `/api/admin/owl-center/collections/${encodeURIComponent(launchId)}/assets/upload-job/process`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, action }),
    }
  )
  const j = (await res.json()) as { error?: string; result?: { ok?: boolean; error?: string } }
  if (!res.ok) return { ok: false, error: j.error || j.result?.error || 'process_failed' }
  return { ok: true }
}

export type Gen2GeneratorLink = {
  launch_id: string
  generator_project_id: string | null
  total_supply: number
  linked_project_name: string | null
  assets_admin_url: string
}

export async function fetchGen2GeneratorLink(): Promise<Gen2GeneratorLink | null> {
  const res = await fetch('/api/admin/owl-center/gen2/generator-link', { credentials: 'include', cache: 'no-store' })
  if (!res.ok) return null
  return (await res.json()) as Gen2GeneratorLink
}

export async function linkGen2GeneratorProject(input: {
  generator_project_id?: string | null
  use_cloud_project?: boolean
}): Promise<{ ok: boolean; error?: string; link?: Gen2GeneratorLink }> {
  const res = await fetch('/api/admin/owl-center/gen2/generator-link', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = (await res.json()) as { ok?: boolean; error?: string } & Partial<Gen2GeneratorLink>
  if (!res.ok || !j.ok) return { ok: false, error: j.error || 'link_failed' }
  return { ok: true, link: j as Gen2GeneratorLink }
}
