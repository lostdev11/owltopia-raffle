'use client'

import Link from 'next/link'
import { Shield, Sparkles } from 'lucide-react'

import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { owlCenterNavItemsForView } from '@/lib/owl-center/nav'

export function OwlCenterHubQuickLinks() {
  const { showAdminFeatures } = useOwlCenterView()
  const items = owlCenterNavItemsForView(showAdminFeatures).filter((item) => item.href !== '/owl-center')

  return (
    <>
      <p className="mt-3 max-w-2xl text-sm text-[#5C6773]">
        {showAdminFeatures
          ? 'Use the bar above to jump between Gen2 mint, presale, generator, and live drops. Phantom / Solflare on mobile.'
          : 'Use the bar above for Gen2 mint, presale, and live drops. Phantom / Solflare on mobile.'}
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon
          const primary = item.href.includes('collection/gen2')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                primary
                  ? 'flex min-h-[88px] touch-manipulation flex-col justify-between border border-[#00FF9C]/40 bg-[#00FF9C]/10 p-4 hover:bg-[#00FF9C]/16'
                  : 'flex min-h-[88px] touch-manipulation flex-col justify-between border border-[#1A222B] bg-[#10161C]/80 p-4 hover:border-[#00FF9C]/30'
              }
            >
              <Icon className={`h-5 w-5 ${primary ? 'text-[#00FF9C]' : 'text-[#9BA8B4]'}`} aria-hidden />
              <div>
                <p className="font-bold text-[#F4FBF8]">{item.label}</p>
                <p className="mt-1 text-xs text-[#9BA8B4]">{item.description}</p>
              </div>
            </Link>
          )
        })}
      </div>
    </>
  )
}

export function OwlCenterSubmitHint() {
  const { showAdminFeatures } = useOwlCenterView()

  if (!showAdminFeatures) {
    return (
      <p className="mt-4 font-mono text-sm text-[#5C6773]">
        Partner collections will appear here when announced.
      </p>
    )
  }

  return (
    <p className="mt-4 font-mono text-sm text-[#5C6773]">
      Submit via{' '}
      <Link href="/owl-center/launch" className="text-[#00C97A] hover:underline">
        /owl-center/launch
      </Link>{' '}
      — review queue (no auto-deploy).
    </p>
  )
}

export function OwlCenterViewModeToggle() {
  const { adminLoading, isOwlCenterAdmin, viewMode, setViewMode } = useOwlCenterView()

  if (adminLoading || !isOwlCenterAdmin) return null

  return (
    <div
      className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-[#1A222B] bg-[#10161C] p-0.5"
      role="group"
      aria-label="Owl Center view mode"
    >
      <button
        type="button"
        className={`inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded px-2.5 font-mono text-[10px] font-bold uppercase tracking-widest sm:px-3 ${
          viewMode === 'public'
            ? 'bg-[#1A222B] text-[#E8FDF4]'
            : 'text-[#9BA8B4] hover:text-[#C5D0D8]'
        }`}
        aria-pressed={viewMode === 'public'}
        onClick={() => setViewMode('public')}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
        <span className="sm:inline">Public</span>
      </button>
      <button
        type="button"
        className={`inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded px-2.5 font-mono text-[10px] font-bold uppercase tracking-widest sm:px-3 ${
          viewMode === 'admin'
            ? 'bg-[#00FF9C]/15 text-[#E8FDF4]'
            : 'text-[#9BA8B4] hover:text-[#C5D0D8]'
        }`}
        aria-pressed={viewMode === 'admin'}
        onClick={() => setViewMode('admin')}
      >
        <Shield className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
        <span className="sm:inline">Admin</span>
      </button>
    </div>
  )
}
