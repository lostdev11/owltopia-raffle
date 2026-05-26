'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { GEN2_OWL_CENTER_PATH } from '@/lib/gen2-presale/purchase-availability'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  /** When true, CTA promotes buying presale spots. */
  purchasesOpen?: boolean
  presaleSoldOut?: boolean
}

export function Gen2StickyCta({ className, purchasesOpen = false, presaleSoldOut = false }: Props) {
  const href = presaleSoldOut ? GEN2_OWL_CENTER_PATH : '#gen2-purchase'
  const label = presaleSoldOut
    ? 'Owl Center'
    : purchasesOpen
      ? 'Join Presale'
      : 'Presale info'

  return (
    <>
      {/* Desktop: floating */}
      <div
        className={cn(
          'fixed bottom-28 right-6 z-40 hidden md:block animate-gen2-floaty',
          className
        )}
      >
        <Button
          asChild
          size="lg"
          className={cn(
            'min-h-[48px] touch-manipulation border px-6 font-bold',
            purchasesOpen
              ? 'border-[#00FF9C]/45 bg-[#00E58B]/20 text-[#EAFBF4] shadow-[0_0_28px_rgba(0,255,156,0.35)] animate-button-glow-pulse hover:bg-[#00E58B]/35'
              : presaleSoldOut
                ? 'border-[#00FF9C]/40 bg-[#00E58B]/15 text-[#EAFBF4] shadow-[0_0_24px_rgba(0,255,156,0.2)] hover:bg-[#00E58B]/25'
                : 'border-[#1F6F54] bg-[#10161C] text-[#A9CBB9] shadow-none animate-none hover:bg-[#151D24]'
          )}
        >
          <Link href={href}>{label}</Link>
        </Button>
      </div>

      {/* Mobile: bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#00E58B]/30 bg-[#0B0F12]/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
        <Button
          asChild
          className={cn(
            'h-12 w-full touch-manipulation border font-bold',
            purchasesOpen
              ? 'border-[#00FF9C]/40 bg-[#00E58B]/20 text-[#EAFBF4] shadow-[0_0_24px_rgba(0,255,156,0.28)] animate-button-glow-pulse'
              : presaleSoldOut
                ? 'border-[#00FF9C]/35 bg-[#00E58B]/15 text-[#EAFBF4]'
                : 'border-[#1F6F54] bg-[#10161C] text-[#A9CBB9] animate-none'
          )}
        >
          <Link href={href}>{label}</Link>
        </Button>
      </div>
    </>
  )
}
