'use client'

import { useCallback, useEffect, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { MarketplaceStatusBadge } from '@/components/owl-center/MarketplaceStatusBadge'
import { ReadinessChecklist, type ReadinessChecklistItem } from '@/components/owl-center/ReadinessChecklist'
import type { OwlCenterMarketplaceReadiness } from '@/lib/owl-center/asset-types'
import { OWL_CENTER_MARKETPLACE_STATUSES } from '@/lib/owl-center/asset-types'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Props = {
  launchId: string
  launch?: OwlCenterLaunchPublic | null
  compact?: boolean
  onSaved?: () => void
}

export function MarketplaceReadinessPanel({ launchId, launch: launchProp, compact, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [row, setRow] = useState<OwlCenterMarketplaceReadiness | null>(null)

  const [collectionMint, setCollectionMint] = useState('')
  const [candyMachineId, setCandyMachineId] = useState('')
  const [hashListUrl, setHashListUrl] = useState('')
  const [meUrl, setMeUrl] = useState('')
  const [tensorUrl, setTensorUrl] = useState('')
  const [metadataStatus, setMetadataStatus] = useState<string>('NOT_READY')
  const [verifiedStatus, setVerifiedStatus] = useState<string>('NOT_READY')
  const [meStatus, setMeStatus] = useState<string>('NOT_READY')
  const [tensorStatus, setTensorStatus] = useState<string>('NOT_READY')
  const [tradingActive, setTradingActive] = useState(false)
  const [notes, setNotes] = useState('')
  const [confirmTrading, setConfirmTrading] = useState(false)
  const [forceTrading, setForceTrading] = useState(false)

  const [opsItems, setOpsItems] = useState<ReadinessChecklistItem[]>([
    { id: '1', label: 'Assets validated', checked: false },
    { id: '2', label: 'Metadata uploaded to permanent storage', checked: false },
    { id: '3', label: 'Candy Machine deployed', checked: false },
    { id: '4', label: 'Collection mint verified', checked: false },
    { id: '5', label: 'Mint completed or active', checked: false },
    { id: '6', label: 'Hash list generated', checked: false },
    { id: '7', label: 'Magic Eden indexed / claimed', checked: false },
    { id: '8', label: 'Tensor indexed / verified', checked: false },
    { id: '9', label: 'Trading links activated in Owl Center', checked: false },
  ])

  const applyRow = useCallback((r: OwlCenterMarketplaceReadiness) => {
    setRow(r)
    setCollectionMint(r.collection_mint ?? '')
    setCandyMachineId(r.candy_machine_id ?? '')
    setHashListUrl(r.hash_list_url ?? '')
    setMeUrl(r.magic_eden_url ?? '')
    setTensorUrl(r.tensor_url ?? '')
    setMetadataStatus(r.metadata_status)
    setVerifiedStatus(r.verified_collection_status)
    setMeStatus(r.magic_eden_status)
    setTensorStatus(r.tensor_status)
    setTradingActive(r.trading_links_active)
    setNotes(r.notes ?? '')
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/marketplaces`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as { marketplaceReadiness?: OwlCenterMarketplaceReadiness; error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      if (j.marketplaceReadiness) applyRow(j.marketplaceReadiness)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [applyRow, launchId])

  useEffect(() => {
    void load()
  }, [load])

  async function save(patch: Record<string, unknown>) {
    setMsg(null)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/owl-center/collections/${launchId}/marketplaces`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const j = (await res.json()) as {
        marketplaceReadiness?: OwlCenterMarketplaceReadiness
        go_live?: { ok?: boolean; already_live?: boolean; launch?: { slug?: string } }
        error?: string
      }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      if (j.marketplaceReadiness) applyRow(j.marketplaceReadiness)
      if (j.go_live?.ok && !j.go_live.already_live) {
        setMsg('Saved — launch auto-approved and is live on the public mint console.')
      } else if (j.go_live?.ok && j.go_live.already_live) {
        setMsg('Saved — launch was already live.')
      } else {
        setMsg('Saved')
      }
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    }
  }

  function onOpsToggle(id: string, next: boolean) {
    setOpsItems((prev) => prev.map((x) => (x.id === id ? { ...x, checked: next } : x)))
  }

  if (loading && !row) {
    return (
      <CommandCard label="marketplace_indexing.sys">
        <p className="font-mono text-sm text-[#5C6773]">Loading marketplace readiness…</p>
      </CommandCard>
    )
  }

  return (
    <CommandCard label="MARKETPLACE_INDEXING · TRADING_ACTIVATION">
      <p className="mb-4 text-xs leading-relaxed text-[#9BA8B4]">
        Owl Center does not directly upload to Magic Eden or Tensor in V1. Solana NFT collections are indexed from on-chain
        metadata. Paste final marketplace URLs after indexing or claiming. Use verified collection metadata and permanent image /
        metadata storage. Trading links should only be activated once the collection is indexed and ready.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        <MarketplaceStatusBadge label="ME" status={meStatus as OwlCenterMarketplaceReadiness['magic_eden_status']} />
        <MarketplaceStatusBadge label="TENSOR" status={tensorStatus as OwlCenterMarketplaceReadiness['tensor_status']} />
        <MarketplaceStatusBadge label="META" status={metadataStatus as OwlCenterMarketplaceReadiness['metadata_status']} />
      </div>

      {!compact ? (
        <div className="mb-8 border border-[#1A222B] bg-[#0F1419]/70 p-4">
          <ReadinessChecklist title="OPS_CHECKLIST.local" items={opsItems} onToggle={onOpsToggle} />
          <p className="mt-2 font-mono text-[10px] text-[#5C6773]">
            Local checklist only (V1) — does not persist; use activity logs for audit if needed.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Collection mint
          <input
            value={collectionMint}
            onChange={(e) => setCollectionMint(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Candy Machine ID
          <input
            value={candyMachineId}
            onChange={(e) => setCandyMachineId(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
          Hash list URL
          <input
            value={hashListUrl}
            onChange={(e) => setHashListUrl(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Magic Eden URL
          <input
            value={meUrl}
            onChange={(e) => setMeUrl(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Tensor URL
          <input
            value={tensorUrl}
            onChange={(e) => setTensorUrl(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>

        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Metadata status
          <select
            value={metadataStatus}
            onChange={(e) => setMetadataStatus(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
          >
            {OWL_CENTER_MARKETPLACE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Verified collection status
          <select
            value={verifiedStatus}
            onChange={(e) => setVerifiedStatus(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
          >
            {OWL_CENTER_MARKETPLACE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Magic Eden status
          <select
            value={meStatus}
            onChange={(e) => setMeStatus(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
          >
            {OWL_CENTER_MARKETPLACE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Tensor status
          <select
            value={tensorStatus}
            onChange={(e) => setTensorStatus(e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
          >
            {OWL_CENTER_MARKETPLACE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
          <input
            type="checkbox"
            checked={tradingActive}
            onChange={(e) => setTradingActive(e.target.checked)}
            className="h-4 w-4 accent-[#00FF9C]"
          />
          Trading links active (surfaced publicly when URLs synced)
        </label>

        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] md:col-span-2">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#1A222B] pt-4">
        <label className="flex items-center gap-2 font-mono text-[10px] text-[#5C6773]">
          <input
            type="checkbox"
            checked={confirmTrading}
            onChange={(e) => setConfirmTrading(e.target.checked)}
            className="h-4 w-4 accent-[#00FF9C]"
          />
          Confirm TRADING_ACTIVE transition (requires SOLD_OUT or force below)
        </label>
        <label className="flex items-center gap-2 font-mono text-[10px] text-[#5C6773]">
          <input
            type="checkbox"
            checked={forceTrading}
            onChange={(e) => setForceTrading(e.target.checked)}
            className="h-4 w-4 accent-[#00FF9C]"
          />
          Force trading transition (admin override)
        </label>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <DeployButton
          type="button"
          onClick={() =>
            void save({
              collection_mint: collectionMint.trim() || null,
              candy_machine_id: candyMachineId.trim() || null,
              hash_list_url: hashListUrl.trim() || null,
              magic_eden_url: meUrl.trim() || null,
              tensor_url: tensorUrl.trim() || null,
              metadata_status: metadataStatus,
              verified_collection_status: verifiedStatus,
              magic_eden_status: meStatus,
              tensor_status: tensorStatus,
              trading_links_active: tradingActive,
              notes: notes.trim() || null,
              confirm_trading_transition: confirmTrading,
              force_trading_transition: forceTrading,
            })
          }
        >
          Save marketplace status
        </DeployButton>
        <DeployButton type="button" variant="ghost" onClick={() => void save({ action: 'mark_ready_indexing' })}>
          Mark ready for indexing
        </DeployButton>
        <DeployButton type="button" variant="ghost" onClick={() => void save({ action: 'mark_me_listed' })}>
          Mark ME listed
        </DeployButton>
        <DeployButton type="button" variant="ghost" onClick={() => void save({ action: 'mark_tensor_listed' })}>
          Mark Tensor listed
        </DeployButton>
        <DeployButton type="button" variant="ghost" onClick={() => void save({ action: 'activate_trading_links' })}>
          Activate trading links
        </DeployButton>
        {meUrl.trim() ? (
          <a
            href={meUrl.trim()}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#1A222B] px-4 text-xs uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35"
          >
            Open Magic Eden
          </a>
        ) : null}
        {tensorUrl.trim() ? (
          <a
            href={tensorUrl.trim()}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#1A222B] px-4 text-xs uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35"
          >
            Open Tensor
          </a>
        ) : null}
      </div>

      {launchProp ? (
        <p className="mt-4 font-mono text-[10px] text-[#5C6773]">
          Launch mirror · status={launchProp.status} phase={launchProp.active_phase} · marketplace_ready=
          {String(launchProp.marketplace_ready)} · ME={launchProp.magic_eden_url ?? '—'} · TE={launchProp.tensor_url ?? '—'}
        </p>
      ) : null}

      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </CommandCard>
  )
}
