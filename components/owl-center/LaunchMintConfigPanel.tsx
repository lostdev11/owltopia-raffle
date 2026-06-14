'use client'

import { useEffect, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  MintDetailsConfigFields,
} from '@/components/owl-center/MintDetailsConfigFields'
import {
  mintDetailsFormFromLaunch,
  mintDetailsPayloadFromForm,
  type MintDetailsFormValues,
} from '@/lib/owl-center/launch-mint-config'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Props = {
  launchId: string
  launch: OwlCenterLaunchPublic
  onSaved?: () => void
  /** Defaults to admin PATCH; creators use `/api/owl-center/launches/{id}/mint-config`. */
  saveApiPath?: string
}

export function LaunchMintConfigPanel({ launchId, launch, onSaved, saveApiPath }: Props) {
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

  return (
    <CommandCard label="MINT_DETAILS · CREATOR_CONFIG">
      <MintDetailsConfigFields
        values={{ ...values, total_supply: String(launch.total_supply) }}
        onChange={(next) => setValues({ ...next, total_supply: String(launch.total_supply) })}
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
    </CommandCard>
  )
}
