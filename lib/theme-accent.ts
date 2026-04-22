import type { ThemeAccent } from './types'
import { cn } from '@/lib/utils'

/**
 * Get theme accent color for text/background
 */
export function getThemeAccentColor(theme: ThemeAccent): string {
  switch (theme) {
    case 'prime':
      return '#00ff88'
    case 'midnight':
      return '#00d4ff'
    case 'dawn':
      return '#a8ff00'
    case 'ember':
      return '#f97316'
    case 'violet':
      return '#a855f7'
    case 'coral':
      return '#f43f5e'
    default:
      return '#00ff88'
  }
}

/** Space-separated R G B for `rgb(var(--entered-rgb) / a)` in CSS */
export function getThemeAccentRgbChannels(theme: ThemeAccent): string {
  switch (theme) {
    case 'prime':
      return '0 255 136'
    case 'midnight':
      return '0 212 255'
    case 'dawn':
      return '168 255 0'
    case 'ember':
      return '249 115 22'
    case 'violet':
      return '168 85 247'
    case 'coral':
      return '244 63 94'
    default:
      return '0 255 136'
  }
}

/**
 * Soft multi-layer outer glow (follows the element's border-radius).
 * Single tight `0 0 20px` reads as a rectangular ring; layered low-alpha blurs read rounder and gentler.
 */
export function softOuterGlowFromChannels(channels: string): string {
  return [
    `0 0 10px rgb(${channels} / 0.2)`,
    `0 0 26px rgb(${channels} / 0.12)`,
    `0 0 48px rgb(${channels} / 0.07)`,
    `0 0 72px rgb(${channels} / 0.035)`,
  ].join(', ')
}

/**
 * Even softer ambient halo for the partner featured marquee: lower peak alpha and
 * wider falloff so saturated accents (e.g. prime green) read as light in the scene,
 * not a thick outer stroke against the page background.
 */
export function partnerStripOuterGlowFromChannels(channels: string): string {
  return [
    `0 0 16px rgb(${channels} / 0.09)`,
    `0 0 36px rgb(${channels} / 0.055)`,
    `0 0 64px rgb(${channels} / 0.032)`,
    `0 0 100px rgb(${channels} / 0.018)`,
  ].join(', ')
}

/**
 * Get theme accent border style object
 */
export function getThemeAccentBorderStyle(theme: ThemeAccent): { borderColor: string; boxShadow: string } {
  const color = getThemeAccentColor(theme)
  return {
    borderColor: color,
    boxShadow: softOuterGlowFromChannels(getThemeAccentRgbChannels(theme)),
  }
}

/**
 * Get theme accent CSS classes (base classes only, use style for colors)
 */
export function getThemeAccentClasses(theme: ThemeAccent, baseClasses?: string): string {
  return cn(baseClasses, 'transition-all duration-300 border-2')
}
