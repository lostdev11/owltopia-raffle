'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  fetchGen2GeneratorLink,
  linkGen2GeneratorProject,
  type Gen2GeneratorLink,
} from '@/lib/owl-center/generator/gen2-stage-client'

export function Gen2GeneratorLinkPanel({ onLinked }: { onLinked?: () => void }) {
  const [link, setLink] = useState<Gen2GeneratorLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [manualId, setManualId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const j = await fetchGen2GeneratorLink()
      setLink(j)
      if (j?.generator_project_id) setManualId(j.generator_project_id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function linkCloud() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    const res = await linkGen2GeneratorProject({ use_cloud_project: true })
    if (!res.ok) {
      setErr(res.error ?? 'link_failed')
    } else {
      setMsg('Linked your cloud generator project to Gen2.')
      if (res.link) setLink(res.link)
      onLinked?.()
    }
    setBusy(false)
  }

  async function linkManual() {
    setBusy(true)
    setErr(null)
    setMsg(null)
    const res = await linkGen2GeneratorProject({ generator_project_id: manualId.trim() || null })
    if (!res.ok) {
      setErr(res.error ?? 'link_failed')
    } else {
      setMsg(manualId.trim() ? 'Generator project linked.' : 'Generator link cleared.')
      if (res.link) setLink(res.link)
      onLinked?.()
    }
    setBusy(false)
  }

  if (loading) {
    return (
      <CommandCard label="gen2_generator.sys · LINK">
        <p className="font-mono text-xs text-[#5C6773]">Loading generator link…</p>
      </CommandCard>
    )
  }

  return (
    <CommandCard label="gen2_generator.sys · OWL GENERATOR">
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4]">
        Link your Owl Generator project to Gen2, then export the full {link?.total_supply ?? 2000}-piece supply and stage
        it here in one click — no manual ZIP download.
      </p>

      {link?.generator_project_id ? (
        <dl className="mb-4 grid gap-2 font-mono text-xs text-[#9BA8B4]">
          <div>
            <dt className="text-[#5C6773]">Linked project</dt>
            <dd className="text-[#00FF9C]">{link.linked_project_name ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[#5C6773]">Project ID</dt>
            <dd className="break-all text-[#C5D0D8]">{link.generator_project_id}</dd>
          </div>
        </dl>
      ) : (
        <p className="mb-4 rounded border border-[#FFD769]/30 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
          No generator linked yet — save a project in Owl Generator, then link below.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <DeployButton
          type="button"
          className="min-h-[44px] touch-manipulation"
          disabled={busy}
          onClick={() => void linkCloud()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link my cloud project'}
        </DeployButton>
        <Link
          href="/owl-center/generator?gen2=1"
          className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-4 font-mono text-xs uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/18"
        >
          Open Gen2 generator
        </Link>
      </div>

      <label className="mt-4 grid gap-2 text-sm text-[#C5D0D8]">
        Or paste project ID
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder="Generator project UUID"
          className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 font-mono text-sm"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <DeployButton type="button" variant="ghost" disabled={busy} onClick={() => void linkManual()}>
          Save link
        </DeployButton>
        {link?.generator_project_id ? (
          <DeployButton
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setManualId('')
              void linkGen2GeneratorProject({ generator_project_id: null }).then((res) => {
                if (res.ok && res.link) {
                  setLink(res.link)
                  setMsg('Link cleared.')
                  onLinked?.()
                }
              })
            }}
          >
            Clear link
          </DeployButton>
        ) : null}
      </div>

      {err ? <p className="mt-3 font-mono text-xs text-[#FF9C9C]">{err}</p> : null}
      {msg ? <p className="mt-3 font-mono text-xs text-[#00FF9C]">{msg}</p> : null}
    </CommandCard>
  )
}
