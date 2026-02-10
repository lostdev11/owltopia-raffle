'use client'

import { useId, useState } from 'react'
import Image from 'next/image'
import type { RaffleCurrency } from '@/lib/types'

interface CurrencyIconProps {
  currency: RaffleCurrency
  className?: string
  size?: number
}

export function CurrencyIcon({ currency, className = '', size = 20 }: CurrencyIconProps) {
  const gradientId = useId()
  const [usdcImageError, setUsdcImageError] = useState(false)
  const [tryPng, setTryPng] = useState(false)
  
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
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" fill="#8B5CF6" stroke="#A78BFA" strokeWidth="1" />
        <circle cx="9" cy="10" r="2" fill="white" />
        <circle cx="15" cy="10" r="2" fill="white" />
        <path d="M8 15c0 0 1.5 2 4 2s4-2 4-2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
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
