'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

type RebateSummary = {
  locked_lamports: number
  releasable_lamports: number
  released_lamports: number
  forfeited_lamports: number
  locked_count: number
  releasable_count: number
  released_count: number
  forfeited_count: number
  rebate_wallet: string | null
}

type LaunchRebateInfo = {
  id: string
  slug: string
  name: string
  platform_fee_rebate_bps: number
  platform_fee_rebate_wallet: string | null
  active_phase: string
  status: string
  minted_count: number
  total_supply: number
}

function lamportsToSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4)
}

export function OwlCenterFeeRebatesAdminPanel({ launchId }: { launchId: string }) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [launch, setLaunch] = useState<LaunchRebateInfo | null>(null)
  const [summary, setSummary] = useState<RebateSummary | null>(null)
  const [bps, setBps] = useState('2000')
  const [wallet, setWallet] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/owl-center/launches/${launchId}/fee-rebates`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as {
        error?: string
        launch?: LaunchRebateInfo
        summary?: RebateSummary
      }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setLaunch(j.launch ?? null)
      setSummary(j.summary ?? null)
      if (j.launch) {
        setBps(String(j.launch.platform_fee_rebate_bps ?? 0))
        setWallet(j.launch.platform_fee_rebate_wallet ?? '')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [launchId])

  useEffect(() => {
    void load()
  }, [load])

  async function saveConfig() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/owl-center/launches/${launchId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform_fee_rebate_bps: Number(bps),
          platform_fee_rebate_wallet: wallet.trim() || null,
        }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      setMsg('Rebate config saved')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  async function runAction(action: 'release' | 'forfeit' | 'mark_releasable', extra?: Record<string, unknown>) {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/owl-center/launches/${launchId}/fee-rebates`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const j = (await res.json()) as { error?: string; signature?: string; forfeited?: number }
      if (!res.ok) throw new Error(j.error || 'action_failed')
      setMsg(
        action === 'forfeit'
          ? `Forfeited ${j.forfeited ?? 0} row(s)`
          : j.signature
            ? `OK — ${j.signature.slice(0, 12)}…`
            : 'OK'
      )
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'action_failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-[#9BA8B4]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading fee rebates…
      </div>
    )
  }

  return (
    <div className="grid gap-4 border border-[#1A222B] bg-[#0F1419]/80 p-4">
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">
          Platform fee rebate (admin)
        </p>
        <p className="mt-1 text-xs text-[#9BA8B4]">
          Accrues locked on each mint from the ~$1 platform fee. No public statuses — release after mint
          or override here.
        </p>
        {launch ? (
          <p className="mt-1 font-mono text-[11px] text-[#5C6773]">
            {launch.slug} · {launch.minted_count}/{launch.total_supply} · {launch.active_phase}/{launch.status}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Rebate bps (2000 = 20%)
          <input
            value={bps}
            onChange={(e) => setBps(e.target.value)}
            className="border border-[#1A222B] bg-[#0A0E12] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Partner rebate wallet
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Partner SOL address"
            className="border border-[#1A222B] bg-[#0A0E12] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveConfig()}
          className="border border-[#2A9B7A] bg-[#2A9B7A]/15 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#7DFFC8] disabled:opacity-50"
        >
          Save config
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runAction('mark_releasable')}
          className="border border-[#1A222B] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#E8EEF2] disabled:opacity-50"
        >
          Unlock + payout
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runAction('release', { include_locked: true })}
          className="border border-[#1A222B] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#E8EEF2] disabled:opacity-50"
        >
          Release now (incl. locked)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runAction('forfeit')}
          className="border border-[#5C2A2A] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#FF9C9C] disabled:opacity-50"
        >
          Forfeit locked/releasable
        </button>
      </div>

      {summary ? (
        <dl className="grid grid-cols-2 gap-2 font-mono text-[11px] text-[#9BA8B4] sm:grid-cols-4">
          <div>
            <dt>Locked</dt>
            <dd className="text-[#F4FBF8]">
              {summary.locked_count} · {lamportsToSol(summary.locked_lamports)} SOL
            </dd>
          </div>
          <div>
            <dt>Releasable</dt>
            <dd className="text-[#F4FBF8]">
              {summary.releasable_count} · {lamportsToSol(summary.releasable_lamports)} SOL
            </dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd className="text-[#F4FBF8]">
              {summary.released_count} · {lamportsToSol(summary.released_lamports)} SOL
            </dd>
          </div>
          <div>
            <dt>Forfeited</dt>
            <dd className="text-[#F4FBF8]">
              {summary.forfeited_count} · {lamportsToSol(summary.forfeited_lamports)} SOL
            </dd>
          </div>
        </dl>
      ) : null}

      {err ? <p className="font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="font-mono text-xs text-[#7DFFC8]">{msg}</p> : null}
    </div>
  )
}
