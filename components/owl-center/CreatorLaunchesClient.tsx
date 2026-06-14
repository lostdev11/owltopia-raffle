'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { MetadataRefreshPanel } from '@/components/owl-center/MetadataRefreshPanel'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { Gen2PresaleSignInPrompt } from '@/components/gen2-presale/Gen2PresaleSignInPrompt'
import { useSiwsSession } from '@/hooks/use-siws-session'

type LaunchRow = {
  id: string
  slug: string
  name: string
  symbol: string | null
  status: string
  active_phase: string
  total_supply: number
  minted_count: number
  wallet_mint_limit: number
  updated_at: string
}

export function CreatorLaunchesClient() {
  const { connected } = useWallet()
  const { signedIn, checking, checkSession } = useSiwsSession()
  const { isOwlCenterAdmin, adminLoading } = useOwlCenterView()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [launches, setLaunches] = useState<LaunchRow[]>([])
  const [refreshLaunchId, setRefreshLaunchId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/owl-center/my-launches', { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as { error?: string; launches?: LaunchRow[]; isAdmin?: boolean }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setIsAdmin(Boolean(j.isAdmin))
      setLaunches(j.launches ?? [])
    } catch (e) {
      setLaunches([])
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (signedIn) void load()
  }, [signedIn, load])

  useEffect(() => {
    if (refreshLaunchId || launches.length === 0) return
    const withMints = launches.find((l) => l.minted_count > 0)
    if (withMints) setRefreshLaunchId(withMints.id)
  }, [launches, refreshLaunchId])

  function openMetadataRefresh(launchId: string) {
    setRefreshLaunchId(launchId)
    requestAnimationFrame(() => {
      document.getElementById(`metadata-refresh-${launchId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // CREATOR"
      title="My launches"
      subtitle="Edit mint details, fix wallet metadata (#N / blank image in Phantom or Solflare), and manage your collections."
    >
      {!adminLoading && !isOwlCenterAdmin ? (
        <div className="max-w-lg space-y-4">
          <p className="font-mono text-sm text-[#9BA8B4]">
            Launchpad creator tools are for Owl Vision admins only. Partner collections will appear here when announced.
          </p>
          <Link
            href="/owl-center/collection/gen2"
            className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-5 text-sm font-bold uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/16"
          >
            Go to Gen2 mint
          </Link>
        </div>
      ) : !connected ? (
        <p className="font-mono text-sm text-[#9BA8B4]">
          Connect your Solana wallet in the header (Phantom / Solflare on mobile), then sign in below.
        </p>
      ) : checking ? (
        <p className="font-mono text-sm text-[#5C6773]">Checking sign-in…</p>
      ) : !signedIn ? (
        <Gen2PresaleSignInPrompt
          title="Sign in with your creator wallet"
          message="One-time wallet signature — same as presale. Required so we can match you to your submitted collections on mobile."
          onSignedIn={() => {
            void checkSession().then((wallet) => {
              if (wallet) void load()
            })
          }}
        />
      ) : (
        <div className="grid max-w-2xl gap-6">
          {isAdmin ? (
            <p className="font-mono text-xs text-[#5C6773]">
              Admin view — showing all creator launches (not only rows where you are{' '}
              <span className="text-[#9BA8B4]">creator_wallet</span>).
            </p>
          ) : null}
          {loading ? <p className="font-mono text-sm text-[#5C6773]">Loading your launches…</p> : null}
          {err ? <p className="font-mono text-sm text-[#FF9C9C]">{err}</p> : null}
          {!loading && !err && launches.length === 0 ? (
            <p className="font-mono text-sm text-[#9BA8B4]">
              No collections found for this wallet. If you submitted under a different address, sign in with that wallet
              instead.
            </p>
          ) : null}
          {launches.map((l) => (
            <div key={l.id} className="space-y-4">
              <CommandCard label={`${l.status} · ${l.active_phase}`}>
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="font-display text-xl text-[#F4FBF8]">{l.name}</p>
                    <p className="mt-1 font-mono text-xs leading-relaxed text-[#5C6773]">
                      {l.symbol ?? '—'} · {l.minted_count}/{l.total_supply} minted · {l.wallet_mint_limit}/wallet/phase
                      · slug {l.slug.slice(0, 12)}…
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <Link
                      href={`/owl-center/my-launches/${l.id}/mint-details`}
                      className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 text-center font-bold uppercase tracking-wide text-[#E8FDF4] shadow-[0_0_24px_rgba(0,255,156,0.18)] hover:bg-[#00FF9C]/18 sm:w-auto"
                    >
                      Edit mint details
                    </Link>
                    <DeployButton
                      type="button"
                      variant="ghost"
                      className="w-full sm:w-auto"
                      onClick={() => openMetadataRefresh(l.id)}
                    >
                      Fix wallet metadata
                    </DeployButton>
                  </div>
                </div>
              </CommandCard>

              {refreshLaunchId === l.id ? (
                <MetadataRefreshPanel launchId={l.id} anchorId={`metadata-refresh-${l.id}`} />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </OwlCenterShell>
  )
}
