'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { Gen2GeneratorLinkPanel } from '@/components/owl-center/Gen2GeneratorLinkPanel'
import { AssetPackagePanel } from '@/components/owl-center/AssetPackagePanel'
import { AssetPackageUploadPanel } from '@/components/owl-center/AssetPackageUploadPanel'
import { MetadataRefreshPanel } from '@/components/owl-center/MetadataRefreshPanel'
import { SugarDeployPanel } from '@/components/owl-center/SugarDeployPanel'
import { AssetValidationChecklist } from '@/components/owl-center/AssetValidationChecklist'
import { SugarBatchScanner } from '@/components/owl-center/SugarBatchScanner'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { LaunchGoLivePanel } from '@/components/owl-center/LaunchGoLivePanel'
import { LaunchMintConfigPanel } from '@/components/owl-center/LaunchMintConfigPanel'
import { LaunchPresaleOveragePanel } from '@/components/owl-center/LaunchPresaleOveragePanel'
import { MarketplaceReadinessPanel } from '@/components/owl-center/MarketplaceReadinessPanel'
import { MetadataUploadStatusBadge } from '@/components/owl-center/MetadataUploadStatusBadge'
import { formatValidationErrors, mergeValidationChecklist } from '@/lib/owl-center/asset-validation'
import { formatSugarBatchScanSummary, type SugarBatchScanResult } from '@/lib/owl-center/scan-sugar-batch'
import type { OwlCenterAssetPackage, OwlCenterMarketplaceReadiness } from '@/lib/owl-center/asset-types'
import { OWL_CENTER_METADATA_UPLOAD_STATUSES, OWL_CENTER_VALIDATION_STATUSES } from '@/lib/owl-center/asset-types'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Bundle = {
  launch: OwlCenterLaunchPublic
  assetPackage: OwlCenterAssetPackage | null
  marketplaceReadiness: OwlCenterMarketplaceReadiness | null
}

type ActionZone = 'scan' | 'package' | 'validation' | 'notes' | 'supply'
type ZoneFeedback = { msg: string | null; err: string | null }

function ActionFeedback({ feedback }: { feedback: ZoneFeedback | undefined }) {
  if (!feedback?.msg && !feedback?.err) return null
  return (
    <div className="mt-2 w-full basis-full space-y-2" role="status" aria-live="polite">
      {feedback.err ? (
        <p className="rounded border border-[#FF9C9C]/30 bg-[#FF9C9C]/10 px-3 py-2 font-mono text-sm text-[#FF9C9C]">
          {feedback.err}
        </p>
      ) : null}
      {feedback.msg ? (
        <p className="rounded border border-[#00FF9C]/30 bg-[#00FF9C]/10 px-3 py-2 font-mono text-sm text-[#00FF9C]">
          {feedback.msg}
        </p>
      ) : null}
    </div>
  )
}

