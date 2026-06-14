'use client'

import { useMemo, useState } from 'react'

import { buildOwlCenterHubCardImageChain } from '@/lib/owl-center/hub-card-image-url'

export function HubCardCoverImage({
  imageUrl,
  alt = '',
  fit = 'contain',
  className,
}: {
  imageUrl: string | null | undefined
  alt?: string
  fit?: 'contain' | 'cover'
  className?: string
}) {
  const chain = useMemo(() => buildOwlCenterHubCardImageChain(imageUrl), [imageUrl])
  const [idx, setIdx] = useState(0)
  const src = chain[Math.min(idx, chain.length - 1)] ?? chain[0]

  return (
    // eslint-disable-next-line @next/next/no-img-element -- proxy + gateway fallbacks need onError chain
    <img
      key={`${idx}:${src}`}
      src={src}
      alt={alt}
      className={[
        'absolute inset-0 h-full w-full',
        fit === 'cover' ? 'object-cover' : 'object-contain p-6',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      loading="lazy"
      decoding="async"
      onError={() => {
        setIdx((i) => (i + 1 < chain.length ? i + 1 : i))
      }}
    />
  )
}
