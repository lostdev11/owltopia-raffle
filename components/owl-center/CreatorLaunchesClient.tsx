'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
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
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [launches, setLaunches] = useState<LaunchRow[]>([])

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

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // CREATOR"
      title="My launches"
      subtitle="Edit mint details shown on your collection card — prices, phases, dates, and per-wallet caps."
    >
      {!connected ? (
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
            <CommandCard key={l.id} label={`${l.status} · ${l.active_phase}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-display text-xl text-[#F4FBF8]">{l.name}</p>
                  <p className="mt-1 font-mono text-xs text-[#5C6773]">
                    {l.symbol ?? '—'} · {l.minted_count}/{l.total_supply} minted · {l.wallet_mint_limit}/wallet/phase
                    · slug {l.slug.slice(0, 12)}…
                  </p>
                </div>
                <Link
                  href={`/owl-center/my-launches/${l.id}/mint-details`}
                  className="inline-flex min-h-[44px] shrink-0 touch-manipulation items-center justify-center border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-6 font-bold uppercase tracking-wide text-[#E8FDF4] shadow-[0_0_24px_rgba(0,255,156,0.18)] hover:bg-[#00FF9C]/18"
                >
                  Edit mint details
                </Link>
              </div>
            </CommandCard>
          ))}
        </div>
      )}
    </OwlCenterShell>
  )
}
