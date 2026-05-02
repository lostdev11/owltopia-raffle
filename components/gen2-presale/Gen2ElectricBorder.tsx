'use client'

import { cn } from '@/lib/utils'

type Props = {
  children: React.ReactNode
  className?: string
  /** Blinking corner accents (default true). */
  corners?: boolean
}

/**
 * Animated “running lights” gradient ring + pulsing outer glow for Gen2 presale panels.
 * Respects `prefers-reduced-motion`: static border, no animation.
 */
export function Gen2ElectricBorder({ children, className, corners = true }: Props) {
  return (
    <div
      className={cn(
        'relative rounded-2xl animate-gen2-border-glow-ring motion-reduce:animate-none motion-reduce:shadow-[0_0_0_1px_rgba(0,229,139,0.35)]',
        className
      )}
    >
      {corners ? (
        <>
          <span
            className="pointer-events-none absolute -left-0.5 -top-0.5 z-10 h-2.5 w-2.5 rounded-tl-xl border-l-2 border-t-2 border-[#00FF9C] animate-gen2-corner-led motion-reduce:animate-none motion-reduce:opacity-70"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 h-2.5 w-2.5 rounded-tr-xl border-r-2 border-t-2 border-[#00FF9C] animate-gen2-corner-led motion-reduce:animate-none motion-reduce:opacity-70 [animation-delay:450ms]"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute -bottom-0.5 -left-0.5 z-10 h-2.5 w-2.5 rounded-bl-xl border-b-2 border-l-2 border-[#FFD769]/90 animate-gen2-corner-led motion-reduce:animate-none motion-reduce:opacity-70 [animation-delay:900ms]"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute -bottom-0.5 -right-0.5 z-10 h-2.5 w-2.5 rounded-br-xl border-b-2 border-r-2 border-[#FFD769]/90 animate-gen2-corner-led motion-reduce:animate-none motion-reduce:opacity-70 [animation-delay:1350ms]"
            aria-hidden
          />
        </>
      ) : null}
      <div
        className={cn(
          'rounded-2xl p-[2px] motion-reduce:p-px motion-reduce:bg-[linear-gradient(180deg,rgba(0,229,139,0.55),rgba(31,111,84,0.5))]',
          'bg-[linear-gradient(110deg,#1F6F54_0%,#00E58B_16%,#00FF9C_34%,#FFD769_50%,#00FF9C_66%,#00E58B_84%,#1F6F54_100%)]',
          'bg-[length:260%_260%] animate-gen2-border-flow motion-reduce:animate-none'
        )}
      >
        <div className="min-h-0 overflow-hidden rounded-[14px]">{children}</div>
      </div>
    </div>
  )
}
