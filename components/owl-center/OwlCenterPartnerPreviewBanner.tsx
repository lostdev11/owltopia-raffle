'use client'

import { Handshake, Shield, X } from 'lucide-react'

import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'

/** Compact banner when an admin is in Partner preview on Owl Center pages. */
export function OwlCenterPartnerPreviewBanner() {
  const { isOwlCenterAdmin, isPartnerPreview, setViewMode } = useOwlCenterView()

  if (!isOwlCenterAdmin || !isPartnerPreview) return null

  return (
    <div
      role="status"
      className="border-b border-[#FFD769]/35 bg-[#FFD769]/10 px-3 py-2 sm:px-4"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <p className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[#E8FDF4]">
          <Handshake className="h-4 w-4 shrink-0 text-[#FFD769]" aria-hidden />
          <span>
            <span className="font-bold text-[#FFD769]">Partner preview</span>
            <span className="text-[#C5D0D8]"> — launch tools + plain copy. Switch to Admin for operator chrome.</span>
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setViewMode('admin')}
            className="inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-3 font-mono text-[10px] font-bold uppercase tracking-widest text-[#00FF9C]"
          >
            <Shield className="h-3.5 w-3.5" aria-hidden />
            Admin
          </button>
          <button
            type="button"
            onClick={() => setViewMode('public')}
            className="inline-flex min-h-[44px] touch-manipulation items-center gap-1.5 border border-[#1A222B] px-3 font-mono text-[10px] font-bold uppercase tracking-widest text-[#9BA8B4] hover:border-[#FFD769]/35"
            aria-label="Exit partner preview to public view"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Exit
          </button>
        </div>
      </div>
    </div>
  )
}
