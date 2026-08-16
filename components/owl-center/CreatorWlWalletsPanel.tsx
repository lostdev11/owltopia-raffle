'use client'

import { useCallback, useEffect, useState } from 'react'

import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { creatorWlWalletsApiPath } from '@/lib/owl-center/creator-api-paths'
import { launchHasWhitelistProgram } from '@/lib/owl-center/launch-wl-window'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type WlRow = {
  wallet: string
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
  const wlEnabled = launchHasWhitelistProgram(launch)
  const [text, setText] = useState('')
  const [allowed, setAllowed] = useState('1')
  const [rows, setRows] = useState<WlRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [totals, setTotals] = useState<{ wallet_count: number; total_allowed: number; total_used: number } | null>(
    null
  )

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(creatorWlWalletsApiPath(launchId), {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as {
        error?: string
        rows?: WlRow[]
        wallet_count?: number
        total_allowed?: number
        total_used?: number
      }
      if (!res.ok) throw new Error(j.error || 'Failed to load whitelist')
      setRows(j.rows ?? [])
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
  }, [launchId])

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
          ? `Added ${j.upserted ?? 0} wallet(s); ${failN} failed.`
          : `Added ${j.upserted ?? 0} wallet(s) to whitelist.`
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
        `${creatorWlWalletsApiPath(launchId)}?wallet=${encodeURIComponent(wallet)}`,
        { method: 'DELETE', credentials: 'include' }
      )
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'Remove failed')
      setMsg(`Removed ${wallet.slice(0, 4)}…`)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setSaving(false)
    }
  }

  const body = (
    <div className="grid gap-4">
      <p className="text-sm leading-relaxed text-[#9BA8B4]">
        Add Solana wallets for your whitelist phase. During the WL window (after WL start, before public open), only
        these wallets can mint — up to their spot count. Enable whitelist under Mint details → Show Advanced, set WL
        start and Public start, save, then add wallets here.
      </p>

      {!wlEnabled ? (
        <p className="rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          Whitelist is off for this collection. Turn on Whitelist phase in Mint details, set WL supply + start time,
          save, then come back here.
        </p>
      ) : null}

      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Wallets (one per line, or comma / space separated)
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
          {saving ? 'Saving…' : 'Add to whitelist'}
        </DeployButton>
        <DeployButton type="button" variant="ghost" disabled={loading || saving} onClick={() => void load()}>
          Refresh
        </DeployButton>
      </div>

      {err ? <p className="font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="font-mono text-xs text-[#00FF9C]">{msg}</p> : null}

      <div className="border-t border-[#1A222B] pt-4">
        <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773]">
          Current list
          {totals
            ? ` · ${totals.wallet_count} wallets · ${totals.total_used}/${totals.total_allowed} spots used`
            : ''}
          {launch.wl_supply > 0 ? ` · collection WL supply ${launch.wl_supply}` : ''}
        </p>
        {loading ? (
          <p className="font-mono text-xs text-[#5C6773]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="font-mono text-xs text-[#5C6773]">No wallets yet.</p>
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
    return <CommandCardSection label="WHITELIST · WALLETS">{body}</CommandCardSection>
  }

  return body
}
