import type { AssetStepValues } from '@/lib/owl-center/asset-step-values'
import type { SugarBatchScanResult } from '@/lib/owl-center/scan-sugar-batch'
import { formatSugarBatchScanSummary } from '@/lib/owl-center/scan-sugar-batch'

export type StagedAssetsMeta = {
  jobId?: string
  filename?: string | null
  status?: string
}

function stagingHeader(meta?: StagedAssetsMeta): string | null {
  if (!meta?.filename && !meta?.jobId) return null
  const parts = ['Staged Sugar ZIP']
  if (meta.filename) parts.push(`(${meta.filename})`)
  if (meta.jobId) parts.push(`· job ${meta.jobId.slice(0, 8)}`)
  if (meta.status) parts.push(`· ${meta.status}`)
  return parts.join(' ')
}

function zipExtras(scan: SugarBatchScanResult): string[] {
  return [
    scan.hasCollectionJson ? 'Includes collection.json in ZIP.' : null,
    scan.hasCollectionPng ? 'Includes collection.png in ZIP (use upload below or Phase B for hub cover).' : null,
    scan.hasTraitsCsv ? 'Includes traits.csv in ZIP — linked at Phase B Arweave upload.' : null,
  ].filter((line): line is string => Boolean(line))
}

/** Merge validation scan from a staged Sugar ZIP into launch step-3 asset fields. */
export function applyStagedScanToAssetStep(
  current: AssetStepValues,
  scan: SugarBatchScanResult,
  meta?: StagedAssetsMeta
): AssetStepValues {
  const header = stagingHeader(meta)
  const summary = formatSugarBatchScanSummary(scan)
  const extras = zipExtras(scan)
  const block = [header, summary, ...extras].filter(Boolean).join('\n')
  const prior = current.asset_notes.trim()
  const alreadyApplied = header && prior.includes(header)
  const asset_notes = alreadyApplied ? prior : [block, prior].filter(Boolean).join('\n\n')

  return {
    ...current,
    total_images: String(scan.imageCount),
    total_metadata: String(scan.metadataCount),
    asset_notes,
  }
}
