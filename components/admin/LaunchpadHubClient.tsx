'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, ExternalLink, Loader2, Rocket, Settings2 } from 'lucide-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { AdminOwlCenterViewModePanel } from '@/components/admin/AdminOwlCenterViewModePanel'
import { ActivityLog } from '@/components/owl-center/ActivityLog'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { SupplyProgress } from '@/components/owl-center/SupplyProgress'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { launchPhaseLabel, type LaunchpadHubPayload } from '@/lib/owl-center/launchpad-hub'
import { formatMintDate } from '@/lib/owl-center/phase-schedule'

const QUICK_LINKS = [
  { href: '/admin/owl-center/gen2#wl-upload', label: 'Upload WL wallets', hint: 'Bulk add collab whitelist' },
  { href: '/admin/owl-center/gen2', label: 'Gen2 console', hint: 'Phases, schedule, CM, WL' },
  { href: '/admin/gen2-presale', label: 'Gen2 presale', hint: 'Credits, gifts, purchases' },
  { href: '/owl-center/generator', label: 'Generator', hint: 'Traits & Sugar export' },
  { href: '/owl-center/launch', label: 'Review queue', hint: 'Creator submissions' },
  { href: '/admin/owl-center/marketplaces', label: 'Marketplaces', hint: 'ME / Tensor readiness' },
] as const

