'use client'

import { cn } from '@/lib/utils'

/**
 * Magic Eden wallet vertical lockup (positive / on-light artwork).
 * Official asset: `ME_Wallet_Vert_Pos.svg` from Magic Eden logo suite.
 */
export function MagicEdenIcon({
  className,
  'aria-hidden': ariaHidden = true,
  floatingOverlay = false,
}: {
  className?: string
  'aria-hidden'?: boolean
  /** Extra lift: soft shadow so the mark reads above the glass chip */
  floatingOverlay?: boolean
}) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center box-border p-1.5 sm:p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- local SVG with embedded gradients; next/image SVG needs extra config */}
      <img
        src="/marketplace-icons/magic-eden.svg"
        alt={ariaHidden ? '' : 'Magic Eden'}
        width={179}
        height={144}
        decoding="async"
        className={cn(
          'shrink-0 object-contain',
          floatingOverlay &&
            'drop-shadow-[0_2px_6px_rgba(0,0,0,0.16)] dark:drop-shadow-[0_3px_10px_rgba(0,0,0,0.55)]',
          className,
        )}
        aria-hidden={ariaHidden}
      />
    </span>
  )
}
