import Image from 'next/image'
import { cn } from '@/lib/utils'

/** Neon owl-in-cube mark on nesting stake cards. */
export const NESTING_PERCH_LOGO_SRC = '/images/nesting-owl-cube-mark.png'

/** Small corner brand mark beside stake card CTAs. */
export function NestingPerchLogoMark({ className }: { className?: string }) {
  return (
    <Image
      src={NESTING_PERCH_LOGO_SRC}
      alt=""
      width={40}
      height={40}
      sizes="40px"
      aria-hidden
      className={cn(
        'h-9 w-9 shrink-0 object-contain select-none sm:h-10 sm:w-10',
        'opacity-[0.32] mix-blend-screen',
        className
      )}
    />
  )
}
