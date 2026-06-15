'use client'

import { useState } from 'react'
import { Copy, Download, ExternalLink } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  creatorHashListApiPath,
  publicHashListDownloadPath,
} from '@/lib/owl-center/creator-api-paths'
import { magicEdenCreatorHubUrl } from '@/lib/owl-center/marketplace-urls'

type HashListPayload = {
  hash_list_text?: string
  mint_count?: number
  collection_mint?: string | null
  suggested_magic_eden_url?: string | null
}

type Props = {
  launchId: string
  slug?: string | null
  /** Defaults to creator API; admin panels pass admin path. */
  hashListApiPath?: string
  onSuggestedUrls?: (urls: { collectionMint?: string | null; magicEdenUrl?: string | null }) => void
  compact?: boolean
}

export function MagicEdenHashListPanel({
  launchId,
  slug,
  hashListApiPath,
  onSuggestedUrls,
  compact = false,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mintCount, setMintCount] = useState<number | null>(null)

  const apiPath = hashListApiPath ?? creatorHashListApiPath(launchId)
  const downloadHref = slug?.trim() ? publicHashListDownloadPath(slug.trim()) : null

  async function loadPayload(): Promise<HashListPayload> {
    const res = await fetch(apiPath, { credentials: 'include', cache: 'no-store' })
    const j = (await res.json()) as HashListPayload & { error?: string }
    if (!res.ok) throw new Error(j.error || 'hash_list_failed')
    if (!j.hash_list_text?.trim()) throw new Error('No mints recorded yet')
    setMintCount(j.mint_count ?? j.hash_list_text.split('\n').filter(Boolean).length)
    return j
  }

  async function copyHashList() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const j = await loadPayload()
      await navigator.clipboard.writeText(j.hash_list_text ?? '')
      setMsg(`Copied ${j.mint_count ?? 0} mint address${j.mint_count === 1 ? '' : 'es'} — paste into Magic Eden Creator Hub.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'copy_failed')
    } finally {
      setBusy(false)
    }
  }

  async function prepareMagicEdenSubmission() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const j = await loadPayload()
      await navigator.clipboard.writeText(j.hash_list_text ?? '')
      window.open(magicEdenCreatorHubUrl(), '_blank', 'noopener,noreferrer')
      onSuggestedUrls?.({
        collectionMint: j.collection_mint,
        magicEdenUrl: j.suggested_magic_eden_url,
      })
      setMsg(
        `Hash list copied (${j.mint_count ?? 0} mint${j.mint_count === 1 ? '' : 's'}) · Creator Hub opened — paste under your collection listing application.`
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'me_prep_failed')
    } finally {
      setBusy(false)
    }
  }

  const label = compact ? 'MAGIC EDEN · HASH LIST' : 'marketplace_listing.sys · MAGIC EDEN'

  return (
    <CommandCard label={label}>
      <p className="mb-4 text-xs leading-relaxed text-[#9BA8B4]">
        Magic Eden does not offer a public API to submit hash lists — you still log into Creator Hub once. Owl Center
        generates the mint list from your drop and copies it for paste-and-submit.
        {mintCount != null ? ` · ${mintCount} mint${mintCount === 1 ? '' : 's'} ready` : ''}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <DeployButton
          type="button"
          className="w-full px-4 text-sm sm:w-auto"
          disabled={busy}
          onClick={() => void prepareMagicEdenSubmission()}
        >
          {busy ? 'Preparing…' : 'Copy hash list + open ME'}
        </DeployButton>
        <DeployButton
          type="button"
          variant="ghost"
          className="w-full px-4 text-sm sm:w-auto"
          disabled={busy}
          onClick={() => void copyHashList()}
        >
          <Copy className="mr-2 inline h-4 w-4" aria-hidden />
          Copy mint list
        </DeployButton>
        {downloadHref ? (
          <a
            href={downloadHref}
            download={slug ? `${slug}-hash-list.txt` : 'hash-list.txt'}
            className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 border border-[#1A222B] px-4 font-mono text-xs uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35 sm:w-auto"
          >
            <Download className="h-4 w-4 shrink-0" aria-hidden />
            Download .txt
          </a>
        ) : null}
        <a
          href={magicEdenCreatorHubUrl()}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 border border-[#1A222B] px-4 font-mono text-xs uppercase tracking-wide text-[#9BA8B4] hover:border-[#00FF9C]/35 sm:w-auto"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          Creator Hub
        </a>
      </div>
      {err ? <p className="mt-3 font-mono text-xs leading-relaxed text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs leading-relaxed text-[#00FF9C]">{msg}</p> : null}
    </CommandCard>
  )
}