export function CollectionAssetsAdminClient({ launchId }: { launchId: string }) {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Partial<Record<ActionZone, ZoneFeedback>>>({})
  const [savingZone, setSavingZone] = useState<ActionZone | null>(null)

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

  const setZoneFeedback = (zone: ActionZone, patch: Partial<ZoneFeedback>) => {
    setFeedback((prev) => ({
      ...prev,
      [zone]: {
        msg: 'msg' in patch ? (patch.msg ?? null) : (prev[zone]?.msg ?? null),
        err: 'err' in patch ? (patch.err ?? null) : (prev[zone]?.err ?? null),
      },
    }))
  }

  const clearZoneFeedback = (zone: ActionZone) => {
    setZoneFeedback(zone, { msg: null, err: null })
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
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
      setLoadErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [launchId])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(body: Record<string, unknown>, zone: ActionZone) {
    setSavingZone(zone)
    clearZoneFeedback(zone)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/assets`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json()) as Bundle & {
        error?: string
        validation_errors?: unknown
        validation_checklist?: unknown
      }
      if (!res.ok) {
        const extra = Array.isArray(j.validation_errors)
          ? formatValidationErrors(j.validation_errors).join(' ')
          : ''
        throw new Error([j.error, extra].filter(Boolean).join(' — ') || 'save_failed')
      }
      setBundle(j)
      setZoneFeedback(zone, { msg: 'Saved successfully.', err: null })
      if (j.assetPackage) {
        setChecklist(mergeValidationChecklist(j.assetPackage.validation_checklist as Record<string, unknown>))
      }
    } catch (e) {
      setZoneFeedback(zone, { err: e instanceof Error ? e.message : 'save_failed', msg: null })
    } finally {
      setSavingZone(null)
    }
  }

  async function alignLaunchSupplyToForm() {
    const supply = Number(expectedSupply)
    if (!Number.isInteger(supply) || supply < 1) {
      setZoneFeedback('supply', { err: 'Set Expected supply to a positive number first.', msg: null })
      return
    }
    setSavingZone('supply')
    clearZoneFeedback('supply')
    try {
      const res = await fetch(`/api/admin/owl-center/launches/${launchId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ total_supply: supply, public_supply: supply }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'launch_update_failed')
      await load()
      setChecklist((c) => ({
        ...c,
        metadata_count_matches_supply: Number(totalMetadata) === supply,
      }))
      setZoneFeedback('supply', {
        msg: `Launch supply updated to ${supply}. Now click Save asset package.`,
        err: null,
      })
    } catch (e) {
      setZoneFeedback('supply', { err: e instanceof Error ? e.message : 'launch_update_failed', msg: null })
    } finally {
      setSavingZone(null)
    }
  }

  if (loading && !bundle) {
    return <p className="font-mono text-sm text-[#5C6773]">Loading assets console…</p>
  }
  if (loadErr && !bundle) {
    return <p className="font-mono text-sm text-[#FF9C9C]">{loadErr}</p>
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
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <Link
          href="/admin/owl-center"
          className="inline-flex min-h-[44px] touch-manipulation items-center font-mono text-xs uppercase tracking-widest text-[#00C97A] hover:underline"
        >
          ← Owl Center admin
        </Link>
        <Link
          href={`/owl-center/collection/${launch.slug}`}
          className="inline-flex min-h-[44px] touch-manipulation items-center font-mono text-xs text-[#5C6773] hover:text-[#00FF9C]"
        >
          Open collection
        </Link>
      </div>

      <header>
        <h1 className="font-display text-2xl text-[#F4FBF8] sm:text-3xl">Assets & metadata</h1>
        <p className="mt-2 break-all font-mono text-xs leading-relaxed text-[#5C6773]">
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
            Phase B: use <strong className="font-normal text-[#9BA8B4]">Stage Sugar ZIP</strong> below for in-app validate + Arweave
            upload, or paste paths after Sugar CLI (Phase A).
          </p>
        </details>
      </header>

      <LaunchGoLivePanel
        launchId={launchId}
        launch={launch}
        assetPackage={assetPackage}
        marketplaceReadiness={bundle.marketplaceReadiness}
        onPromoted={() => void load()}
      />

      <MetadataRefreshPanel launchId={launchId} />

      <AssetPackageUploadPanel launchId={launchId} onApplied={() => void load()} />

      <SugarDeployPanel launchId={launchId} onApplied={() => void load()} />

      <SugarBatchScanner
        expectedSupply={Number(expectedSupply) || launch.total_supply}
        onApply={(scan: SugarBatchScanResult) => {
          const supply = scan.inferredSupply || scan.metadataCount
          setExpectedSupply(String(supply))
          setTotalImages(String(scan.imageCount))
          setTotalMetadata(String(scan.metadataCount))
          setChecklist({
            ...scan.checklist,
            metadata_count_matches_supply: scan.metadataCount === supply,
          })
          const summary = formatSugarBatchScanSummary(scan)
          setAdminNotes((prev) => (prev.trim() ? `${prev.trim()}\n\n${summary}` : summary))
          setZoneFeedback('scan', {
            msg: scan.ok
              ? `Form filled (${supply} supply). Use Sync launch supply below, then Save asset package.`
              : null,
            err: scan.ok ? null : 'Scanned with issues — fix errors, then save.',
          })
        }}
      />
      <ActionFeedback feedback={feedback.scan} />

      {isGen2 ? <Gen2GeneratorLinkPanel onLinked={() => void load()} /> : null}

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
          After Phase B Arweave upload or Phase A <span className="text-[#E8EEF2]">sugar upload</span>, paste or confirm bundle
          paths below. Mark <span className="text-[#E8EEF2]">ready for Candy Machine</span> when the checklist is complete.
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
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-2">
          {Number(expectedSupply) > 0 && Number(expectedSupply) !== launch.total_supply ? (
            <DeployButton
              type="button"
              variant="ghost"
              className="w-full sm:w-auto"
              disabled={savingZone !== null}
              onClick={() => void alignLaunchSupplyToForm()}
            >
              {savingZone === 'supply' ? 'Saving…' : `Sync launch supply to ${expectedSupply}`}
            </DeployButton>
          ) : null}
          <DeployButton
            type="button"
            className="w-full sm:w-auto"
            disabled={savingZone !== null}
            onClick={() =>
              void patch(
                {
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
              },
                'package'
              )
            }
          >
            {savingZone === 'package' ? 'Saving…' : 'Save asset package'}
          </DeployButton>
          <MetadataUploadStatusBadge status={metadataUploadStatus as OwlCenterAssetPackage['metadata_upload_status']} />
          <ActionFeedback feedback={feedback.supply} />
          <ActionFeedback feedback={feedback.package} />
        </div>
      </CommandCard>

      <CommandCard label="validation_engine.sys · MANUAL_V1">
        <AssetValidationChecklist checklist={checklist} onChange={setChecklist} />
        <div className="mt-6 flex flex-col gap-3 border-t border-[#1A222B] pt-4 sm:flex-row sm:flex-wrap sm:gap-2">
          <DeployButton
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={savingZone !== null}
            onClick={() => void patch({ validation_checklist: checklist }, 'validation')}
          >
            {savingZone === 'validation' ? 'Saving…' : 'Save checklist only'}
          </DeployButton>
          <DeployButton
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={savingZone !== null}
            onClick={() => void patch({ action: 'mark_valid', validation_checklist: checklist }, 'validation')}
          >
            Mark valid
          </DeployButton>
          <DeployButton
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={savingZone !== null}
            onClick={() => void patch({ action: 'mark_needs_review', validation_checklist: checklist }, 'validation')}
          >
            Mark needs review
          </DeployButton>
          <DeployButton
            type="button"
            className="w-full sm:w-auto"
            disabled={savingZone !== null}
            onClick={() => void patch({ action: 'mark_ready_cm', validation_checklist: checklist }, 'validation')}
          >
            Mark ready for Candy Machine
          </DeployButton>
          <ActionFeedback feedback={feedback.validation} />
        </div>
        <p className="mt-3 font-mono text-[10px] text-[#5C6773]">
          Mark valid / Ready for CM needs <strong className="font-normal text-[#9BA8B4]">12/12</strong> checklist. For a 5-piece
          test, set Expected supply to <strong className="font-normal text-[#9BA8B4]">5</strong> and use{' '}
          <strong className="font-normal text-[#9BA8B4]">Sync launch supply</strong> above.
        </p>
        <p className="mt-1 font-mono text-[10px] text-[#5C6773]">
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
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-2">
          <DeployButton
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={savingZone !== null}
            onClick={() => void patch({ admin_notes: adminNotes }, 'notes')}
          >
            {savingZone === 'notes' ? 'Saving…' : 'Save notes'}
          </DeployButton>
          <ActionFeedback feedback={feedback.notes} />
        </div>
      </CommandCard>

      <AssetPackagePanel pkg={assetPackage} />

      <MarketplaceReadinessPanel launchId={launchId} launch={launch} onSaved={() => void load()} />

      <LaunchMintConfigPanel launchId={launchId} launch={launch} onSaved={() => void load()} />

      <LaunchPresaleOveragePanel launchId={launchId} launch={launch} />

    </div>
  )
}
