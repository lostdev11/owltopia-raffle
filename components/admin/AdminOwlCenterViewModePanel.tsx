'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Handshake, Shield, Sparkles } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import {
  OWL_CENTER_VIEW_MODE_EVENT,
  parseOwlCenterViewMode,
  readStoredOwlCenterViewMode,
  writeStoredOwlCenterViewMode,
  type OwlCenterViewMode,
} from '@/lib/owl-center/view-mode'

const MODES: Array<{
  id: OwlCenterViewMode
  label: string
  icon: typeof Sparkles
  activeClass: string
}> = [
  {
    id: 'public',
    label: 'Public',
    icon: Sparkles,
    activeClass: 'bg-[#1A222B] text-[#E8FDF4]',
  },
  {
    id: 'partner',
    label: 'Partner',
    icon: Handshake,
    activeClass: 'bg-[#FFD769]/15 text-[#E8FDF4]',
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Shield,
    activeClass: 'bg-[#00FF9C]/15 text-[#E8FDF4]',
  },
]

export function AdminOwlCenterViewModePanel() {
  const [viewMode, setViewModeState] = useState<OwlCenterViewMode>('public')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setViewModeState(readStoredOwlCenterViewMode())
    setHydrated(true)
    const onLocal = (event: Event) => {
      const next = parseOwlCenterViewMode((event as CustomEvent<string>).detail)
      if (next) setViewModeState(next)
    }
    window.addEventListener(OWL_CENTER_VIEW_MODE_EVENT, onLocal)
    return () => window.removeEventListener(OWL_CENTER_VIEW_MODE_EVENT, onLocal)
  }, [])

  function setViewMode(mode: OwlCenterViewMode) {
    const next = parseOwlCenterViewMode(mode) ?? 'public'
    setViewModeState(next)
    writeStoredOwlCenterViewMode(next)
  }

  return (
    <CommandCard label="owl_center_view.sys">
      <p className="mb-4 text-sm text-[#9BA8B4]">
        Choose what you see on <strong className="font-normal text-[#E8EEF2]">/owl-center</strong>.{' '}
        <strong className="font-normal text-[#E8EEF2]">Public</strong> is the holder mint experience.{' '}
        <strong className="font-normal text-[#E8EEF2]">Partner</strong> mirrors approved partners (launch
        tools + plain copy). <strong className="font-normal text-[#E8EEF2]">Admin</strong> is full operator
        chrome. Per browser — connect your admin wallet or stay signed in on /owl-center for this to apply.
      </p>
      <div
        className="inline-flex flex-wrap items-center gap-1 rounded-md border border-[#1A222B] bg-[#10161C] p-0.5"
        role="group"
        aria-label="Owl Center view mode"
      >
        {MODES.map(({ id, label, icon: Icon, activeClass }) => (
          <button
            key={id}
            type="button"
            disabled={!hydrated}
            className={`inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded px-3 font-mono text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 ${
              viewMode === id ? activeClass : 'text-[#9BA8B4] hover:text-[#C5D0D8]'
            }`}
            aria-pressed={viewMode === id}
            onClick={() => setViewMode(id)}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/owl-center"
          className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:border-[#00FF9C]/35"
        >
          Open Owl Center
        </Link>
        {viewMode === 'admin' || viewMode === 'partner' ? (
          <Link
            href="/owl-center/generator"
            className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-4 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10"
          >
            Generator
          </Link>
        ) : null}
        {viewMode === 'partner' ? (
          <Link
            href="/owl-center/my-launches"
            className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#FFD769]/35 px-4 text-sm font-bold text-[#FFD769] hover:bg-[#FFD769]/10"
          >
            My Launches
          </Link>
        ) : null}
      </div>
    </CommandCard>
  )
}
