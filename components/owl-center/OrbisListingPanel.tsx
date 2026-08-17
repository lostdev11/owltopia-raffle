'use client'

import { useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { creatorHashListApiPath } from '@/lib/owl-center/creator-api-paths'
import { orbisListCollectionUrl } from '@/lib/owl-center/marketplace-urls'

type HashListPayload = {
  collection_mint?: string | null
  orbis_list_url?: string
  orbis_submit_hint?: string
}

type Props = {
  launchId: string
  /** Defaults to creator API; admin panels pass admin path. */
  hashListApiPath?: string
  /** When known without fetching the hash-list endpoint. */
  collectionMint?: string | null
  onCollectionMint?: (mint: string | null) => void
  compact?: boolean
  /** Render as a section inside a parent CommandCard instead of its own card. */
  embedded?: boolean
}

export function OrbisListingPanel({
  launchId,
  hashListApiPath,
  collectionMint: collectionMintProp,
  onCollectionMint,
  compact = false,
  embedded = false,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [resolvedMint, setResolvedMint] = useState<string | null>(collectionMintProp?.trim() || null)

  const apiPath = hashListApiPath ?? creatorHashListApiPath(launchId)
  const listUrl = orbisListCollectionUrl()

  async function resolveCollectionMint(): Promise<string> {
    const fromProp = collectionMintProp?.trim() || resolvedMint?.trim() || ''
    if (fromProp) return fromProp

    const res = await fetch(apiPath, { credentials: 'include', cache: 'no-store' })
    const j = (await res.json()) as HashListPayload & { error?: string }
    if (!res.ok) throw new Error(j.error || 'collection_mint_lookup_failed')
    const mint = j.collection_mint?.trim() || ''
    if (!mint) throw new Error('Collection mint not available yet — finish sell-out prep first.')
    setResolvedMint(mint)
    onCollectionMint?.(mint)
    return mint
  }

  async function copyCollectionMint() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const mint = await resolveCollectionMint()
      await navigator.clipboard.writeText(mint)
      setMsg('Collection mint copied — paste into Orbis List Your Collection.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'copy_failed')
    } finally {
      setBusy(false)
    }
  }

  async function prepareOrbisListing() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const mint = await resolveCollectionMint()
      await navigator.clipboard.writeText(mint)
      window.open(listUrl, '_blank', 'noopener,noreferrer')
      setMsg(
        'Collection mint copied · Orbis opened — paste the mint in List Your Collection, verify as UA, then paste the live Orbis URL back here when indexed.'
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'orbis_prep_failed')
    } finally {
      setBusy(false)
    }
  }

  const label = compact ? 'ORBIS · LIST COLLECTION' : 'marketplace_listing.sys · ORBIS'

  const body = (
    <>
      <p className="mb-4 text-xs leading-relaxed text-[#9BA8B4]">
        Orbis lists from your on-chain collection mint (not a hash list). Owl Center copies the mint and opens Orbis
        List Your Collection so you can submit and verify as update authority.
        {resolvedMint ? ` · mint ${resolvedMint.slice(0, 4)}…${resolvedMint.slice(-4)}` : ''}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <DeployButton
          type="button"
          className="w-full px-4 text-sm sm:w-auto"
          disabled={busy}
          onClick={() => void prepareOrbisListing()}
        >
          {busy ? 'Preparing…' : 'Copy mint + open Orbis'}
        </DeployButton>
        <DeployButton
          type="button"
          variant="ghost"
          className="w-full px-4 text-sm sm:w-auto"
          disabled={busy}
          onClick={() => void copyCollectionMint()}
        >
          <Copy className="mr-2 inline h-4 w-4" aria-hidden />
          Copy collection mint
        </DeployButton>
        <a
          href={listUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 border border-[#1A222B] px-4 font-mono text-xs uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35 sm:w-auto"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          Orbis list
        </a>
      </div>
      {err ? <p className="mt-3 font-mono text-xs leading-relaxed text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs leading-relaxed text-[#00FF9C]">{msg}</p> : null}
    </>
  )

  if (embedded) {
    return <CommandCardSection label={label}>{body}</CommandCardSection>
  }

  return <CommandCard label={label}>{body}</CommandCard>
}
