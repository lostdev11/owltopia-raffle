'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, Loader2 } from 'lucide-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { SupplyProgress } from '@/components/owl-center/SupplyProgress'
import { ActivityLog } from '@/components/owl-center/ActivityLog'
import { MarketplaceReadinessPanel } from '@/components/owl-center/MarketplaceReadinessPanel'
import { Gen2DevnetMintChecklist } from '@/components/owl-center/Gen2DevnetMintChecklist'
import { AdminWalletBulkUpload } from '@/components/admin/AdminWalletBulkUpload'
import { GEN2_WL_COLLAB_COMMUNITIES } from '@/lib/owl-center/phase-display'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import type { MintTerminalLine, OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { isOwlCenterMintEnvKillSwitchEnabled } from '@/lib/owl-center/mint-policy'
import { isDevnetMintEnabled } from '@/lib/solana/network'

type StatePayload = {
  launch: OwlCenterLaunchPublic
  supply: { minted: number; total: number; remaining: number }
  terminal: MintTerminalLine[]
}

export default function AdminOwlCenterPage() {
  const { connected } = useWallet()
  const { signIn, signingIn, error: signErr } = useSiwsSignIn()

  const [state, setState] = useState<StatePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [giftMsg, setGiftMsg] = useState<string | null>(null)

  const [cm, setCm] = useState('')
  const [col, setCol] = useState('')
  const [me, setMe] = useState('')
  const [tensor, setTensor] = useState('')
  const [phase, setPhase] = useState<string>('PRESALE')
  const [status, setStatus] = useState<string>('PRESALE')
  const [paused, setPaused] = useState(false)
  const [mintedOverride, setMintedOverride] = useState('')
  const [giftWallet, setGiftWallet] = useState('')
  const [giftQty, setGiftQty] = useState(1)

  const [devnetCm, setDevnetCm] = useState('')
  const [devnetCol, setDevnetCol] = useState('')
  const [devnetSaveMsg, setDevnetSaveMsg] = useState<string | null>(null)
  const [devnetEvents, setDevnetEvents] = useState<Array<Record<string, unknown>>>([])
  const [devnetEventsLoading, setDevnetEventsLoading] = useState(false)
  const [devnetEventsErr, setDevnetEventsErr] = useState<string | null>(null)
  const [resetPhrase, setResetPhrase] = useState('')
  const [resetMsg, setResetMsg] = useState<string | null>(null)

  const [wlSummary, setWlSummary] = useState<{
    wl_cap: number
    wallet_count: number
    total_allowed: number
    total_used: number
    over_allocated_by: number
    by_community: Record<string, { wallets: number; allowed: number; used: number }>
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/owl-center/gen2/state', { cache: 'no-store' })
      const j = (await res.json()) as StatePayload & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setState({ launch: j.launch, supply: j.supply, terminal: j.terminal })
      const L = j.launch
      setCm(L.candy_machine_id ?? '')
      setCol(L.collection_mint ?? '')
      setDevnetCm(L.devnet_candy_machine_id ?? '')
      setDevnetCol(L.devnet_collection_mint ?? '')
      setMe(L.magic_eden_url ?? '')
      setTensor(L.tensor_url ?? '')
      setPhase(L.active_phase)
      setStatus(L.status)
      setPaused(L.is_paused)
      setMintedOverride(String(L.minted_count))
    } catch (e) {
      setState(null)
      setSaveMsg(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refreshWlSummary = useCallback(async () => {
    if (!connected) return
    try {
      const res = await fetch('/api/admin/owl-center/gen2/wl-summary', { credentials: 'include' })
      if (!res.ok) return
      setWlSummary(await res.json())
    } catch {
      setWlSummary(null)
    }
  }, [connected])

  useEffect(() => {
    void refreshWlSummary()
  }, [refreshWlSummary])

  async function savePatch() {
    setSaveMsg(null)
    try {
      const body: Record<string, unknown> = {
        active_phase: phase,
        status,
        is_paused: paused,
        candy_machine_id: cm.trim() || null,
        collection_mint: col.trim() || null,
        magic_eden_url: me.trim() || null,
        tensor_url: tensor.trim() || null,
      }
      if (mintedOverride.trim() !== '') {
        const mo = Number(mintedOverride)
        if (Number.isInteger(mo)) body.minted_count = mo
      }

      const res = await fetch('/api/admin/owl-center/gen2/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      setSaveMsg('Saved')
      void load()
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'save_failed')
    }
  }

  async function saveDevnetCm() {
    setDevnetSaveMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devnet_candy_machine_id: devnetCm.trim() || null,
          devnet_collection_mint: devnetCol.trim() || null,
        }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      setDevnetSaveMsg('Devnet CM saved')
      void load()
    } catch (e) {
      setDevnetSaveMsg(e instanceof Error ? e.message : 'save_failed')
    }
  }

  async function loadDevnetEvents() {
    setDevnetEventsLoading(true)
    setDevnetEventsErr(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/devnet-mint-events?limit=50', { credentials: 'include' })
      const j = (await res.json()) as { events?: Array<Record<string, unknown>>; error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setDevnetEvents(j.events ?? [])
    } catch (e) {
      setDevnetEvents([])
      setDevnetEventsErr(e instanceof Error ? e.message : 'devnet_events_failed')
    } finally {
      setDevnetEventsLoading(false)
    }
  }

  async function giftPresaleQty(q: number) {
    setGiftMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/gift-presale', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: giftWallet.trim(), quantity: q }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'gift_failed')
      setGiftMsg(`Gift applied (${q})`)
    } catch (e) {
      setGiftMsg(e instanceof Error ? e.message : 'gift_failed')
    }
  }

  async function resetPresaleUsed() {
    setResetMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/reset-presale-used', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: giftWallet.trim(),
          confirm: resetPhrase.trim(),
        }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'reset_failed')
      setResetMsg('used_mints reset to 0 for wallet')
      setResetPhrase('')
    } catch (e) {
      setResetMsg(e instanceof Error ? e.message : 'reset_failed')
    }
  }

  async function giftPresale() {
    setGiftMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/gift-presale', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: giftWallet.trim(), quantity: giftQty }),
      })
      const j = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'gift_failed')
      setGiftMsg('Gift applied')
      setGiftWallet('')
    } catch (e) {
      setGiftMsg(e instanceof Error ? e.message : 'gift_failed')
    }
  }

  return (
    <main className="min-h-screen bg-[#0F1419] px-4 py-10 text-[#E8EEF2]">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/admin" className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-[#00C97A] hover:underline">
            <ArrowLeft className="h-4 w-4" /> Owl Vision
          </Link>
          <h1 className="font-display text-3xl text-[#F4FBF8]">Owl Center — Gen2</h1>
        </div>

        <CommandCard label="access.sys">
          <p className="mb-3 text-sm text-[#9BA8B4]">
            Requires Sign-In with Solana session + admin wallet (<code className="text-[11px] text-[#00FF9C]">ADMIN_WALLETS</code>{' '}
            or DB admin).
          </p>
          <div className="flex flex-wrap gap-3">
            <WalletConnectButton />
            <DeployButton type="button" onClick={() => void signIn()} disabled={signingIn}>
              {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign in
            </DeployButton>
          </div>
          {signErr ? <p className="mt-2 text-sm text-[#FF9C9C]">{signErr}</p> : null}
        </CommandCard>

        <div className="flex flex-wrap gap-3">
          <DeployButton type="button" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Reload telemetry
          </DeployButton>
          <Link href="/admin/gen2-presale" className="inline-flex min-h-[44px] items-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:border-[#00FF9C]/35">
            Gen2 presale admin
          </Link>
          <Link href="/admin/owl-center/demo" className="inline-flex min-h-[44px] items-center border border-[#00FF9C]/35 px-4 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10">
            Demo mint launchpad
          </Link>
          <Link href="/owl-center/collection/gen2" className="inline-flex min-h-[44px] items-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:border-[#00FF9C]/35">
            Public mint page
          </Link>
          {state ? (
            <>
              <Link
                href={`/admin/owl-center/collections/${state.launch.id}/assets`}
                className="inline-flex min-h-[44px] items-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:border-[#00FF9C]/35"
              >
                Assets & metadata
              </Link>
              <Link
                href="/admin/owl-center/marketplaces"
                className="inline-flex min-h-[44px] items-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:border-[#00FF9C]/35"
              >
                Marketplace hub
              </Link>
            </>
          ) : null}
        </div>

        {state ? (
          <>
            <CommandCard label="launch_snapshot.sys">
              <SupplyProgress minted={state.supply.minted} total={state.supply.total} />
              <p className="mt-4 font-mono text-xs text-[#5C6773]">
                slug={state.launch.slug} · featured={String(state.launch.is_featured)} · deadline=
                {state.launch.launch_deadline_at ?? '—'}
              </p>
            </CommandCard>

            <CommandCard label="controls.sys">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Candy Machine ID
                  <input value={cm} onChange={(e) => setCm(e.target.value)} className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm" />
                </label>
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Collection mint
                  <input value={col} onChange={(e) => setCol(e.target.value)} className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm" />
                </label>
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Magic Eden URL
                  <input value={me} onChange={(e) => setMe(e.target.value)} className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm" />
                </label>
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Tensor URL
                  <input value={tensor} onChange={(e) => setTensor(e.target.value)} className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm" />
                </label>
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Active phase
                  <select value={phase} onChange={(e) => setPhase(e.target.value)} className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm">
                    {['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC', 'SOLD_OUT', 'TRADING_ACTIVE'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Status
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm">
                    {['DRAFT', 'PENDING_REVIEW', 'PRESALE', 'WHITELIST', 'PUBLIC', 'SOLD_OUT', 'TRADING_ACTIVE'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={paused}
                      onChange={(e) => setPaused(e.target.checked)}
                      className="h-4 w-4 touch-manipulation"
                      disabled={isOwlCenterMintEnvKillSwitchEnabled()}
                    />
                    Mint kill switch (admin pause)
                  </span>
                  <span className="normal-case tracking-normal text-[#9BA8B4]">
                    When on, the public Mint button stays grayed out and confirm-mint rejects. Save launch to apply.
                    {isOwlCenterMintEnvKillSwitchEnabled()
                      ? ' OWL_CENTER_MINT_DISABLED is set in the deployment env — overrides this toggle until cleared.'
                      : null}
                  </span>
                </label>
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Minted count (emergency)
                  <input value={mintedOverride} onChange={(e) => setMintedOverride(e.target.value)} className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm" />
                </label>
              </div>
              <DeployButton type="button" className="mt-6" onClick={() => void savePatch()} disabled={!connected}>
                Save Gen2 launch
              </DeployButton>
              {saveMsg ? (
                <p
                  className={`mt-2 font-mono text-xs ${saveMsg === 'Saved' ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'}`}
                >
                  {saveMsg}
                </p>
              ) : null}
            </CommandCard>

            <MarketplaceReadinessPanel launchId={state.launch.id} launch={state.launch} compact />

            <CommandCard label="gen2_devnet_test.sys">
              <p className="mb-4 text-sm text-[#9BA8B4]">
                Isolated devnet CM proof — uses{' '}
                <code className="text-[11px] text-[#00FF9C]">ADMIN_WALLETS</code> / DB admin session. Does not overwrite mainnet{' '}
                <code className="text-[11px] text-[#5C6773]">candy_machine_id</code>.
              </p>
              <p className="mb-4 font-mono text-xs text-[#FFD769]">
                Network mode:{' '}
                {isDevnetMintEnabled()
                  ? 'NEXT_PUBLIC_GEN2_USE_DEVNET_MINT=true (devnet mint path)'
                  : 'Production mint path — set flag + devnet RPC for CM smoke tests'}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Devnet Candy Machine ID
                  <input
                    value={devnetCm}
                    onChange={(e) => setDevnetCm(e.target.value)}
                    className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm"
                    placeholder="Stored in DB + optional NEXT_PUBLIC_GEN2_DEVNET_CANDY_MACHINE_ID"
                  />
                </label>
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Devnet Collection Mint
                  <input
                    value={devnetCol}
                    onChange={(e) => setDevnetCol(e.target.value)}
                    className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm"
                  />
                </label>
                <label className="md:col-span-2 grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Test wallet (gift, reset used_mints, filter mint events below)
                  <input
                    value={giftWallet}
                    onChange={(e) => setGiftWallet(e.target.value)}
                    className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm"
                    placeholder="Recipient devnet wallet"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <DeployButton type="button" onClick={() => void saveDevnetCm()} disabled={!connected}>
                  Save Devnet Candy Machine
                </DeployButton>
                <DeployButton type="button" onClick={() => void giftPresaleQty(1)} disabled={!connected || !giftWallet.trim()}>
                  Add 1 Test Credit
                </DeployButton>
                <DeployButton type="button" onClick={() => void giftPresaleQty(5)} disabled={!connected || !giftWallet.trim()}>
                  Add 5 Test Credits
                </DeployButton>
                <Link
                  href="/owl-center/collection/gen2"
                  className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-4 text-sm font-bold text-[#00FF9C]"
                >
                  Open Gen2 Mint Page
                </Link>
                <a
                  href={isDevnetMintEnabled() ? 'https://explorer.solana.com/?cluster=devnet' : 'https://explorer.solana.com/'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4]"
                >
                  Open Solana Explorer
                </a>
                <DeployButton type="button" onClick={() => void loadDevnetEvents()} disabled={!connected}>
                  {devnetEventsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  View devnet mint events
                </DeployButton>
              </div>
              <div className="mt-6 border border-[#1A222B] bg-[#0B0F14] p-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Reset presale used_mints (testing)</p>
                <p className="mt-2 text-xs text-[#FF9C9C]">
                  Zeros <code className="text-[11px]">used_mints</code> only — paste confirmation phrase below. Recipient wallet uses the
                  field above.
                </p>
                <input
                  value={resetPhrase}
                  onChange={(e) => setResetPhrase(e.target.value)}
                  placeholder='Type RESET_TEST_USED_MINTS'
                  className="mt-2 w-full border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm"
                />
                <DeployButton type="button" className="mt-2" onClick={() => void resetPresaleUsed()} disabled={!connected}>
                  Reset test used_mints
                </DeployButton>
                {resetMsg ? (
                  <p
                    className={`mt-2 font-mono text-xs ${resetMsg.startsWith('used_mints') ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'}`}
                  >
                    {resetMsg}
                  </p>
                ) : null}
              </div>
              {devnetSaveMsg ? (
                <p
                  className={`mt-2 font-mono text-xs ${devnetSaveMsg.includes('saved') ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'}`}
                >
                  {devnetSaveMsg}
                </p>
              ) : null}
              {devnetEventsErr ? <p className="mt-2 font-mono text-xs text-[#FF9C9C]">{devnetEventsErr}</p> : null}
              {devnetEvents.length > 0 ? (
                <ul className="mt-4 max-h-56 space-y-2 overflow-y-auto font-mono text-[11px] text-[#9BA8B4]">
                  {devnetEvents
                    .filter((ev) => {
                      const w = String(ev.wallet_address ?? '')
                      const q = giftWallet.trim().toLowerCase()
                      if (!q) return true
                      return w.toLowerCase().includes(q)
                    })
                    .map((ev) => (
                      <li key={String(ev.id)}>
                        {String(ev.wallet_address ?? '').slice(0, 8)}… qty={String(ev.quantity ?? '')} phase={String(ev.phase ?? '')}{' '}
                        sig={String(ev.tx_signature ?? '').slice(0, 12)}…
                      </li>
                    ))}
                </ul>
              ) : null}
            </CommandCard>

            <Gen2DevnetMintChecklist launch={state.launch} />

            <CommandCard label="gift_presale.sys">
              <p className="mb-3 text-xs text-[#9BA8B4]">Uses audited gift RPC (actor wallet recorded).</p>
              <div className="flex flex-wrap gap-3">
                <input
                  placeholder="Recipient wallet"
                  value={giftWallet}
                  onChange={(e) => setGiftWallet(e.target.value)}
                  className="min-w-[200px] flex-1 border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm"
                />
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={giftQty}
                  onChange={(e) => setGiftQty(Number(e.target.value))}
                  className="w-24 border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm"
                />
                <DeployButton type="button" onClick={() => void giftPresale()} disabled={!connected}>
                  Gift credits
                </DeployButton>
              </div>
              {giftMsg ? (
                <p
                  className={`mt-2 font-mono text-xs ${giftMsg === 'Gift applied' ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'}`}
                >
                  {giftMsg}
                </p>
              ) : null}
            </CommandCard>

            <CommandCard label="upload_wl_wallets.sys">
              <AdminWalletBulkUpload kind="wl" connected={connected} onSuccess={() => void refreshWlSummary()} />
            </CommandCard>

            <CommandCard label="upload_presale_overage.sys">
              <p className="mb-3 text-xs text-[#9BA8B4]">
                Assign wallets for the <strong className="text-[#EAFBF4]">Presale+13</strong> phase (spots 658–670). Wallets
                must be paid presale participants with credits remaining.
              </p>
              <AdminWalletBulkUpload kind="overage" connected={connected} />
            </CommandCard>

            <CommandCard label="wl_allocation_audit.sys">
              <p className="mb-3 text-xs text-[#9BA8B4]">
                FCFS collab channels: {GEN2_WL_COLLAB_COMMUNITIES.map((c) => c.label).join(', ')}. Tag rows with{' '}
                <code className="text-[10px]">community</code> per upload or CSV column.
              </p>
              {wlSummary ? (
                <div className="space-y-2 font-mono text-xs text-[#C5D0D8]">
                  <p>
                    Wallets {wlSummary.wallet_count} · allowed {wlSummary.total_allowed} / cap {wlSummary.wl_cap} · used{' '}
                    {wlSummary.total_used}
                  </p>
                  {wlSummary.over_allocated_by > 0 ? (
                    <p className="text-[#FFD769]">Over-allocated by {wlSummary.over_allocated_by} spots — trim before WL goes live.</p>
                  ) : (
                    <p className="text-[#00FF9C]">Within WL supply cap.</p>
                  )}
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto border border-[#1A222B] bg-[#0B0F14] p-2">
                    {Object.entries(wlSummary.by_community).map(([k, v]) => (
                      <li key={k} className="text-[#9BA8B4]">
                        {k}: {v.wallets} wallets · {v.allowed} allowed · {v.used} used
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-[#5C6773]">Sign in as admin to load WL summary.</p>
              )}
            </CommandCard>

            <CommandCard label="mint_events.sys">
              <ActivityLog lines={state.terminal} />
            </CommandCard>
          </>
        ) : (
          <p className="font-mono text-sm text-[#5C6773]">{loading ? 'Loading…' : 'No data — apply migration 097?'}</p>
        )}
      </div>
    </main>
  )
}
