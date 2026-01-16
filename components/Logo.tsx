'use client'

import Image from 'next/image'
import { useState, useEffect } from 'react'

interface LogoProps {
  className?: string
  width?: number
  height?: number
  priority?: boolean
  src?: string // Optional: specify logo path directly
}

// Update this constant with your actual logo filename
const LOGO_FILENAME = '/logo.gif' // Change this to match your file (e.g., '/banner.gif', '/owltopia-logo.webm', etc.)

export function Logo({ 
  className = '', 
  width, 
  height, 
  priority = false,
  src 
}: LogoProps) {
  const [logoPath, setLogoPath] = useState<string | null>(src || LOGO_FILENAME)
  const [hasError, setHasError] = useState(false)

  const isVideo = logoPath?.endsWith('.webm') || logoPath?.endsWith('.mp4')
  const isGif = logoPath?.endsWith('.gif')

  // Fallback logo if file not found
  if (hasError || !logoPath) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="flex items-center gap-3">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-green-400 to-green-600 animate-pulse" />
            <div className="absolute inset-1 rounded-lg bg-black flex items-center justify-center">
              <span className="text-green-400 text-xl">🦉</span>
            </div>
          </div>
          <span className="text-2xl font-bold text-white">OWLTOPIA</span>
        </div>
      </div>
    )
  }

  if (isVideo) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <video
          autoPlay
          loop
          muted
          playsInline
          className="max-w-full h-auto"
          style={{ width: width || 'auto', height: height || 'auto' }}
          onError={() => setHasError(true)}
        >
          <source src={logoPath} type={logoPath.endsWith('.webm') ? 'video/webm' : 'video/mp4'} />
        </video>
      </div>
    )
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <Image
        src={logoPath}
        alt="OWLTOPIA Logo"
        width={width || 600}
        height={height || 150}
        priority={priority}
        className="max-w-full h-auto"
        style={{ width: 'auto', height: 'auto' }}
        unoptimized={isGif} // GIFs may need unoptimized for animations
        onError={() => setHasError(true)}
      />
    </div>
  )
}
