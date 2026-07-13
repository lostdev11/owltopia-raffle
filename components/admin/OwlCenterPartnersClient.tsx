'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import type { OwlCenterPartner } from '@/lib/db/owl-center-partners'

export function OwlCenterPartnersClient() {
  const [partners, setPartners] = useState<OwlCenterPartner[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [wallet, setWallet] = useState('')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/admin/owl-center/partners', { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as { error?: string; partners?: OwlCenterPartner[] }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setPartners(j.partners ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function approve() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/partners', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: wallet.trim(), label: label.trim() || null, notes: notes.trim() || null }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      setMsg('Partner approved — they can now open the launch wizard and Owl Generator with this wallet.')
      setWallet('')
      setLabel('')
      setNotes('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(id: string, status: 'approved' | 'revoked') {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/partners', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'update_failed')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'update_failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#0F1419] px-4 py-10 text-[#E8EEF2]">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="font-display text-3xl text-[#F4FBF8]">Launchpad partners</h1>
          <p className="mt-2 text-sm text-[#9BA8B4]">
            Approved wallets can open the Owl Center launch wizard and Owl Generator to submit collections for
            review. Nothing goes live without admin approval in the collection console.
          </p>
        </div>

        <CommandCard label="APPROVE // Partner wallet">
          <div className="grid gap-4">
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              Solana wallet address
              <input
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="Partner creator wallet (base58)"
                className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
              />
            </label>
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              Partner / project name
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Pandarianz"
                maxLength={120}
                className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
              />
            </label>
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              Notes (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
              />
            </label>
            <DeployButton
              type="button"
              className="gap-2"
              disabled={busy || !wallet.trim()}
              onClick={() => void approve()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
              Approve partner
            </DeployButton>
            {msg ? <p className="font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
            {err ? <p className="font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
          </div>
        </CommandCard>

        <CommandCard label={`PARTNERS // ${partners.length}`}>
          {loading ? (
            <p className="flex items-center gap-2 font-mono text-xs text-[#5C6773]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading partners…
            </p>
          ) : partners.length === 0 ? (
            <p className="font-mono text-xs text-[#5C6773]">
              No partner wallets yet — approve one above to open the launchpad to them.
            </p>
          ) : (
            <ul className="divide-y divide-[#1A222B]">
              {partners.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-[#F4FBF8]">
                      {p.label?.trim() || 'Unnamed partner'}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-[#5C6773]">{p.wallet}</p>
                    {p.notes ? <p className="mt-0.5 text-xs text-[#7D8A93]">{p.notes}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                        p.status === 'approved'
                          ? 'border-[#00FF9C]/35 text-[#00FF9C]'
                          : 'border-[#FF9C9C]/35 text-[#FF9C9C]'
                      }`}
                    >
                      {p.status === 'approved' ? (
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                      ) : (
                        <ShieldOff className="h-3 w-3" aria-hidden />
                      )}
                      {p.status}
                    </span>
                    <DeployButton
                      type="button"
                      variant="ghost"
                      className="min-h-[36px]"
                      disabled={busy}
                      onClick={() => void setStatus(p.id, p.status === 'approved' ? 'revoked' : 'approved')}
                    >
                      {p.status === 'approved' ? 'Revoke' : 'Re-approve'}
                    </DeployButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CommandCard>

        <Link href="/admin/owl-center" className="block font-mono text-xs text-[#5C6773] hover:text-[#00FF9C]">
          ← Launchpad hub
        </Link>
      </div>
    </main>
  )
}
