'use client'

import { useEffect, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { LaunchCoverImageFields } from '@/components/owl-center/LaunchCoverImageFields'
import {
  MintDetailsConfigFields,
} from '@/components/owl-center/MintDetailsConfigFields'
import { OwlCenterSaveNotice } from '@/components/owl-center/OwlCenterSaveNotice'
import { isLaunchSupplyConfigLocked } from '@/lib/owl-center/launch-edit-locks'
import { OWL_CENTER_MAX_LAUNCH_SUPPLY } from '@/lib/owl-center/launch-limits'
import {
  mintDetailsFormFromLaunch,
  mintDetailsPayloadFromForm,
  resolveMintOpensAt,
  scheduleInstantsEqual,
  type MintDetailsFormValues,
} from '@/lib/owl-center/launch-mint-config'
import { formatMintDate } from '@/lib/owl-center/phase-schedule'
import { isLaunchRoyaltyLocked } from '@/lib/owl-center/royalty'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Props = {
  launchId: string
  launch: OwlCenterLaunchPublic
  onSaved?: (launch?: OwlCenterLaunchPublic) => void
  /** Defaults to admin PATCH; creators use `/api/owl-center/launches/{id}/mint-config`. */
  saveApiPath?: string
  /** Render as sections inside a parent CommandCard instead of separate cards. */
  embedded?: boolean
}

export function LaunchMintConfigPanel({ launchId, launch, onSaved, saveApiPath, embedded = false }: Props) {
  const [values, setValues] = useState<MintDetailsFormValues>(() =>
    mintDetailsFormFromLaunch(launch)
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const supplyLocked = isLaunchSupplyConfigLocked(launch)
  const royaltiesLocked = isLaunchRoyaltyLocked(launch)
  const launchStamp = `${launch.id}:${launch.updated_at}:${launch.launch_deadline_at}:${launch.phase_schedule?.PUBLIC ?? ''}`

  useEffect(() => {
    if (dirty) return
    setValues(mintDetailsFormFromLaunch(launch))
  }, [launchStamp, dirty, launch])

  function updateValues(next: MintDetailsFormValues) {
    setDirty(true)
    setValues(next)
  }

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
      const responseText = await res.text()
      let j: {
        error?: string
        launch?: OwlCenterLaunchPublic
        guard_sync?: { ok?: boolean; status?: string; error?: string; reason?: string }
        warnings?: string[]
      }
      try {
        j = responseText ? (JSON.parse(responseText) as typeof j) : {}
      } catch {
        throw new Error(`Save failed (${res.status})`)
      }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      const saved = j.launch
      const requestedIso = typeof payload.launch_date === 'string' ? payload.launch_date : null
      const savedIso = saved ? resolveMintOpensAt(saved) : requestedIso
      if (requestedIso && savedIso && !scheduleInstantsEqual(requestedIso, savedIso)) {
        setErr(
          `Date did not save. You entered ${formatMintDate(requestedIso)}, but the collection still has ${formatMintDate(savedIso)}.`
        )
        setDirty(true)
      } else {
        if (saved) setValues(mintDetailsFormFromLaunch(saved))
        setDirty(false)
        const opensLabel = formatMintDate(savedIso ?? requestedIso)
        const warningSuffix = j.warnings?.length ? ` ${j.warnings.join(' ')}` : ''
        if (j.guard_sync && j.guard_sync.ok === false) {
          setMsg(
            `Saved. Mint opens ${opensLabel}. On-chain Candy Guard was not updated (${j.guard_sync.error ?? 'unknown'}). Dates may still be site-only until guards are synced.${warningSuffix}`
          )
        } else if (j.guard_sync?.status === 'updated') {
          setMsg(`Saved. Mint opens ${opensLabel}. On-chain start date and per-wallet cap updated.${warningSuffix}`)
        } else {
          setMsg(`Saved. Mint opens ${opensLabel}.${warningSuffix}`)
        }
        onSaved?.(saved)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setSaving(false)
    }
  }

  const notices =
    err || msg ? (
      <div className="mb-4 space-y-2">
        <OwlCenterSaveNotice tone="error" message={err} />
        <OwlCenterSaveNotice message={msg} />
      </div>
    ) : null

  const mintDetailsSection = (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {notices}
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4]">
        Edit supply, Metaplex Core vs legacy, mint price, schedule, per-wallet limit, and fund wallets.
        {supplyLocked
          ? ' Supply and on-chain standard are locked after Candy Machine deploy.'
          : ' Change supply and Core settings anytime before Candy Machine deploy.'}
      </p>
      <MintDetailsConfigFields
        values={values}
        onChange={updateValues}
        defaultWallet={launch.creator_wallet?.trim() ?? ''}
        royaltiesLocked={royaltiesLocked}
        showSupplyField
        supplyConfigLocked={supplyLocked}
      />
      <div className="mt-6 flex flex-wrap gap-2 border-t border-[#1A222B] pt-4">
        <DeployButton type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save mint details'}
        </DeployButton>
        <DeployButton
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => {
            setValues(mintDetailsFormFromLaunch(launch))
            setDirty(false)
            setMsg(null)
            setErr(null)
          }}
        >
          Reset
        </DeployButton>
      </div>
    </form>
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
