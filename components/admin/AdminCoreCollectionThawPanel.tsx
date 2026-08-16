'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/**
 * Unlock trading (Core PermanentFreezeDelegate thaw) — admin or creator Manage collection.
 * Does not freeze; lock-at-mint already froze assets.
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
  const [confirming, setConfirming] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (launch.mint_standard !== 'core' || !launch.freeze_enabled) return null

  const unlocked = launch.freeze_status === 'thawed'
  const canUnlock = Boolean(launch.collection_mint?.trim()) && !unlocked
  const path = apiPath ?? `/api/admin/owl-center/collections/${launch.id}/core-thaw`

  async function unlockTrading() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
      })
      const j = (await res.json()) as { ok?: boolean; error?: string; signature?: string }
      if (!res.ok) throw new Error(j.error || 'unlock_failed')
      setMsg(j.signature ? `Trading enabled · ${j.signature.slice(0, 12)}…` : 'Trading enabled')
      setConfirming(false)
      onChanged?.()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'unlock_failed')
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <>
      <p className="mb-3 text-sm leading-relaxed text-[#9BA8B4]">
        <strong className="font-normal text-[#E8EEF2]">Enable trading (unlock all NFTs)</strong> — only when mint
        is finished (or you are ready for Magic Eden / Tensor). This does not lock NFTs. You already chose
        “Lock NFTs until trading” at mint setup.
      </p>
      <p className="mb-4 font-mono text-xs text-[#C5D0D8]">
        {unlocked ? 'Trading unlocked' : 'NFTs locked until you enable trading'}
        {launch.unfreeze_date ? ` · planned ${new Date(launch.unfreeze_date).toLocaleString()}` : ''}
        {launch.minted_count > 0 ? ` · ${launch.minted_count} minted` : ''}
      </p>

      {!unlocked && confirming ? (
        <div className="mb-4 grid gap-3 border border-[#FFD769]/30 bg-[#FFD769]/10 p-3">
          <p className="text-sm text-[#FFD769]">
            Unlock trading for the entire collection? Holders will be able to transfer and list NFTs. You usually
            do this only after mint is done.
          </p>
          <div className="flex flex-wrap gap-2">
            <DeployButton type="button" disabled={busy || !canUnlock} onClick={() => void unlockTrading()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Yes, enable trading
            </DeployButton>
            <DeployButton type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </DeployButton>
          </div>
        </div>
      ) : (
        <DeployButton
          type="button"
          disabled={!canUnlock || busy}
          onClick={() => {
            setMsg(null)
            setConfirming(true)
          }}
        >
          {unlocked ? 'Trading already enabled' : 'Enable trading (unlock all NFTs)'}
        </DeployButton>
      )}

      {msg ? (
        <p
          className={`mt-2 font-mono text-xs ${
            msg.startsWith('Trading enabled') ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'
          }`}
        >
          {msg}
        </p>
      ) : null}
    </>
  )

  if (embedded) {
    return (
      <CommandCardSection id="enable-trading" label="ENABLE TRADING">
        {body}
      </CommandCardSection>
    )
  }

  return (
    <CommandCard id="enable-trading" label="enable_trading">
      {body}
    </CommandCard>
  )
}
