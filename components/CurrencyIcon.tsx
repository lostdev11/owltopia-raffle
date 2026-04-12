'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { RaffleCurrency } from '@/lib/types'
import { cn } from '@/lib/utils'

interface CurrencyIconProps {
  currency: 'SOL' | 'USDC' | 'OWL' | 'TRQ'
  className?: string
  size?: number
}

export function CurrencyIcon({ currency, className = '', size = 20 }: CurrencyIconProps) {
  const [usdcImageError, setUsdcImageError] = useState(false)
  const [tryPng, setTryPng] = useState(false)
  const [owlImageError, setOwlImageError] = useState(false)
  const [owlTrySvg, setOwlTrySvg] = useState(false)
  const [trqImageError, setTrqImageError] = useState(false)

  if (currency === 'SOL') {
    const w = size
    const h = Math.max(1, Math.round((size * 311) / 397))
    return (
      // eslint-disable-next-line @next/next/no-img-element -- shared asset with SolanaMark; crisp at any list size
      <img
        src="/solana-mark.svg"
        alt=""
        width={w}
        height={h}
        className={cn('block shrink-0 select-none object-contain object-left', className)}
        draggable={false}
      />
    )
  }

  if (currency === 'OWL') {
    const owlSize = Math.round(size * 1.35)
    const owlSvgFallback = (
      <svg
        width={owlSize}
        height={owlSize}
        viewBox="0 0 32 32"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="16" cy="16" r="14" fill="#D97706" stroke="#B45309" strokeWidth="1.5" />
        <circle cx="12" cy="13" r="2.5" fill="#1C1917" />
        <circle cx="20" cy="13" r="2.5" fill="#1C1917" />
        <path d="M10 20 Q16 24 22 20" stroke="#1C1917" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </svg>
    )

    if (owlImageError) {
      return owlSvgFallback
    }

    const owlImageSrc = owlTrySvg ? '/owl%20token%20v1.svg' : '/owl%20token%20v1.png'
    return (
      <div className={`inline-flex items-center justify-center ${className}`} style={{ width: owlSize, height: owlSize }}>
        <Image
          src={owlImageSrc}
          alt="OWL"
          width={owlSize}
          height={owlSize}
          className="object-contain"
          onError={() => {
            if (!owlTrySvg) {
              setOwlTrySvg(true)
            } else {
              setOwlImageError(true)
            }
          }}
        />
      </div>
    )
  }

  if (currency === 'TRQ') {
    if (trqImageError) {
      return (
        <span className={`inline-flex items-center justify-center rounded-sm bg-muted px-1 font-bold ${className}`} style={{ fontSize: size * 0.45 }} title="TRQ">
          T
        </span>
      )
    }
    return (
      <div className={`inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <Image
          src="/trq-prize.svg"
          alt="TRQ"
          width={size}
          height={size}
          className="object-contain"
          onError={() => setTrqImageError(true)}
        />
      </div>
    )
  }

  if (currency === 'USDC') {
    // Try to use an image file from public folder first, fallback to SVG
    // Place your USDC logo at: public/usdc.svg or public/usdc.png
    if (usdcImageError) {
      // Fallback SVG if image doesn't exist
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 200 200"
          className={className}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="100" cy="100" r="100" fill="#2775CA" />
          <path
            d="M100 75V85M100 115V125M90 85C90 82.8 91.8 81 94 81H106C108.2 81 110 82.8 110 85C110 87.2 108.2 89 106 89H94C91.8 89 90 90.8 90 93C90 95.2 91.8 97 94 97H106C108.2 97 110 98.8 110 101C110 103.2 108.2 105 106 105H94C91.8 105 90 103.2 90 101"
            stroke="white"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <path
            d="M100 85V105"
            stroke="white"
            strokeWidth="8"
            strokeLinecap="round"
          />
        </svg>
      )
    }

    // Try PNG first (since that's what's in public folder), then SVG, then fallback to SVG icon
    const imageSrc = tryPng ? '/usdc.svg' : '/usdc.png'

    return (
      <div className={`inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <Image
          src={imageSrc}
          alt="USDC"
          width={size}
          height={size}
          className="object-contain"
          onError={() => {
            if (!tryPng) {
              // Try SVG if PNG fails
              setTryPng(true)
            } else {
              // Both failed, use fallback SVG icon
              setUsdcImageError(true)
            }
          }}
        />
      </div>
    )
  }

  // Fallback for unknown currency (e.g. legacy data)
  return (
    <span className={className} style={{ fontSize: size ? `${size * 0.6}px` : undefined }} title={currency}>
      $
    </span>
  )
}