export function LaunchpadHubClient() {
  const { connected } = useWallet()
  const { signIn, signingIn, error: signErr } = useSiwsSignIn()
  const [hub, setHub] = useState<LaunchpadHubPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [advanceMsg, setAdvanceMsg] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/admin/owl-center/hub', { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as LaunchpadHubPayload & { error?: string }
      if (!res.ok) throw new Error(j.error || 'hub_failed')
      setHub(j)
    } catch (e) {
      setHub(null)
      setErr(e instanceof Error ? e.message : 'hub_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function runPhaseAdvance() {
    setAdvancing(true)
    setAdvanceMsg(null)
    try {
      const res = await fetch('/api/admin/owl-center/gen2/advance-phase', {
        method: 'POST',
        credentials: 'include',
      })
      const j = (await res.json()) as { advanced?: boolean; from_phase?: string; to_phase?: string; reason?: string; error?: string }
      if (!res.ok) throw new Error(j.error || 'advance_failed')
      if (j.advanced) {
        setAdvanceMsg(`Advanced ${j.from_phase} → ${j.to_phase}`)
      } else {
        setAdvanceMsg(j.reason ?? 'No change')
      }
      await load()
    } catch (e) {
      setAdvanceMsg(e instanceof Error ? e.message : 'advance_failed')
    } finally {
      setAdvancing(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#0F1419] px-4 py-10 text-[#E8EEF2]">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/admin"
            className="inline-flex min-h-[44px] touch-manipulation items-center gap-1 font-mono text-xs uppercase tracking-widest text-[#00C97A] hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Owl Vision
          </Link>
          <h1 className="font-display text-3xl text-[#F4FBF8]">Launchpad hub</h1>
        </div>

        <p className="max-w-2xl text-sm text-[#9BA8B4]">
          Central control for Owl Center — launches, Gen2 mint phases, schedules, presales, and partner demo collections.
          Connect an admin wallet and sign in to save changes on child consoles.
        </p>

        <CommandCard label="access.sys">
          <div className="flex flex-wrap gap-3">
            <WalletConnectButton />
            <DeployButton type="button" onClick={() => void signIn()} disabled={signingIn}>
              {signingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign in
            </DeployButton>
            <DeployButton type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Refresh hub
            </DeployButton>
          </div>
          {signErr ? <p className="mt-2 text-sm text-[#FF9C9C]">{signErr}</p> : null}
          {err ? <p className="mt-2 text-sm text-[#FF9C9C]">{err}</p> : null}
        </CommandCard>

        <AdminOwlCenterViewModePanel />

        {hub ? (
          <CommandCard label="system.sys">
            <dl className="grid gap-2 font-mono text-xs text-[#9BA8B4] sm:grid-cols-2">
              <div>
                <dt className="text-[#5C6773]">Mint kill switch</dt>
                <dd className={hub.system.mint_kill_switch ? 'text-[#FFD769]' : 'text-[#00FF9C]'}>
                  {hub.system.mint_kill_switch ? 'ON (env)' : 'Off'}
                </dd>
              </div>
              <div>
                <dt className="text-[#5C6773]">Gen2 network</dt>
                <dd className={hub.system.devnet_mint_mode ? 'text-[#FFD769]' : 'text-[#00FF9C]'}>
                  {hub.system.devnet_mint_mode ? 'Devnet test' : 'Mainnet path'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[#5C6773]">Auto phase advance</dt>
                <dd>{hub.system.auto_phase_advance_cron}</dd>
              </div>
              <div>
                <dt className="text-[#5C6773]">Presale tenants</dt>
                <dd>{hub.presale_tenant_count}</dd>
              </div>
            </dl>
          </CommandCard>
        ) : null}

        <CommandCard label="quick_links.sys">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-[72px] touch-manipulation flex-col justify-center border border-[#1A222B] bg-[#10161C]/80 px-4 py-3 hover:border-[#00FF9C]/35"
              >
                <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#00FF9C]">{item.label}</span>
                <span className="mt-1 text-xs text-[#5C6773]">{item.hint}</span>
              </Link>
            ))}
          </div>
        </CommandCard>

        {hub?.gen2 ? (
          <CommandCard label="gen2_spotlight.sys">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-display text-xl text-[#F4FBF8]">{hub.gen2.launch.name}</p>
                <p className="mt-1 font-mono text-xs text-[#9BA8B4]">
                  Phase <span className="text-[#00FF9C]">{launchPhaseLabel(hub.gen2.launch.active_phase)}</span>
                  {' · '}
                  Status {hub.gen2.launch.status}
                  {hub.gen2.launch.is_paused ? ' · PAUSED' : ''}
                </p>
                <p className="mt-1 font-mono text-xs text-[#5C6773]">
                  Mint opens {formatMintDate(hub.gen2.launch.launch_deadline_at)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/admin/owl-center/gen2#wl-upload"
                  className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-4 text-sm font-bold text-[#00FF9C]"
                >
                  Upload WL wallets
                </Link>
                <Link
                  href="/admin/owl-center/gen2"
                  className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:border-[#00FF9C]/35"
                >
                  <Settings2 className="h-4 w-4" /> Open console
                </Link>
                <Link
                  href="/owl-center/collection/gen2"
                  className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 border border-[#1A222B] px-4 text-sm text-[#9BA8B4]"
                >
                  <ExternalLink className="h-4 w-4" /> Public mint
                </Link>
              </div>
            </div>
            <div className="mt-4 max-w-md">
              <SupplyProgress minted={hub.gen2.supply.minted} total={hub.gen2.supply.total} />
            </div>
            <div className="mt-4 space-y-2 font-mono text-xs text-[#9BA8B4]">
              {hub.gen2.phase_advance.would_advance ? (
                <p className="text-[#FFD769]">
                  Schedule due: {hub.gen2.phase_advance.from_phase} → {hub.gen2.phase_advance.to_phase} (cron or manual)
                </p>
              ) : (
                <p className="text-[#5C6773]">Phase advance: {hub.gen2.phase_advance.reason}</p>
              )}
              {hub.gen2.countdown ? (
                <p>
                  Next: <span className="text-[#00FF9C]">{hub.gen2.countdown.label}</span> —{' '}
                  {formatMintDate(hub.gen2.countdown.target_at)}
                </p>
              ) : null}
            </div>
            <DeployButton
              type="button"
              className="mt-4"
              disabled={!connected || advancing}
              onClick={() => void runPhaseAdvance()}
            >
              {advancing ? 'Checking schedule…' : 'Run phase advance now'}
            </DeployButton>
            {advanceMsg ? <p className="mt-2 font-mono text-xs text-[#9BA8B4]">{advanceMsg}</p> : null}
          </CommandCard>
        ) : null}

        {hub && hub.pending_review.length > 0 ? (
          <CommandCard label="pending_review.sys">
            <p className="mb-4 text-sm text-[#9BA8B4]">Creator submissions awaiting operator review.</p>
            <ul className="space-y-3">
              {hub.pending_review.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-3 border border-[#1A222B] bg-[#0F1419] px-3 py-3"
                >
                  <div>
                    <p className="font-mono text-sm text-[#E8EEF2]">
                      {l.name} <span className="text-[#5C6773]">({l.slug})</span>
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-[#5C6773]">
                      {l.creator_wallet ? `${l.creator_wallet.slice(0, 4)}…${l.creator_wallet.slice(-4)}` : '—'} · supply{' '}
                      {l.total_supply}
                    </p>
                  </div>
                  <Link
                    href={l.admin_href}
                    className="min-h-[44px] touch-manipulation px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] hover:underline"
                  >
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          </CommandCard>
        ) : null}

        {hub ? (
          <CommandCard label="launches.sys">
            <p className="mb-4 text-sm text-[#9BA8B4]">All live Owl Center launches — open admin console per collection.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-[#1A222B] text-left text-[#5C6773]">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Phase</th>
                    <th className="py-2 pr-3">Minted</th>
                    <th className="py-2 pr-3">Mode</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hub.launches.map((l) => (
                    <tr key={l.id} className="border-b border-[#1A222B]/60 text-[#9BA8B4]">
                      <td className="py-3 pr-3">
                        <span className="text-[#E8EEF2]">{l.name}</span>
                        {l.is_featured ? <span className="ml-1 text-[#00FF9C]">★</span> : null}
                        <br />
                        <span className="text-[#5C6773]">{l.slug}</span>
                      </td>
                      <td className="py-3 pr-3">
                        {launchPhaseLabel(l.active_phase)}
                        {l.is_paused ? <span className="text-[#FFD769]"> · pause</span> : null}
                      </td>
                      <td className="py-3 pr-3 tabular-nums">
                        {l.minted_count}/{l.total_supply}
                      </td>
                      <td className="py-3 pr-3">{l.mint_mode}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link href={l.admin_href} className="text-[#00FF9C] hover:underline">
                            Admin
                          </Link>
                          {l.public_mint_href ? (
                            <Link href={l.public_mint_href} className="text-[#5C6773] hover:text-[#9BA8B4]">
                              Public
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CommandCard>
        ) : null}

        {hub && hub.recent_activity.length > 0 ? (
          <CommandCard label="activity.sys">
            <ActivityLog lines={hub.recent_activity} />
          </CommandCard>
        ) : null}

        <p className="flex items-center gap-2 font-mono text-[10px] text-[#5C6773]">
          <Rocket className="h-3.5 w-3.5" aria-hidden />
          Public holder hub: <Link href="/owl-center" className="text-[#00C97A] hover:underline">/owl-center</Link>
        </p>
      </div>
    </main>
  )
}
