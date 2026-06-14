'use client'

import Link from 'next/link'

import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { owlCenterNavItemsForView } from '@/lib/owl-center/nav'

export function OwlCenterHubQuickLinks() {
  const { showAdminFeatures } = useOwlCenterView()
  const items = owlCenterNavItemsForView(showAdminFeatures).filter((item) => item.href !== '/owl-center')

  return (
    <>
      <p className="mt-3 max-w-2xl text-sm text-[#5C6773]">
        {showAdminFeatures
          ? 'Jump between live drops, Gen2 mint, presale, generator, and partner mints. Phantom / Solflare on mobile.'
          : 'Browse live drops and mint partner collections. Connect Phantom or Solflare on mobile.'}
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
