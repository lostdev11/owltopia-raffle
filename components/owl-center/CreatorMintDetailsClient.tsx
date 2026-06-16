'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import {
  CollectionLaunchOpsCard,
  creatorLaunchOpsCardProps,
} from '@/components/owl-center/CollectionLaunchOpsCard'
import { Gen2PresaleSignInPrompt } from '@/components/gen2-presale/Gen2PresaleSignInPrompt'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { useSiwsSession } from '@/hooks/use-siws-session'
import { assessCreatorLaunchDeleteEligibility } from '@/lib/owl-center/creator-launch-delete'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Props = {
  launchId: string
}

export function CreatorMintDetailsClient({ launchId }: Props) {
  const { connected } = useWallet()
  const { signedIn, checking, checkSession } = useSiwsSession()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [launch, setLaunch] = useState<OwlCenterLaunchPublic | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/owl-center/launches/${launchId}/mint-config`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as { error?: string; launch?: OwlCenterLaunchPublic }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setLaunch(j.launch ?? null)
    } catch (e) {
      setLaunch(null)
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [launchId])

  useEffect(() => {
    if (signedIn) void load()
  }, [signedIn, load])

  const deletable = launch ? assessCreatorLaunchDeleteEligibility(launch).deletable : false

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // CREATOR"
      title={launch?.name ?? 'Mint details'}
      subtitle="Mint prices, phase schedule, Reveal Day blind mint, metadata refresh, and post–sell-out Magic Eden / Tensor listing."
    >
      <div className="mb-6">
        <Link href="/owl-center/my-launches">
          <DeployButton type="button" variant="ghost">
            ← My launches
          </DeployButton>
        </Link>
      </div>

      {!connected ? (
        <p className="font-mono text-sm text-[#9BA8B4]">
          Connect your Solana wallet in the header, then sign in to edit mint details.
        </p>
      ) : checking ? (
        <p className="font-mono text-sm text-[#5C6773]">Checking sign-in…</p>
      ) : !signedIn ? (
        <Gen2PresaleSignInPrompt
          title="Sign in with your creator wallet"
          message="Use the same wallet you submitted with. On mobile, stay in your wallet browser after signing."
          onSignedIn={() => {
            void checkSession().then((wallet) => {
              if (wallet) void load()
            })
          }}
        />
      ) : loading ? (
        <p className="font-mono text-sm text-[#5C6773]">Loading…</p>
      ) : err ? (
        <p className="font-mono text-sm text-[#FF9C9C]">{err}</p>
      ) : launch ? (
        <CollectionLaunchOpsCard
          {...creatorLaunchOpsCardProps(launchId, launch)}
          onSaved={() => void load()}
          deletable={deletable}
          redirectAfterDelete="/owl-center/my-launches"
          className="max-w-2xl"
        />
      ) : null}
    </OwlCenterShell>
  )
}
