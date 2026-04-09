'use client'

import { cn } from '@/lib/utils'

/** Tensor logo (user-provided SVG from Downloads `tt (1).svg`). */
export function TensorIcon({
  className,
  'aria-hidden': ariaHidden = true,
  floatingOverlay = false,
}: {
  className?: string
  'aria-hidden'?: boolean
  floatingOverlay?: boolean
}) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center box-border p-1.5 sm:p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- local SVG; avoids next/image + dangerouslyAllowSVG */}
      <img
        src="/marketplace-icons/tensor.svg"
        alt={ariaHidden ? '' : 'Tensor'}
        width={1606}
        height={1628}
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
