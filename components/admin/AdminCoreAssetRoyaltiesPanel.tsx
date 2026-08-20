'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type RoyaltyRow = {
  mint: string
  status: 'added' | 'already' | 'skipped' | 'failed'
  signature?: string
  reason?: string
  error?: string
}

type RoyaltiesResponse = {
  ok?: boolean
  error?: string
  processed?: number
  remaining?: number
  results?: RoyaltyRow[]
}

/**
 * Attach Core Royalties plugins onto minted assets so Solscan / Orb DAS show the launch %.
 * Collection plugins are not enough — those indexers read asset JSON / asset plugins only.
 */
export function AdminCoreAssetRoyaltiesPanel({
  launch,
  onChanged,
  apiPath,
  embedded = false,
}: {
  launch: OwlCenterLaunchPublic
  onChanged?: () => void
  /** Defaults to admin route; pass creator path for partner Manage collection. */
  apiPath?: string
  embedded?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  if (launch.mint_standard !== 'core' || launch.minted_count <= 0) return null

  const canRun = Boolean(launch.collection_mint?.trim())
  const path = apiPath ?? `/api/admin/owl-center/collections/${launch.id}/core-royalties`

  async function stampRoyalties() {
    setBusy(true)
    setMsg(null)
    setOk(false)
    try {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const j = (await res.json()) as RoyaltiesResponse
      if (!res.ok || !j.ok) throw new Error(j.error || 'royalties_failed')
      const added = (j.results ?? []).filter((row) => row.status === 'added').length
      const already = (j.results ?? []).filter((row) => row.status === 'already').length
      const failed = (j.results ?? []).filter((row) => row.status === 'failed')
      const remaining = j.remaining ?? 0
      const parts = [`${added} stamped`, `${already} already set`]
      if (failed.length) parts.push(`${failed.length} failed`)
      if (remaining > 0) parts.push(`${remaining} remaining — run again`)
      setMsg(parts.join(' · '))
      setOk(failed.length === 0)
      setConfirming(false)
      onChanged?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'royalties_failed')
      setOk(false)
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <>
      <p className="mb-3 text-sm leading-relaxed text-[#9BA8B4]">
        <strong className="font-normal text-[#E8EEF2]">Show royalties on explorers</strong> — Solscan and Orb
        DAS read each NFT’s own Royalties plugin. Collection 10% is ignored there, so they report 0% / not
        set. This stamps the launch royalty onto minted Core assets (up to 20 per click).
      </p>
      <p className="mb-4 font-mono text-xs text-[#C5D0D8]">
        {launch.minted_count} minted
        {launch.collection_mint ? ` · collection ${launch.collection_mint.slice(0, 8)}…` : ' · deploy first'}
      </p>

      {confirming ? (
        <div className="mb-4 grid gap-3 border border-[#FFD769]/30 bg-[#FFD769]/10 p-3">
          <p className="text-sm text-[#FFD769]">
            Add the Royalties plugin on-chain to minted NFTs? This uses the collection update authority and
            does not move NFTs.
          </p>
          <div className="flex flex-wrap gap-2">
            <DeployButton type="button" disabled={busy || !canRun} onClick={() => void stampRoyalties()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Yes, stamp royalties
            </DeployButton>
            <DeployButton type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </DeployButton>
          </div>
        </div>
      ) : (
        <DeployButton
          type="button"
          disabled={!canRun || busy}
          onClick={() => {
            setMsg(null)
            setConfirming(true)
          }}
        >
          Show royalties on explorers
        </DeployButton>
      )}

      {msg ? (
        <p className={`mt-2 font-mono text-xs ${ok ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'}`}>{msg}</p>
      ) : null}
    </>
  )

  if (embedded) {
    return (
      <CommandCardSection id="core-asset-royalties" label="EXPLORER ROYALTIES">
        {body}
      </CommandCardSection>
    )
  }

  return (
    <CommandCard id="core-asset-royalties" label="explorer_royalties">
      {body}
    </CommandCard>
  )
}
