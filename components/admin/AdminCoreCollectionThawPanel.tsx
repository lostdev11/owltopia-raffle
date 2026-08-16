'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/**
 * Thaw Metaplex Core PermanentFreezeDelegate — admin or creator Manage collection.
 * Thaw = unfreeze for trading (does not freeze).
 */
export function AdminCoreCollectionThawPanel({
  launch,
  onChanged,
  apiPath,
  embedded = false,
}: {
  launch: OwlCenterLaunchPublic
  onChanged?: () => void
  /** Defaults to admin thaw route; pass creator path for partner Manage collection. */
  apiPath?: string
  embedded?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (launch.mint_standard !== 'core' || !launch.freeze_enabled) return null

  const thawed = launch.freeze_status === 'thawed'
  const canThaw = Boolean(launch.collection_mint?.trim()) && !thawed
  const path = apiPath ?? `/api/admin/owl-center/collections/${launch.id}/core-thaw`

  async function thaw() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
      })
      const j = (await res.json()) as { ok?: boolean; error?: string; signature?: string }
      if (!res.ok) throw new Error(j.error || 'thaw_failed')
      setMsg(j.signature ? `Thawed · ${j.signature.slice(0, 12)}…` : 'Thawed')
      onChanged?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'thaw_failed')
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <>
      <p className={embedded ? 'mb-3 text-sm text-[#9BA8B4]' : 'mb-3 text-sm text-[#9BA8B4]'}>
        Thaw = unfreeze for trading. Only run this when mint is done (or you are ready for secondary
        markets). One transaction enables transfers for every asset in the collection. This does not
        freeze — Freeze Collection at mint already did that.
      </p>
      <p className="mb-4 font-mono text-xs text-[#C5D0D8]">
        status={launch.freeze_status}
        {launch.unfreeze_date ? ` · planned ${launch.unfreeze_date}` : ''}
      </p>
      <DeployButton type="button" disabled={!canThaw || busy} onClick={() => void thaw()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {thawed ? 'Already thawed (trading enabled)' : 'Thaw collection (enable trading)'}
      </DeployButton>
      {msg ? (
        <p className={`mt-2 font-mono text-xs ${msg.startsWith('Thawed') ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'}`}>
          {msg}
        </p>
      ) : null}
    </>
  )

  if (embedded) {
    return <CommandCardSection label="FREEZE · THAW">{body}</CommandCardSection>
  }

  return <CommandCard label="core_freeze.sys">{body}</CommandCard>
}
