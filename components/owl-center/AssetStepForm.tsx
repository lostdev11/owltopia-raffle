'use client'

import { SugarBatchScanner } from '@/components/owl-center/SugarBatchScanner'
import { formatSugarBatchScanSummary } from '@/lib/owl-center/scan-sugar-batch'

export type AssetStepValues = {
  logo_url: string
  banner_url: string
  collection_image_url: string
  assets_package_url: string
  metadata_package_url: string
  traits_csv_url: string
  asset_notes: string
  total_images: string
  total_metadata: string
}

export function AssetStepForm({
  values,
  onChange,
  fromGenerator = false,
  expectedSupply,
}: {
  values: AssetStepValues
  onChange: (next: AssetStepValues) => void
  fromGenerator?: boolean
  expectedSupply?: number
}) {
  const set = (key: keyof AssetStepValues, v: string) => onChange({ ...values, [key]: v })

  return (
    <div className="grid gap-4">
      {fromGenerator ? (
        <p className="rounded border border-[#00FF9C]/30 bg-[#00FF9C]/8 px-3 py-2 text-xs leading-relaxed text-[#C5D0D8]">
          <strong className="font-normal text-[#EAFBF4]">Total images / metadata</strong> are prefilled from your generator
          supply. Drop the Sugar ZIP you exported below to confirm counts.{' '}
          <strong className="font-normal text-[#EAFBF4]">Package URLs</strong> stay empty until one in-app Arweave push
          in admin (then <code className="text-[#7D8A93]">sugar deploy</code> only — skip{' '}
          <code className="text-[#7D8A93]">sugar upload</code>).
        </p>
      ) : (
        <p className="border border-[#C9A227]/35 bg-[#C9A227]/10 px-3 py-2 font-mono text-xs text-[#E8D089]">
          Production path: export Sugar ZIP → Phase B <strong className="font-normal">Stage ZIP</strong> in admin, or Sugar
          validate/upload/deploy (Arweave), then paste bundle URLs here.
        </p>
      )}
      <p className="font-mono text-xs text-[#9BA8B4]">
        Each NFT should have a matching image and metadata JSON file. Recommended naming:{' '}
        <span className="text-[#00FF9C]">0.png + 0.json</span>,{' '}
        <span className="text-[#00FF9C]">1.png + 1.json</span>, etc. See{' '}
        <span className="break-all text-[#7D8A93]">docs/OWL_CENTER_ARWEAVE_COLLECTION_PIPELINE.md</span> for the full workflow.
      </p>
      {fromGenerator ? (
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
      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Logo URL
        <input
          value={values.logo_url}
          onChange={(e) => set('logo_url', e.target.value)}
          type="url"
          className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
        />
      </label>
      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Banner URL
        <input
          value={values.banner_url}
          onChange={(e) => set('banner_url', e.target.value)}
          type="url"
          className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
        />
      </label>
      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Collection image URL
        <input
          value={values.collection_image_url}
          onChange={(e) => set('collection_image_url', e.target.value)}
          type="url"
          className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
        />
      </label>
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
        />
      </label>
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
