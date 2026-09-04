'use client'

import { cn } from '@/lib/utils'

type Props = {
  selectorLit: boolean
}

export function VaultChrome({ selectorLit }: Props) {
  return (
    <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
      <div
        className={cn(
          'absolute inset-[4%] rounded-full border border-[#00FF9C]/25',
          'bg-[conic-gradient(from_0deg,rgba(0,255,156,0.07)_0deg,transparent_40deg,rgba(0,255,156,0.05)_80deg,transparent_140deg,rgba(0,255,156,0.08)_200deg,transparent_280deg,rgba(0,255,156,0.06)_360deg)]',
          'shadow-[inset_0_0_40px_rgba(0,255,156,0.08)]',
          'animate-vault-ring-cw motion-reduce:animate-none'
        )}
      />
      <div
        className={cn(
          'absolute inset-[11%] rounded-full border border-dashed border-[#00FF9C]/20',
          'animate-vault-ring-ccw motion-reduce:animate-none'
        )}
      />
      <div className="absolute inset-[18%] rounded-full border border-[#00FF9C]/15 bg-black/35" />
      <div
        className={cn(
          'absolute inset-[26%] rounded-full border border-[#00FF9C]/10',
          'bg-[radial-gradient(circle_at_50%_42%,rgba(0,255,156,0.16),transparent_62%)]',
          'animate-vault-ring-cw-slow motion-reduce:animate-none'
        )}
      />

      <div
        className={cn(
          'absolute bottom-[1.5%] left-1/2 z-20 -translate-x-1/2',
          'text-[#00FF9C] drop-shadow-[0_0_8px_rgba(0,255,156,0.45)]',
          selectorLit ? 'animate-vault-selector-flash' : 'opacity-70'
        )}
      >
        <svg width="28" height="20" viewBox="0 0 28 20" fill="currentColor" aria-hidden>
          <path d="M14 18L2 4h24L14 18z" />
        </svg>
      </div>
    </div>
  )
}
