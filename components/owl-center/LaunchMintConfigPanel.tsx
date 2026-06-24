'use client'

import { useEffect, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { LaunchCoverImageFields } from '@/components/owl-center/LaunchCoverImageFields'
import {
  MintDetailsConfigFields,
} from '@/components/owl-center/MintDetailsConfigFields'
import {
  mintDetailsFormFromLaunch,
  mintDetailsPayloadFromForm,
  type MintDetailsFormValues,
} from '@/lib/owl-center/launch-mint-config'
import { isLaunchRoyaltyLocked } from '@/lib/owl-center/royalty'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Props = {
  launchId: string
  launch: OwlCenterLaunchPublic
  onSaved?: () => void
  /** Defaults to admin PATCH; creators use `/api/owl-center/launches/{id}/mint-config`. */
  saveApiPath?: string
  /** Render as sections inside a parent CommandCard instead of separate cards. */
  embedded?: boolean
}

export function LaunchMintConfigPanel({ launchId, launch, onSaved, saveApiPath, embedded = false }: Props) {
  const [values, setValues] = useState<MintDetailsFormValues>(() =>
    mintDetailsFormFromLaunch(launch)
  )
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setValues(mintDetailsFormFromLaunch(launch))
  }, [launch])

  async function save() {
    const priceStr = values.public_price.trim()
    if (priceStr && (!Number.isFinite(Number(priceStr)) || Number(priceStr) < 0)) {
      setErr('Enter a valid public mint price (0 or more). Leave blank to keep the current price.')
      return
    }

    setSaving(true)
    setMsg(null)
    setErr(null)
    try {
      const payload = mintDetailsPayloadFromForm({
        ...values,
        total_supply: String(launch.total_supply),
      })
      const res = await fetch(saveApiPath ?? `/api/admin/owl-center/launches/${launchId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = (await res.json()) as { error?: string; launch?: OwlCenterLaunchPublic }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      setMsg('Mint details saved — collection cards will reflect on next load.')
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setSaving(false)
    }
  }

  const mintDetailsSection = (
    <>
      <MintDetailsConfigFields
        values={{ ...values, total_supply: String(launch.total_supply) }}
        onChange={(next) => setValues({ ...next, total_supply: String(launch.total_supply) })}
        defaultWallet={launch.creator_wallet?.trim() ?? ''}
        royaltiesLocked={isLaunchRoyaltyLocked(launch)}
      />
      <div className="mt-6 flex flex-wrap gap-2 border-t border-[#1A222B] pt-4">
        <DeployButton type="button" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save mint details'}
        </DeployButton>
        <DeployButton
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => setValues(mintDetailsFormFromLaunch(launch))}
        >
          Reset
        </DeployButton>
      </div>
      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </>
  )

  const coverSection = (
    <LaunchCoverImageFields
      launchId={launchId}
      initialCoverUrl={launch.image_url}
      coverOptionsPath={`/api/owl-center/launches/${launchId}/cover-options`}
      coverSavePath={saveApiPath ?? `/api/admin/owl-center/launches/${launchId}`}
      onSaved={() => onSaved?.()}
    />
  )

  if (embedded) {
    return (
      <>
        <CommandCardSection first label="MINT_DETAILS · CREATOR_CONFIG">
          {mintDetailsSection}
        </CommandCardSection>
        <CommandCardSection label="HUB_CARD · COVER">{coverSection}</CommandCardSection>
      </>
    )
  }

  return (
    <div className="grid gap-6">
      <CommandCard label="MINT_DETAILS · CREATOR_CONFIG">{mintDetailsSection}</CommandCard>
      <CommandCard label="HUB_CARD · COVER">{coverSection}</CommandCard>
    </div>
  )
}
