'use client'

import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react'

import { BrandImageUploadField } from '@/components/owl-center/BrandImageUploadField'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { SugarBatchScanner } from '@/components/owl-center/SugarBatchScanner'
import type { OwlCenterAssetUploadJob } from '@/lib/owl-center/asset-upload-types'
import { formatSugarBatchScanSummary } from '@/lib/owl-center/scan-sugar-batch'

import type { AssetStepValues } from '@/lib/owl-center/asset-step-values'

export type { AssetStepValues } from '@/lib/owl-center/asset-step-values'

const STAGED_STATUS_LABEL: Record<string, string> = {
  queued: 'ZIP uploaded — file check queued',
  validating: 'Checking your files…',
  validated: 'Files look good — counts applied below',
  uploading: 'Uploading to permanent storage (Owltopia team)',
  completed: 'Permanent storage upload complete',
  failed: 'File check failed — fix the ZIP and upload again',
}

export function AssetStepForm({
  values,
  onChange,
  fromGenerator = false,
  expectedSupply,
  generatorProjectId = null,
  stagedJob = null,
  stagedLoading = false,
  onRefreshStaged,
  plainMode = false,
}: {
  values: AssetStepValues
  onChange: (next: AssetStepValues) => void
  fromGenerator?: boolean
  expectedSupply?: number
  generatorProjectId?: string | null
  stagedJob?: OwlCenterAssetUploadJob | null
  stagedLoading?: boolean
  onRefreshStaged?: () => void
  /** Partner-friendly copy — hide operator-only fields and CLI/storage jargon. */
  plainMode?: boolean
}) {
  const set = (key: keyof AssetStepValues, v: string) => onChange({ ...values, [key]: v })
  const hasStagedScan = Boolean(stagedJob?.validation_scan)
  const showLocalScanner = !plainMode && (!hasStagedScan || stagedJob?.status === 'failed')

  return (
    <div className="grid gap-4">
      {fromGenerator ? (
        <p className="rounded border border-[#00FF9C]/30 bg-[#00FF9C]/8 px-3 py-2 text-xs leading-relaxed text-[#C5D0D8]">
          {plainMode ? (
            <>
              Your generator export carries over automatically — image and metadata counts fill in below. Add your
              logo and banner here and you are set.
            </>
          ) : (
            <>
              <strong className="font-normal text-[#EAFBF4]">Stage your Sugar ZIP in the generator first</strong> — image
              and metadata counts, collection.json, and traits.csv notes flow here automatically. Upload logo and banner
              below; URLs are created for you.{' '}
              <strong className="font-normal text-[#EAFBF4]">Package URLs</strong> stay empty until Phase B Arweave
              upload in admin.
            </>
          )}
        </p>
      ) : plainMode ? null : (
        <p className="border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-2 font-mono text-xs text-[#E8D089]">
          Production path: export Sugar ZIP → Phase B <strong className="font-normal">Stage ZIP</strong> in admin, or Sugar
          validate/upload/deploy (Arweave), then paste bundle URLs here.
        </p>
      )}

      {generatorProjectId ? (
        <div className="rounded border border-[#1A222B] bg-[#0F1419]/80 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                {plainMode ? 'Your art' : 'Staged art ZIP'}
              </p>
              {stagedLoading ? (
                <p className="mt-2 flex items-center gap-2 font-mono text-xs text-[#7D8A93]">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading staged job…
                </p>
              ) : stagedJob ? (
                <p className="mt-2 flex items-center gap-2 font-mono text-xs text-[#C5D0D8]">
                  {stagedJob.status === 'validated' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#00FF9C]" aria-hidden />
                  ) : stagedJob.status === 'failed' ? null : (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#7D8A93]" aria-hidden />
                  )}
                  {STAGED_STATUS_LABEL[stagedJob.status] ?? stagedJob.status}
                  {stagedJob.original_filename ? (
                    <span className="text-[#5C6773]">· {stagedJob.original_filename}</span>
                  ) : null}
                </p>
              ) : (
                <p className="mt-2 font-mono text-xs text-[#FFD769]">
                  {plainMode
                    ? 'No art uploaded yet — upload your ZIP below, or export from the Owl Generator.'
                    : 'No staged ZIP yet — go back to the generator and tap Stage latest export.'}
                </p>
              )}
              {stagedJob?.status === 'failed' && stagedJob.error_message ? (
                <p className="mt-2 text-xs text-[#FF9C9C]">{stagedJob.error_message}</p>
              ) : null}
            </div>
            {onRefreshStaged ? (
              <DeployButton
                type="button"
                variant="ghost"
                className="min-h-[44px] touch-manipulation gap-2"
                disabled={stagedLoading}
                onClick={onRefreshStaged}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Refresh
              </DeployButton>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="font-mono text-xs text-[#9BA8B4]">
        Each NFT needs one image and one matching details file, named{' '}
        <span className="text-[#00FF9C]">0.png + 0.json</span>,{' '}
        <span className="text-[#00FF9C]">1.png + 1.json</span>, and so on.
        {plainMode ? ' Not sure your files are formatted right? Submit anyway and add a note — we will check and help.' : ''}
      </p>

      {showLocalScanner ? (
        <SugarBatchScanner
          embedded
          expectedSupply={expectedSupply}
          onApply={(scan) => {
            onChange({
              ...values,
              total_images: String(scan.imageCount),
              total_metadata: String(scan.metadataCount),
              asset_notes: [values.asset_notes.trim(), formatSugarBatchScanSummary(scan)].filter(Boolean).join('\n\n'),
            })
          }}
        />
      ) : null}

      <BrandImageUploadField
        label="Logo"
        value={values.logo_url}
        onChange={(url) => set('logo_url', url)}
        hint="Square logo for listings and hub cards."
      />
      <BrandImageUploadField
        label="Banner"
        value={values.banner_url}
        onChange={(url) => set('banner_url', url)}
        hint="Wide banner for collection page header."
      />
      <BrandImageUploadField
        label="Collection image"
        value={values.collection_image_url}
        onChange={(url) => set('collection_image_url', url)}
        hint="Optional cover if different from logo."
      />

      {!plainMode ? (
        <>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Assets package URL / path
            <input
              value={values.assets_package_url}
              onChange={(e) => set('assets_package_url', e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
              placeholder={fromGenerator ? 'Filled after Phase B or Sugar upload' : 'https://… or storage path'}
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Metadata package URL / path
            <input
              value={values.metadata_package_url}
              onChange={(e) => set('metadata_package_url', e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
              placeholder={fromGenerator ? 'Filled after Phase B or Sugar upload' : 'https://… or storage path'}
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Traits CSV URL (optional)
            <input
              value={values.traits_csv_url}
              onChange={(e) => set('traits_csv_url', e.target.value)}
              type="url"
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
              placeholder={hasStagedScan && stagedJob?.validation_scan?.hasTraitsCsv ? 'Included in staged ZIP' : undefined}
            />
          </label>
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Total images (optional)
          <input
            value={values.total_images}
            onChange={(e) => set('total_images', e.target.value)}
            type="number"
            min={0}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Total metadata files (optional)
          <input
            value={values.total_metadata}
            onChange={(e) => set('total_metadata', e.target.value)}
            type="number"
            min={0}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
      </div>
      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Notes
        <textarea
          value={values.asset_notes}
          onChange={(e) => set('asset_notes', e.target.value)}
          rows={3}
          className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
        />
      </label>
    </div>
  )
}
