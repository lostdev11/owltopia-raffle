'use client'

import { HubCardCoverImage } from '@/components/owl-center/HubCardCoverImage'

/** Collection pfp / cover hero on mint pages (mobile-first ~390px). */
export function LaunchMintProfileImage({ imageUrl, alt }: { imageUrl: string; alt: string }) {
  const trimmed = imageUrl.trim()
  if (!trimmed) return null

  return (
    <div className="mb-6 flex justify-center sm:justify-start">
      <div
        className="relative aspect-square w-[min(100%,280px)] overflow-hidden rounded-2xl border border-[#1A222B] bg-[#0F1419] shadow-[0_16px_48px_rgba(0,0,0,0.45)] ring-1 ring-[#00FF9C]/12"
        role="img"
        aria-label={alt}
      >
        <HubCardCoverImage imageUrl={trimmed} alt={alt} fit="cover" />
      </div>
    </div>
  )
}
