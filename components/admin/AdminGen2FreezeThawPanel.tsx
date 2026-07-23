'use client'

import { useCallback, useEffect, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import type { OwlCenterFreezeProgress, OwlCenterFreezeStatus } from '@/lib/owl-center/types'

type ThawPayload = {
  freeze_status: OwlCenterFreezeStatus
  freeze_thawed_at: string | null
  freeze_progress: OwlCenterFreezeProgress
  active_phase: string
  status: string
  magic_eden_url: string | null
  tensor_url: string | null
  minted_count: number
  total_supply: number
}

export function AdminGen2FreezeThawPanel({ onChanged }: { onChanged?: () => void }) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [data, setData] = useState<ThawPayload | null>(null)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/thaw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'status' }),
      })
      const json = (await res.json().catch(() => ({}))) as ThawPayload & { error?: string; ok?: boolean }
      if (!res.ok) {
        setErr(typeof json.error === 'string' ? json.error : 'Failed to load thaw status')
        return
      }
      setData(json)
    } catch {
      setErr('Failed to load thaw status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (action: 'start' | 'unlock') => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/thaw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json().catch(() => ({}))) as ThawPayload & {
        error?: string
        ok?: boolean
        signature?: string
      }
      if (!res.ok) {
        setErr(typeof json.error === 'string' ? json.error : 'Request failed')
        return
      }
      setData(json)
      setMsg(
        action === 'start'
          ? 'Thaw started — cron thaws ~30 NFTs every 2 minutes.'
          : `Unlock sent${json.signature ? `: ${json.signature.slice(0, 12)}…` : ''}`
      )
      onChanged?.()
    } catch {
      setErr('Request failed')
    } finally {
      setBusy(false)
    }
  }

  const progress = data?.freeze_progress
  const total = progress?.total ?? data?.minted_count ?? 0
  const thawed = progress?.thawed_count ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((thawed / total) * 100)) : 0

  return (
    <CommandCard label="FREEZE_THAW · MINT_OUT">
      <p className="mb-4 text-sm text-[#9BA8B4]">
        Gen2 mints are frozen via Candy Machine <code className="text-[11px] text-[#00FF9C]">freezeSolPayment</code>.
        Start thaw at mint-out (or let auto-thaw run when supply hits{' '}
        {data?.total_supply?.toLocaleString() ?? 'cap'}). Cron finishes batches; unlock closes the escrow.
      </p>

      {loading ? (
        <p className="font-mono text-xs text-[#5C6773]">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 font-mono text-xs text-[#9BA8B4]">
            <span>
              status:{' '}
              <span className="text-[#E8EEF2]">{data?.freeze_status ?? '—'}</span>
            </span>
            <span>
              phase: <span className="text-[#E8EEF2]">{data?.active_phase ?? '—'}</span>
            </span>
            {data?.freeze_thawed_at ? (
              <span>
                thawed_at:{' '}
                <span className="text-[#00FF9C]">{new Date(data.freeze_thawed_at).toLocaleString()}</span>
              </span>
            ) : null}
          </div>

          {total > 0 || data?.freeze_status === 'thawing' ? (
            <div>
              <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                <span>
                  Thawed {thawed.toLocaleString()} / {total.toLocaleString() || '…'}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden border border-[#1A222B] bg-[#0F1419]">
                <div className="h-full bg-[#00FF9C]/70 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : null}

          {progress?.error ? (
            <p className="border border-[#FF9C9C]/35 bg-[#FF9C9C]/10 px-3 py-2 font-mono text-xs text-[#FF9C9C]">
              {progress.error}
            </p>
          ) : null}

          {!data?.magic_eden_url && !data?.tensor_url ? (
            <p className="border border-[#FFD769]/35 bg-[#FFD769]/10 px-3 py-2 text-xs text-[#FFD769]">
              Set Magic Eden / Tensor URLs above so thaw completion can flip to TRADING_ACTIVE automatically.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <DeployButton
              type="button"
              disabled={busy || data?.freeze_status === 'thawed'}
              onClick={() => void run('start')}
              className="min-h-[44px] touch-manipulation"
            >
              {data?.freeze_status === 'thawing' ? 'Resume / re-seed thaw' : 'Start thaw'}
            </DeployButton>
            <DeployButton
              type="button"
              disabled={busy || (data?.freeze_status !== 'thawed' && data?.freeze_status !== 'thawing')}
              onClick={() => void run('unlock')}
              className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-transparent text-[#9BA8B4]"
            >
              Unlock escrow
            </DeployButton>
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
              className="min-h-[44px] touch-manipulation border border-[#1A222B] px-4 font-mono text-xs uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
    </CommandCard>
  )
}
