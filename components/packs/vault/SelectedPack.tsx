'use client'

import { useEffect, useRef, useState } from 'react'
import { PackHoverClip } from '@/components/packs/PackHoverVideo'
import { PackVisual } from '@/components/packs/PackVisual'
import { cn } from '@/lib/utils'

type Props = {
  selectedIndex: number
  paying?: boolean
}

export function SelectedPack({ selectedIndex, paying = false }: Props) {
  const [failed, setFailed] = useState(false)
  const swapRef = useRef<HTMLDivElement | null>(null)
  const skipFirstSwap = useRef(true)

  useEffect(() => {
    const el = swapRef.current
    if (!el) return
    if (skipFirstSwap.current) {
      skipFirstSwap.current = false
      return
    }
    el.classList.remove('animate-vault-pack-swap')
    void el.offsetWidth
    el.classList.add('animate-vault-pack-swap')
  }, [selectedIndex])

  return (
    <div className="pointer-events-none absolute inset-0 z-[8] flex items-center justify-center">
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 top-[46%] h-[min(48%,17rem)] w-[min(64%,15rem)] -translate-x-1/2 -translate-y-1/2 rounded-full',
          'bg-[radial-gradient(circle,rgba(0,255,156,0.38),transparent_68%)] blur-2xl',
          'animate-vault-glow-pulse motion-reduce:animate-none',
          paying ? 'opacity-100' : 'opacity-80'
        )}
        aria-hidden
      />
      <div
        className={cn(
          'relative z-[1] w-[min(48%,12rem)] sm:w-[min(44%,14rem)]',
          'translate-y-[-2%]',
          paying
            ? 'animate-pack-pay-pulse'
            : 'animate-vault-selected-float motion-reduce:animate-none'
        )}
      >
        <div ref={swapRef} className="motion-reduce:animate-none">
          {failed ? (
            <PackVisual phase={paying ? 'paying' : 'idle'} className="max-w-none" />
          ) : (
            <PackHoverClip
              className="relative mx-auto aspect-[180/305] w-full max-h-[min(36dvh,280px)] sm:max-h-[min(40dvh,320px)]"
              onHoverFailed={() => setFailed(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
