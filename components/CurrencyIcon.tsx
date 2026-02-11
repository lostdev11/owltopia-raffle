'use client'

import { useId, useState } from 'react'
import Image from 'next/image'

interface CurrencyIconProps {
  currency: 'SOL' | 'USDC' | 'OWL'
  className?: string
  size?: number
}

export function CurrencyIcon({ currency, className = '', size = 20 }: CurrencyIconProps) {
  const gradientId = useId()
  const [usdcImageError, setUsdcImageError] = useState(false)
  const [tryPng, setTryPng] = useState(false)
  const [owlImageError, setOwlImageError] = useState(false)
  const [owlTrySvg, setOwlTrySvg] = useState(false)

  if (currency === 'SOL') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 397.7 311.7"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={gradientId} x1="360.879" y1="351.455" x2="141.213" y2="69.8367" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#9945FF" />
            <stop offset="1" stopColor="#14F195" />
          </linearGradient>
        </defs>
        <path
          d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
          fill={`url(#${gradientId})`}
        />
        <path
          d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
          fill={`url(#${gradientId})`}
        />
        <path
          d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
          fill={`url(#${gradientId})`}
        />
      </svg>
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

  return null
}
