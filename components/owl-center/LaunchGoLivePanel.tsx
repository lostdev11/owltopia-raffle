'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { StatusBadge } from '@/components/owl-center/StatusBadge'
import type { LaunchGoLiveAssessment } from '@/lib/owl-center/launch-go-live'
import type { OwlCenterAssetPackage, OwlCenterMarketplaceReadiness } from '@/lib/owl-center/asset-types'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

type Props = {
  launchId: string
  launch: OwlCenterLaunchPublic
  assetPackage: OwlCenterAssetPackage | null
  marketplaceReadiness: OwlCenterMarketplaceReadiness | null
  onPromoted?: () => void
}

export function LaunchGoLivePanel({
  launchId,
  launch,
  assetPackage,
  marketplaceReadiness,
  onPromoted,
}: Props) {
  const [assessment, setAssessment] = useState<LaunchGoLiveAssessment | null>(null)
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [publicMintHref, setPublicMintHref] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/owl-center/launches/${launchId}/go-live`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const j = (await res.json()) as {
        assessment?: LaunchGoLiveAssessment
        error?: string
        public_mint_href?: string | null
      }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setAssessment(j.assessment ?? null)
      setPublicMintHref(j.public_mint_href ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [launchId])

  useEffect(() => {
    void refresh()
  }, [refresh, launch.status, launch.is_paused, launch.active_phase, assetPackage, marketplaceReadiness])

  async function goLive() {
    setPromoting(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/owl-center/launches/${launchId}/go-live`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const j = (await res.json()) as {
        ok?: boolean
        error?: string
        blockers?: string[]
        already_live?: boolean
        public_mint_href?: string
      }
      if (!res.ok) {
        const extra = Array.isArray(j.blockers) ? j.blockers.join(' ') : ''
        throw new Error([j.error, extra].filter(Boolean).join(' — ') || 'go_live_failed')
      }
      setMsg(
        j.already_live
          ? 'Launch is already live on the public mint console.'
          : 'Approved — collection is live. Public mint page is open below.'
      )
      if (j.public_mint_href) setPublicMintHref(j.public_mint_href)
      onPromoted?.()
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'go_live_failed')
    } finally {
      setPromoting(false)
    }
  }

  const showPanel =
    launch.status === 'PENDING_REVIEW' ||
    launch.status === 'DRAFT' ||
    launch.is_paused ||
    launch.active_phase !== 'PUBLIC' ||
    launch.mint_mode !== 'public_simple'

  if (!showPanel && assessment?.already_live) return null

  const live =
    assessment?.already_live &&
    launch.status !== 'PENDING_REVIEW' &&
    launch.status !== 'DRAFT' &&
    !launch.is_paused &&
    launch.active_phase === 'PUBLIC'

  return (
    <CommandCard label="LAUNCH_APPROVAL · GO_LIVE">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={launch.status} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          phase={launch.active_phase} · paused={String(launch.is_paused)} · mode={launch.mint_mode}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-[#9BA8B4]">
        Creator submissions start as <span className="text-[#FFD769]">PENDING_REVIEW</span> with mint paused. When assets
        are on Arweave, Sugar is deployed, and CM + collection mint are saved below, approve here to open the public mint
        page. Saving marketplace IDs can also auto-approve when everything is ready.
      </p>

      {loading ? (
        <p className="mt-4 font-mono text-xs text-[#5C6773]">Checking readiness…</p>
      ) : assessment && assessment.blockers.length > 0 && !live ? (
        <ul className="mt-4 space-y-2 font-mono text-xs text-[#FFD769]">
          {assessment.blockers.map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <DeployButton
          type="button"
          disabled={promoting || loading || live || !assessment?.can_promote}
          onClick={() => void goLive()}
        >
          {promoting ? 'Approving…' : live ? 'Live' : 'Approve & go live'}
        </DeployButton>
        {!live ? (
          <DeployButton type="button" variant="ghost" disabled={loading} onClick={() => void refresh()}>
            Refresh status
          </DeployButton>
        ) : (
          <Link
            href={publicMintHref ?? `/owl-center/collection/${launch.slug}`}
            className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-4 text-xs font-bold uppercase tracking-wide text-[#00FF9C] hover:bg-[#00FF9C]/10"
          >
            Open public mint
          </Link>
        )}
      </div>

      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </CommandCard>
  )
}
