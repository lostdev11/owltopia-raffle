'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Shield, Sparkles } from 'lucide-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import {
  readStoredOwlCenterViewMode,
  writeStoredOwlCenterViewMode,
  type OwlCenterViewMode,
} from '@/lib/owl-center/view-mode'

export function AdminOwlCenterViewModePanel() {
  const [viewMode, setViewModeState] = useState<OwlCenterViewMode>('public')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setViewModeState(readStoredOwlCenterViewMode())
    setHydrated(true)
  }, [])

  function setViewMode(mode: OwlCenterViewMode) {
    const next = mode === 'admin' ? 'admin' : 'public'
    setViewModeState(next)
    writeStoredOwlCenterViewMode(next)
  }

  return (
    <CommandCard label="owl_center_view.sys">
      <p className="mb-4 text-sm text-[#9BA8B4]">
        Choose what you see on <strong className="font-normal text-[#E8EEF2]">/owl-center</strong>.{' '}
        <strong className="font-normal text-[#E8EEF2]">Public</strong> is the holder experience (Gen2 mint, no launchpad
        nav). <strong className="font-normal text-[#E8EEF2]">Admin</strong> adds generator, submit flow, and hub links.
        Per browser — connect your admin wallet or stay signed in on /owl-center for this to apply.
      </p>
      <div
        className="inline-flex items-center gap-1 rounded-md border border-[#1A222B] bg-[#10161C] p-0.5"
        role="group"
        aria-label="Owl Center view mode"
      >
        <button
          type="button"
          disabled={!hydrated}
          className={`inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded px-3 font-mono text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 ${
            viewMode === 'public'
              ? 'bg-[#1A222B] text-[#E8FDF4]'
              : 'text-[#9BA8B4] hover:text-[#C5D0D8]'
          }`}
          aria-pressed={viewMode === 'public'}
          onClick={() => setViewMode('public')}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
          Public
        </button>
        <button
          type="button"
          disabled={!hydrated}
          className={`inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded px-3 font-mono text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 ${
            viewMode === 'admin'
              ? 'bg-[#00FF9C]/15 text-[#E8FDF4]'
              : 'text-[#9BA8B4] hover:text-[#C5D0D8]'
          }`}
          aria-pressed={viewMode === 'admin'}
          onClick={() => setViewMode('admin')}
        >
          <Shield className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
          Admin
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/owl-center"
          className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#1A222B] px-4 text-sm text-[#9BA8B4] hover:border-[#00FF9C]/35"
        >
          Open Owl Center
        </Link>
        {viewMode === 'admin' ? (
          <Link
            href="/owl-center/generator"
            className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-4 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10"
          >
            Generator
          </Link>
        ) : null}
      </div>
    </CommandCard>
  )
}
