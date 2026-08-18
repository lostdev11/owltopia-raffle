'use client'

import { useEffect, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { LaunchCoverImageFields } from '@/components/owl-center/LaunchCoverImageFields'
import {
  MintDetailsConfigFields,
} from '@/components/owl-center/MintDetailsConfigFields'
import { isLaunchSupplyConfigLocked } from '@/lib/owl-center/launch-edit-locks'
import { OWL_CENTER_MAX_LAUNCH_SUPPLY } from '@/lib/owl-center/launch-limits'
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

  const supplyLocked = isLaunchSupplyConfigLocked(launch)
  const royaltiesLocked = isLaunchRoyaltyLocked(launch)

  useEffect(() => {
    setValues(mintDetailsFormFromLaunch(launch))
  }, [launch])

  async function save() {
    const priceStr = values.public_price.trim()
    if (priceStr && (!Number.isFinite(Number(priceStr)) || Number(priceStr) < 0)) {
      setErr('Enter a valid public mint price (0 or more). Leave blank to keep the current price.')
      return
    }

    const supply = Number(values.total_supply)
    if (!Number.isInteger(supply) || supply < 1 || supply > OWL_CENTER_MAX_LAUNCH_SUPPLY) {
      setErr(`Total supply must be a whole number between 1 and ${OWL_CENTER_MAX_LAUNCH_SUPPLY.toLocaleString('en-US')}.`)
      return
    }

    setSaving(true)
    setMsg(null)
    setErr(null)
    try {
      const payload = mintDetailsPayloadFromForm(values)
      const res = await fetch(saveApiPath ?? `/api/admin/owl-center/launches/${launchId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = (await res.json()) as {
        error?: string
        launch?: OwlCenterLaunchPublic
        guard_sync?: { ok?: boolean; status?: string; error?: string; reason?: string }
      }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      if (j.guard_sync && j.guard_sync.ok === false) {
        setMsg(
          `Mint details saved, but on-chain Candy Guard was not updated (${j.guard_sync.error ?? 'unknown'}). Public mint dates and the per-wallet cap may still be site-only until guards are synced.`
        )
      } else if (j.guard_sync?.status === 'updated') {
        setMsg('Mint details saved — on-chain start date and per-wallet cap updated.')
      } else {
        setMsg('Mint details saved — collection cards will reflect on next load.')
      }
      if (j.launch) setValues(mintDetailsFormFromLaunch(j.launch))
      onSaved?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setSaving(false)
    }
  }

  const mintDetailsSection = (
    <>
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4]">
        Edit supply, Metaplex Core vs legacy, mint price, schedule, per-wallet limit, and fund wallets.
        {supplyLocked
          ? ' Supply and on-chain standard are locked after Candy Machine deploy.'
          : ' Change supply and Core settings anytime before Candy Machine deploy.'}
      </p>
      <MintDetailsConfigFields
        values={values}
        onChange={setValues}
        defaultWallet={launch.creator_wallet?.trim() ?? ''}
        royaltiesLocked={royaltiesLocked}
        showSupplyField
        supplyConfigLocked={supplyLocked}
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
        <CommandCardSection id="mint-details" label="MINT DETAILS">
          {mintDetailsSection}
        </CommandCardSection>
        <CommandCardSection label="HUB CARD · COVER">{coverSection}</CommandCardSection>
      </>
    )
  }

  return (
    <div className="grid gap-6">
      <CommandCard id="mint-details" label="MINT DETAILS">
        {mintDetailsSection}
      </CommandCard>
      <CommandCard label="HUB CARD · COVER">{coverSection}</CommandCard>
    </div>
  )
}
