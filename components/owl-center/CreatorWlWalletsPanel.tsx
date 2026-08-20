'use client'

import { useCallback, useEffect, useState } from 'react'

import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { OwlCenterSaveNotice } from '@/components/owl-center/OwlCenterSaveNotice'
import { creatorWlWalletsApiPath } from '@/lib/owl-center/creator-api-paths'
import { launchHasWhitelistProgram } from '@/lib/owl-center/launch-wl-window'
import {
  resolvePartnerAllowlistPhases,
  type PartnerAllowlistPhase,
} from '@/lib/owl-center/partner-allowlist-phases'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type WlRow = {
  wallet: string
  phase_key?: string
  allowed_mints: number
  used_mints: number
  note: string | null
}

type Props = {
  launchId: string
  launch: OwlCenterLaunchPublic
  embedded?: boolean
}

export function CreatorWlWalletsPanel({ launchId, launch, embedded = false }: Props) {
  const phases = resolvePartnerAllowlistPhases(launch)
  const wlEnabled = launchHasWhitelistProgram(launch)
  const [phaseKey, setPhaseKey] = useState(phases[0]?.key ?? 'wl')
  const [text, setText] = useState('')
  const [allowed, setAllowed] = useState('1')
  const [rows, setRows] = useState<WlRow[]>([])
  const [apiPhases, setApiPhases] = useState<PartnerAllowlistPhase[]>(phases)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [totals, setTotals] = useState<{ wallet_count: number; total_allowed: number; total_used: number } | null>(
    null
  )

  useEffect(() => {
    const next = resolvePartnerAllowlistPhases(launch)
    setApiPhases(next)
    if (next.length > 0 && !next.some((p) => p.key === phaseKey)) {
      setPhaseKey(next[0]!.key)
    }
  }, [launch, phaseKey])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`${creatorWlWalletsApiPath(launchId)}?phase=${encodeURIComponent(phaseKey)}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as {
        error?: string
        rows?: WlRow[]
        phases?: PartnerAllowlistPhase[]
        wallet_count?: number
        total_allowed?: number
        total_used?: number
      }
      if (!res.ok) throw new Error(j.error || 'Failed to load whitelist')
      setRows(j.rows ?? [])
      if (j.phases?.length) setApiPhases(j.phases)
      setTotals({
        wallet_count: j.wallet_count ?? j.rows?.length ?? 0,
        total_allowed: j.total_allowed ?? 0,
        total_used: j.total_used ?? 0,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load whitelist')
    } finally {
      setLoading(false)
    }
  }, [launchId, phaseKey])

  useEffect(() => {
    void load()
  }, [load])

  async function upload() {
    setSaving(true)
    setMsg(null)
    setErr(null)
    try {
      const res = await fetch(creatorWlWalletsApiPath(launchId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          phase_key: phaseKey,
          allowed_mints: Math.max(1, Math.floor(Number(allowed) || 1)),
        }),
      })
      const j = (await res.json()) as {
        error?: string
        upserted?: number
        failed?: Array<{ wallet: string; error: string }>
      }
      if (!res.ok) throw new Error(j.error || 'Upload failed')
      const failN = j.failed?.length ?? 0
      setMsg(
        failN
          ? `Saved. Added ${j.upserted ?? 0} wallet(s); ${failN} failed.`
          : `Saved. Added ${j.upserted ?? 0} wallet(s) to ${activeLabel}.`
      )
      setText('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(wallet: string) {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(
        `${creatorWlWalletsApiPath(launchId)}?wallet=${encodeURIComponent(wallet)}&phase=${encodeURIComponent(phaseKey)}`,
        { method: 'DELETE', credentials: 'include' }
      )
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'Remove failed')
      setMsg(`Saved. Removed ${wallet.slice(0, 4)}…`)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setSaving(false)
    }
  }

  const activeLabel = apiPhases.find((p) => p.key === phaseKey)?.label ?? phaseKey

  function walletsText() {
    return rows.map((r) => r.wallet).join('\n')
  }

  async function copyWallets() {
    const text = walletsText()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setMsg(`Saved. Copied ${rows.length} wallet(s).`)
      setErr(null)
    } catch {
      setErr('Could not copy wallets')
    }
  }

  function downloadCsv() {
    if (rows.length === 0) return
    const header = 'wallet,phase_key,allowed_mints,used_mints'
    const lines = rows.map((r) => `${r.wallet},${phaseKey},${r.allowed_mints},${r.used_mints}`)
    const csv = `\uFEFF${header}\n${lines.join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wl-${phaseKey}-${launchId.slice(0, 8)}.csv`
    a.rel = 'noopener'
    a.click()
    URL.revokeObjectURL(url)
    setMsg(`Saved. Downloaded ${rows.length} wallet(s) as CSV.`)
    setErr(null)
  }

  const body = (
    <div className="grid gap-4">
      <p className="text-sm leading-relaxed text-[#9BA8B4]">
        Paste wallets for each allowlist phase. During that phase window (after its start, before the next phase or
        public), only wallets on the active list can mint — up to their spot count.
      </p>

      {!wlEnabled ? (
        <p className="rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          No allowlist phases yet. Turn on Allowlist phases in Mint details (Show Advanced), add Team / OG / WL, save,
          then come back here.
        </p>
      ) : null}

      {apiPhases.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {apiPhases.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={saving}
              onClick={() => setPhaseKey(p.key)}
              className={`min-h-[40px] border px-3 py-2 font-mono text-[10px] uppercase tracking-widest ${
                phaseKey === p.key
                  ? 'border-[#00FF9C]/50 bg-[#00FF9C]/15 text-[#00FF9C]'
                  : 'border-[#1A222B] bg-[#0F1419] text-[#9BA8B4]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}

      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Wallets for {activeLabel} (one per line, or comma / space separated)
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          disabled={!wlEnabled || saving}
          placeholder="Paste wallets here…"
          className="min-h-[120px] border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8] disabled:opacity-50"
        />
      </label>

      <label className="grid max-w-[10rem] gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Spots per wallet
        <input
          type="number"
          min={1}
          max={50}
          value={allowed}
          disabled={!wlEnabled || saving}
          onChange={(e) => setAllowed(e.target.value)}
          className="min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8] disabled:opacity-50"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <DeployButton type="button" disabled={!wlEnabled || saving || !text.trim()} onClick={() => void upload()}>
          {saving ? 'Saving…' : `Add to ${activeLabel}`}
        </DeployButton>
        <DeployButton type="button" variant="ghost" disabled={loading || saving} onClick={() => void load()}>
          Refresh
        </DeployButton>
        <DeployButton type="button" variant="ghost" disabled={loading || saving || rows.length === 0} onClick={() => void copyWallets()}>
          Copy wallets
        </DeployButton>
        <DeployButton type="button" variant="ghost" disabled={loading || saving || rows.length === 0} onClick={() => downloadCsv()}>
          Download CSV
        </DeployButton>
      </div>

      <div className="space-y-2">
        <OwlCenterSaveNotice tone="error" message={err} />
        <OwlCenterSaveNotice message={msg} />
      </div>

      <div className="border-t border-[#1A222B] pt-4">
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773]">
          {activeLabel} list
          {totals
            ? ` · ${totals.wallet_count} wallets · ${totals.total_used}/${totals.total_allowed} spots used`
            : ''}
        </p>
        {loading ? (
          <p className="font-mono text-xs text-[#5C6773]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="font-mono text-xs text-[#5C6773]">No wallets yet for this phase.</p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {rows.map((r) => (
              <li
                key={r.wallet}
                className="flex flex-wrap items-center justify-between gap-2 border border-[#1A222B] bg-[#0F1419]/80 px-3 py-2 font-mono text-xs text-[#C5D0D8]"
              >
                <span className="break-all">{r.wallet}</span>
                <span className="text-[#5C6773]">
                  {r.used_mints}/{r.allowed_mints}
                </span>
                <DeployButton
                  type="button"
                  variant="ghost"
                  className="min-h-[36px] px-3 text-[10px]"
                  disabled={saving}
                  onClick={() => void remove(r.wallet)}
                >
                  Remove
                </DeployButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  if (embedded) {
    return <CommandCardSection id="wl-wallets" label="ALLOWLIST · WALLETS">{body}</CommandCardSection>
  }

  return body
}
