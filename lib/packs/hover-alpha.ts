'use client'

import { useEffect, useState } from 'react'

/**
 * VP9 WebM alpha is reliable in Chromium/Firefox, not in iOS / iPadOS /
 * in-app WebKit (Phantom, Safari). Those get an animated WebP instead.
 */
export function browserSupportsWebmAlpha(): boolean {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS/i.test(ua)) return false
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return false
  const vendor = navigator.vendor || ''
  if (/Apple/i.test(vendor) && /Safari/i.test(ua) && !/Chrome|Chromium|Android/i.test(ua)) {
    return false
  }
  const probe = document.createElement('video')
  return probe.canPlayType('video/webm; codecs="vp9"') !== ''
}

export function useWebmHoverAlpha(): boolean {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    setOk(browserSupportsWebmAlpha())
  }, [])
  return ok
}
