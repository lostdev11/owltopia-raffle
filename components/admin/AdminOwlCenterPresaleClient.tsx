'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, ExternalLink, Gift, Loader2 } from 'lucide-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { Button } from '@/components/ui/button'
import type { OwlCenterPresaleTenantAdmin } from '@/lib/owl-center-presale/types'
import { OWL_CENTER_PRESALE_GIFT_ABSOLUTE_CAP } from '@/lib/owl-center-presale/constants'

type TenantRow = OwlCenterPresaleTenantAdmin & {
  sold?: number
  remaining?: number
  presale_url?: string
}

export function AdminOwlCenterPresaleClient() {
  const { connected } = useWallet()
  const { signIn, signingIn, error: signErr } = useSiwsSignIn()
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [giftId, setGiftId] = useState<string | null>(null)
  const [giftWallets, setGiftWallets] = useState('')
  const [giftQty, setGiftQty] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/admin/owl-center-presale/tenants', {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as { tenants?: TenantRow[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'Failed to load')
      setTenants(j.tenants ?? [])
    } catch (e) {
      setTenants([])
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function approve(id: string, goLive: boolean) {
    setBusyId(id)
    setMsg(null)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/owl-center-presale/tenants/${id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', go_live: goLive }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'Approve failed')
      setMsg(goLive ? 'Approved and live' : 'Approved (partner can go live)')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    const reason = window.prompt('Rejection reason (optional)') ?? ''
    setBusyId(id)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/owl-center-presale/tenants/${id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: reason || undefined }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'Reject failed')
      setMsg('Rejected')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setBusyId(null)
    }
  }

  async function gift() {
    if (!giftId) return
    setBusyId(giftId)
    setErr(null)
    setMsg(null)
    try {
      const wallets = giftWallets
        .split(/[\s,;\n]+/)
        .map((w) => w.trim())
        .filter(Boolean)
      const res = await fetch(`/api/admin/owl-center-presale/tenants/${giftId}/gift`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets, quantity: giftQty }),
      })
      const j = (await res.json()) as { error?: string; ok?: boolean; results?: unknown[] }
      if (!res.ok) throw new Error(j.error || 'Gift failed')
      setMsg(`Gift complete (${wallets.length} wallet(s))`)
      setGiftWallets('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gift failed')
    } finally {
      setBusyId(null)
    }
  }

  const pending = tenants.filter((t) => t.approval_status === 'pending')
  const others = tenants.filter((t) => t.approval_status !== 'pending')

  return (
    <main className="min-h-screen bg-[#0F1419] px-4 py-10 text-[#E8EEF2]">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/admin/owl-center"
            className="inline-flex min-h-[44px] items-center gap-1 font-mono text-xs uppercase tracking-widest text-[#00C97A] hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Launchpad hub
          </Link>
          <h1 className="text-2xl font-semibold text-[#F4FBF8]">Partner presales</h1>
        </div>

        <p className="max-w-2xl text-sm text-[#9BA8B4]">
          Approve partner self-serve campaigns, gift airdrop credits, and open public pages at{' '}
          <code className="text-[#00FF9C]">/owl-center/&#123;slug&#125;/presale</code>. Spot proceeds → partner; $1
          fee/spot → Owltopia treasury.
        </p>

        <div className="flex flex-wrap gap-3">
          <WalletConnectButton />
          <Button type="button" onClick={() => void signIn()} disabled={signingIn || !connected}>
            {signingIn ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Sign in
          </Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
        </div>
        {signErr ? <p className="text-sm text-red-400">{signErr}</p> : null}
        {err ? <p className="text-sm text-red-400">{err}</p> : null}
        {msg ? <p className="text-sm text-[#00FF9C]">{msg}</p> : null}

        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-widest text-[#5C6773]">
            Pending approval ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm text-[#9BA8B4]">No pending campaigns.</p>
          ) : (
            pending.map((t) => (
              <TenantCard
                key={t.id}
                t={t}
                busy={busyId === t.id}
                onApprove={(goLive) => void approve(t.id, goLive)}
                onReject={() => void reject(t.id)}
                onGiftToggle={() => setGiftId(giftId === t.id ? null : t.id)}
                giftOpen={giftId === t.id}
                giftWallets={giftWallets}
                setGiftWallets={setGiftWallets}
                giftQty={giftQty}
                setGiftQty={setGiftQty}
                onGift={() => void gift()}
              />
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-mono text-xs uppercase tracking-widest text-[#5C6773]">
            All campaigns ({others.length})
          </h2>
          {others.map((t) => (
            <TenantCard
              key={t.id}
              t={t}
              busy={busyId === t.id}
              onApprove={(goLive) => void approve(t.id, goLive)}
              onReject={() => void reject(t.id)}
              onGiftToggle={() => setGiftId(giftId === t.id ? null : t.id)}
              giftOpen={giftId === t.id}
              giftWallets={giftWallets}
              setGiftWallets={setGiftWallets}
              giftQty={giftQty}
              setGiftQty={setGiftQty}
              onGift={() => void gift()}
              showApprove={t.approval_status !== 'approved'}
            />
          ))}
        </section>
      </div>
    </main>
  )
}

function TenantCard(props: {
  t: TenantRow
  busy: boolean
  onApprove: (goLive: boolean) => void
  onReject: () => void
  onGiftToggle: () => void
  giftOpen: boolean
  giftWallets: string
  setGiftWallets: (v: string) => void
  giftQty: number
  setGiftQty: (n: number) => void
  onGift: () => void
  showApprove?: boolean
}) {
  const { t } = props
  return (
    <div className="rounded-xl border border-[#1A222B] bg-[#151D24] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#F4FBF8]">{t.display_name}</p>
          <p className="mt-1 font-mono text-xs text-[#9BA8B4]">
            {t.slug} · {t.approval_status}
            {t.is_live ? ' · live' : ''} · ${t.unit_price_usdc} · supply {t.presale_supply} · sold{' '}
            {t.sold ?? 0}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-[#5C6773]">
            creator {t.created_by_wallet ?? '—'} · receive {t.partner_wallet ?? t.treasury_wallet}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(props.showApprove !== false && t.approval_status === 'pending') || props.showApprove ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={props.busy}
                className="min-h-[40px]"
                onClick={() => props.onApprove(false)}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.busy}
                className="min-h-[40px]"
                onClick={() => props.onApprove(true)}
              >
                Approve + live
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={props.busy}
                className="min-h-[40px] text-red-400"
                onClick={props.onReject}
              >
                Reject
              </Button>
            </>
          ) : null}
          <Button type="button" size="sm" variant="outline" className="min-h-[40px]" onClick={props.onGiftToggle}>
            <Gift className="mr-1 h-3.5 w-3.5" /> Airdrop
          </Button>
          <Button asChild size="sm" variant="ghost" className="min-h-[40px]">
            <Link href={`/owl-center/${t.slug}/presale`} target="_blank">
              Open <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
      {props.giftOpen ? (
        <div className="mt-4 space-y-2 border-t border-[#1A222B] pt-4">
          <textarea
            className="min-h-[88px] w-full rounded-lg border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
            value={props.giftWallets}
            onChange={(e) => props.setGiftWallets(e.target.value)}
            placeholder="Wallets to gift…"
          />
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="number"
              min={1}
              max={OWL_CENTER_PRESALE_GIFT_ABSOLUTE_CAP}
              className="w-24 rounded-lg border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
              value={props.giftQty}
              onChange={(e) => props.setGiftQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
            <Button type="button" disabled={props.busy || !props.giftWallets.trim()} onClick={props.onGift}>
              Gift credits
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
