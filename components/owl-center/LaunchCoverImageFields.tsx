'use client'

import { useCallback, useEffect, useState } from 'react'

import { DeployButton } from '@/components/owl-center/DeployButton'
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

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true)
    try {
      const res = await fetch(coverOptionsPath, { credentials: 'include', cache: 'no-store' })
      const j = (await res.json()) as { candidates?: LaunchCoverCandidate[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setCandidates(j.candidates ?? [])
    } catch {
      setCandidates([])
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
    coverUrl.trim().startsWith('http://') || coverUrl.trim().startsWith('https://')
      ? coverUrl.trim()
      : null

  return (
    <div className="grid gap-4 border border-[#1A222B] bg-[#0F1419]/60 p-4">
      <p className="font-mono text-xs leading-relaxed text-[#9BA8B4]">
        Hub card cover — shown on Owl Center home and drops. Pick an uploaded NFT image or paste an Arweave/HTTPS URL.
      </p>

      {candidates.length > 0 ? (
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Pick from uploaded assets
          <select
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            value=""
            disabled={loadingOptions}
            onChange={(e) => {
              const url = e.target.value
              if (url) setCoverUrl(url)
            }}
          >
            <option value="">{loadingOptions ? 'Loading…' : 'Choose NFT or collection image…'}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.url}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="absolute inset-0 m-auto max-h-full max-w-full object-contain p-4" />
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
