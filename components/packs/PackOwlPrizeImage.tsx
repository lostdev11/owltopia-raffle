'use client'

import Image from 'next/image'
import { PACK_OWL_PRIZE_IMAGE } from '@/lib/packs/media'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  size?: number
  priority?: boolean
}

/** $OWL pack prize artwork (gold coin / cube owl). */
export function PackOwlPrizeImage({ className, size = 280, priority = false }: Props) {
  return (
    <Image
      src={PACK_OWL_PRIZE_IMAGE}
      alt="$OWL prize"
      width={size}
      height={size}
      className={cn('h-full w-full object-contain', className)}
      priority={priority}
    />
  )
}
