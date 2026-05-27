'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { AssetPackagePanel } from '@/components/owl-center/AssetPackagePanel'
import { AssetValidationChecklist } from '@/components/owl-center/AssetValidationChecklist'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { MarketplaceReadinessPanel } from '@/components/owl-center/MarketplaceReadinessPanel'
import { MetadataUploadStatusBadge } from '@/components/owl-center/MetadataUploadStatusBadge'
import { mergeValidationChecklist } from '@/lib/owl-center/asset-validation'
import type { OwlCenterAssetPackage, OwlCenterMarketplaceReadiness } from '@/lib/owl-center/asset-types'
import { OWL_CENTER_METADATA_UPLOAD_STATUSES, OWL_CENTER_VALIDATION_STATUSES } from '@/lib/owl-center/asset-types'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Bundle = {
  launch: OwlCenterLaunchPublic
  assetPackage: OwlCenterAssetPackage | null
  marketplaceReadiness: OwlCenterMarketplaceReadiness | null
}

export function CollectionAssetsAdminClient({ launchId }: { launchId: string }) {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [logoUrl, setLogoUrl] = useState('')
  const [bannerUrl, setBannerUrl] = useState('')
  const [collectionImageUrl, setCollectionImageUrl] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [assetsPath, setAssetsPath] = useState('')
  const [metadataPath, setMetadataPath] = useState('')
  const [traitsCsv, setTraitsCsv] = useState('')
  const [expectedSupply, setExpectedSupply] = useState('0')
  const [totalImages, setTotalImages] = useState('0')
  const [totalMetadata, setTotalMetadata] = useState('0')
  const [metadataUploadStatus, setMetadataUploadStatus] = useState<string>('NOT_UPLOADED')
  const [adminNotes, setAdminNotes] = useState('')
  const [checklist, setChecklist] = useState(() => mergeValidationChecklist({}))

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as Bundle & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setBundle(j)
      const L = j.launch
      const P = j.assetPackage
      setSymbol(L.symbol ?? '')
      setDescription(L.description ?? '')
      setLogoUrl(P?.logo_url ?? '')
      setBannerUrl(P?.banner_url ?? '')
      setCollectionImageUrl(P?.collection_image_url ?? L.image_url ?? '')
      setAssetsPath(P?.assets_storage_path ?? '')
      setMetadataPath(P?.metadata_storage_path ?? '')
      setTraitsCsv(P?.traits_csv_url ?? '')
      setExpectedSupply(String(P?.expected_supply ?? L.total_supply ?? 0))
      setTotalImages(String(P?.total_images ?? 0))
      setTotalMetadata(String(P?.total_metadata ?? 0))
      setMetadataUploadStatus(P?.metadata_upload_status ?? 'NOT_UPLOADED')
      setAdminNotes(P?.admin_notes ?? '')
      setChecklist(mergeValidationChecklist(P?.validation_checklist as Record<string, unknown>))
    } catch (e) {
      setBundle(null)
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [launchId])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(body: Record<string, unknown>) {
    setMsg(null)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json()) as Bundle & { error?: string; validation_checklist?: unknown }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      setBundle(j)
      setMsg('Updated')
      if (j.assetPackage) {
        setChecklist(mergeValidationChecklist(j.assetPackage.validation_checklist as Record<string, unknown>))
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    }
  }

  if (loading && !bundle) {
    return <p className="font-mono text-sm text-[#5C6773]">Loading assets console…</p>
  }
  if (err && !bundle) {
    return <p className="font-mono text-sm text-[#FF9C9C]">{err}</p>
  }
  if (!bundle) return null

  const { launch, assetPackage } = bundle
  const isGen2 = launch.slug === 'gen2'
  const gen2Warn =
    isGen2 &&
    assetPackage &&
    (assetPackage.total_metadata !== 2000 || assetPackage.total_images !== 2000 || assetPackage.expected_supply !== 2000)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/owl-center"
          className="font-mono text-xs uppercase tracking-widest text-[#00C97A] hover:underline"
        >
          ← Owl Center admin
        </Link>
        <Link href={`/owl-center/collection/${launch.slug}`} className="font-mono text-xs text-[#5C6773] hover:text-[#00FF9C]">
          Open collection
        </Link>
      </div>

      <header>
        <h1 className="font-display text-3xl text-[#F4FBF8]">Assets & metadata</h1>
        <p className="mt-2 font-mono text-xs text-[#5C6773]">
          launch_id={launch.id} · slug={launch.slug} · assets_ready={String(launch.assets_ready)} · metadata_ready=
          {String(launch.metadata_ready)}
        </p>
        <details className="mt-4 touch-manipulation border border-[#1A222B] bg-[#10161C]/85 p-4 font-mono text-xs text-[#9BA8B4] [&_summary]:cursor-pointer [&_summary]:select-none [&_summary]:font-mono [&_summary]:text-[10px] [&_summary]:uppercase [&_summary]:tracking-widest [&_summary]:text-[#5C6773]">
          <summary>Recommended workflow (Sugar + Arweave → Owl Center)</summary>
          <ol className="mt-3 list-decimal space-y-2 ps-5 text-[13px] leading-relaxed">
            <li>
              Pre-render paired files (e.g. <span className="text-[#00FF9C]">0.png + 0.json</span> …) then run{' '}
              <span className="text-[#E8EEF2]">sugar validate</span> → <span className="text-[#E8EEF2]">sugar upload</span> →{' '}
              <span className="text-[#E8EEF2]">sugar deploy</span> (
              <a
                href="https://developers.metaplex.com/candy-machine/sugar"
                className="text-[#00C97A] underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                Metaplex Sugar docs
              </a>
              ).
            </li>
            <li>
              Paste resulting <strong className="font-normal text-[#E8EEF2]">assets</strong> and{' '}
              <strong className="font-normal text-[#E8EEF2]">metadata</strong> paths/URLs below; complete the checklist →{' '}
              <strong className="font-normal text-[#E8EEF2]">Mark ready for Candy Machine</strong>.
            </li>
            <li>
              Set <span className="text-[#E8EEF2]">candy_machine_id</span> + <span className="text-[#E8EEF2]">collection_mint</span> in{' '}
              <a href="/admin/owl-center" className="text-[#00C97A] underline underline-offset-2">
                Owl Center admin
              </a>
              . Full runbook: <span className="break-all text-[#7D8A93]">docs/OWL_CENTER_ARWEAVE_COLLECTION_PIPELINE.md</span>
            </li>
          </ol>
          <p className="mt-3 text-[11px] text-[#5C6773]">
            In-app bulk zip → Arweave is planned (Phase B); this screen records provenance and readiness after CLI upload.
          </p>
        </details>
      </header>

      {gen2Warn ? (
        <CommandCard label="gen2_supply_gate.sys">
          <p className="font-mono text-sm text-[#FF9C9C]">
            Gen2 expects 2000 / 2000 / 2000 (images / metadata / supply). Adjust counts before Candy Machine deployment.
          </p>
          <p className="mt-2 font-mono text-xs text-[#9BA8B4]">
            Current · images={assetPackage?.total_images} metadata={assetPackage?.total_metadata} expected_supply=
            {assetPackage?.expected_supply}
          </p>
        </CommandCard>
      ) : null}

      <CommandCard label="collection_identity.sys">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Symbol (display)
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              readOnly
              className="cursor-not-allowed border border-[#1A222B] bg-[#0B0F13] px-3 py-2 text-sm text-[#7D8A93]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
            Description (read-only — edit launch registry later)
            <textarea
              value={description}
              readOnly
              rows={2}
              className="cursor-not-allowed border border-[#1A222B] bg-[#0B0F13] px-3 py-2 text-sm text-[#7D8A93]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Logo URL
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Banner URL
            <input
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
            Collection image URL
            <input
              value={collectionImageUrl}
              onChange={(e) => setCollectionImageUrl(e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
        </div>
      </CommandCard>

      <CommandCard label="asset_package.sys">
        <p className="mb-4 text-xs text-[#9BA8B4]">
          Phase A (current): after <span className="text-[#E8EEF2]">sugar upload</span>, paste Arweave (or IPFS) bundle paths
          or HTTPS gateway URLs. Phase B: dashboard staging + background push to permanent storage.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
            Assets storage path / URL
            <input
              value={assetsPath}
              onChange={(e) => setAssetsPath(e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
            Metadata storage path / URL
            <input
              value={metadataPath}
              onChange={(e) => setMetadataPath(e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
            Traits CSV URL
            <input
              value={traitsCsv}
              onChange={(e) => setTraitsCsv(e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Expected supply
            <input
              value={expectedSupply}
              onChange={(e) => setExpectedSupply(e.target.value)}
              type="number"
              min={0}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Total images
            <input
              value={totalImages}
              onChange={(e) => setTotalImages(e.target.value)}
              type="number"
              min={0}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Total metadata
            <input
              value={totalMetadata}
              onChange={(e) => setTotalMetadata(e.target.value)}
              type="number"
              min={0}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
            Metadata upload status
            <select
              value={metadataUploadStatus}
              onChange={(e) => setMetadataUploadStatus(e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
            >
              {OWL_CENTER_METADATA_UPLOAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <DeployButton
            type="button"
            onClick={() =>
              void patch({
                logo_url: logoUrl.trim() || null,
                banner_url: bannerUrl.trim() || null,
                collection_image_url: collectionImageUrl.trim() || null,
                assets_storage_path: assetsPath.trim() || null,
                metadata_storage_path: metadataPath.trim() || null,
                traits_csv_url: traitsCsv.trim() || null,
                expected_supply: Number(expectedSupply),
                total_images: Number(totalImages),
                total_metadata: Number(totalMetadata),
                metadata_upload_status: metadataUploadStatus,
                admin_notes: adminNotes,
                validation_checklist: checklist,
              })
            }
          >
            Save asset package
          </DeployButton>
          <MetadataUploadStatusBadge status={metadataUploadStatus as OwlCenterAssetPackage['metadata_upload_status']} />
        </div>
      </CommandCard>

      <CommandCard label="validation_engine.sys · MANUAL_V1">
        <AssetValidationChecklist checklist={checklist} onChange={setChecklist} />
        <div className="mt-6 flex flex-wrap gap-2 border-t border-[#1A222B] pt-4">
          <DeployButton type="button" variant="ghost" onClick={() => void patch({ validation_checklist: checklist })}>
            Save checklist only
          </DeployButton>
          <DeployButton type="button" variant="ghost" onClick={() => void patch({ action: 'mark_valid', validation_checklist: checklist })}>
            Mark valid
          </DeployButton>
          <DeployButton type="button" variant="ghost" onClick={() => void patch({ action: 'mark_needs_review', validation_checklist: checklist })}>
            Mark needs review
          </DeployButton>
          <DeployButton
            type="button"
            variant="ghost"
            onClick={() => void patch({ action: 'mark_ready_cm', validation_checklist: checklist })}
          >
            Mark ready for Candy Machine
          </DeployButton>
        </div>
        <p className="mt-3 font-mono text-[10px] text-[#5C6773]">
          Allowed validation_status values: {OWL_CENTER_VALIDATION_STATUSES.join(', ')}
        </p>
      </CommandCard>

      <CommandCard label="admin_notes.sys">
        <textarea
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
          rows={4}
          className="w-full border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          placeholder="Problems, blockers, links to CM configs…"
        />
        <DeployButton type="button" className="mt-3" variant="ghost" onClick={() => void patch({ admin_notes: adminNotes })}>
          Save notes
        </DeployButton>
      </CommandCard>

      <AssetPackagePanel pkg={assetPackage} />

      <MarketplaceReadinessPanel launchId={launchId} launch={launch} />

      {err ? <p className="font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </div>
  )
}
