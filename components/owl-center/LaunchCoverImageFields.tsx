'use client'

import { useCallback, useEffect, useState } from 'react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { HubCardCoverImage } from '@/components/owl-center/HubCardCoverImage'
import type { LaunchCoverCandidate } from '@/lib/owl-center/launch-cover-image'

type Props = {
  launchId: string
  initialCoverUrl: string | null
  coverOptionsPath?: string
  coverSavePath?: string
  onSaved?: (url: string | null) => void
}

export function LaunchCoverImageFields({
  launchId,
  initialCoverUrl,
  coverOptionsPath = `/api/owl-center/launches/${launchId}/cover-options`,
  coverSavePath = `/api/owl-center/launches/${launchId}/mint-config`,
  onSaved,
}: Props) {
  const [coverUrl, setCoverUrl] = useState(initialCoverUrl ?? '')
  const [candidates, setCandidates] = useState<LaunchCoverCandidate[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setCoverUrl(initialCoverUrl ?? '')
  }, [initialCoverUrl])

  const [optionsErr, setOptionsErr] = useState<string | null>(null)

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true)
    setOptionsErr(null)
    try {
      const res = await fetch(coverOptionsPath, { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as { candidates?: LaunchCoverCandidate[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setCandidates(j.candidates ?? [])
    } catch (e) {
      setCandidates([])
      setOptionsErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoadingOptions(false)
    }
  }, [coverOptionsPath])

  useEffect(() => {
    void loadOptions()
  }, [loadOptions])

  async function saveCover() {
    setSaving(true)
    setMsg(null)
    setErr(null)
    try {
      const res = await fetch(coverSavePath, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_image_url: coverUrl.trim() || null }),
      })
      const j = (await res.json()) as { error?: string; launch?: { image_url?: string | null } }
      if (!res.ok) throw new Error(j.error || 'save_failed')
      const next = j.launch?.image_url ?? (coverUrl.trim() || null)
      setMsg('Hub card cover saved.')
      onSaved?.(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setSaving(false)
    }
  }

  const preview =
    coverUrl.trim().startsWith('http://') || coverUrl.trim().startsWith('https://') || coverUrl.trim().startsWith('/')
      ? coverUrl.trim()
      : null

  return (
    <div className="grid gap-4 border border-[#1A222B] bg-[#0F1419]/60 p-4">
      <p className="font-mono text-xs leading-relaxed text-[#9BA8B4]">
        Hub card cover — shown on Owl Center home and drops. Pick an uploaded NFT image or paste an Arweave/HTTPS URL.
      </p>

      <div className="grid gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Pick from uploaded assets
        </p>

        {loadingOptions ? (
          <p className="font-mono text-xs text-[#9BA8B4]">Loading NFT images…</p>
        ) : candidates.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {candidates.map((c) => {
              const selected = coverUrl.trim() === c.url
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCoverUrl(c.url)}
                  title={c.label}
                  className={[
                    'group relative aspect-square touch-manipulation overflow-hidden border bg-[#0F1419] text-left',
                    selected ? 'border-[#00FF9C] ring-1 ring-[#00FF9C]' : 'border-[#1A222B] hover:border-[#2A3540]',
                  ].join(' ')}
                >
                  <HubCardCoverImage imageUrl={c.url} fit="cover" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 font-mono text-[9px] text-[#F4FBF8]">
                    {c.label}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="font-mono text-xs text-[#9BA8B4]">
            {optionsErr
              ? `Could not load NFT images (${optionsErr}). Try Refresh, or paste a URL below.`
              : 'No uploaded NFT images found yet. Upload assets for this launch, or paste an Arweave/HTTPS URL below.'}
          </p>
        )}
      </div>

      <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Cover image URL
        <input
          type="url"
          value={coverUrl}
          onChange={(e) => setCoverUrl(e.target.value)}
          placeholder="https://arweave.net/…"
          className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
        />
      </label>

      {preview ? (
        <div className="relative aspect-[4/3] border border-[#1A222B] bg-[#0F1419]">
          <HubCardCoverImage imageUrl={preview} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <DeployButton type="button" disabled={saving || !coverUrl.trim()} onClick={() => void saveCover()}>
          {saving ? 'Saving…' : 'Save cover'}
        </DeployButton>
        <DeployButton type="button" variant="ghost" disabled={loadingOptions} onClick={() => void loadOptions()}>
          Refresh NFT list
        </DeployButton>
      </div>
      {err ? <p className="font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </div>
  )
}
