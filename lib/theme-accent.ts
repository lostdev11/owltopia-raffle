import type { CSSProperties } from 'react'
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

/**
 * Comma-separated RGB for `rgb(var(--glow-rgb) / α)` (rounded drop-shadow halo).
 */
export function getThemeAccentGlowRgb(theme: ThemeAccent): string {
  switch (theme) {
    case 'prime':
      return '0, 255, 136'
    case 'midnight':
      return '0, 212, 255'
    case 'dawn':
      return '168, 255, 0'
    case 'ember':
      return '249, 115, 22'
    case 'violet':
      return '168, 85, 247'
    case 'coral':
      return '244, 63, 94'
    default:
      return '0, 255, 136'
  }
}

/**
 * Border color + CSS variable for `.raffle-card-rounded-halo` (filter drop-shadow).
 * Drop-shadow follows the painted rounded silhouette; box-shadow glow often gaps at corners.
 */
export function getThemeAccentSurfaceStyle(theme: ThemeAccent): CSSProperties {
  return {
    borderColor: getThemeAccentColor(theme),
    ['--glow-rgb' as string]: getThemeAccentGlowRgb(theme),
  }
}

/** Pending / future / ended raffle card surfaces (same halo pattern as theme). */
export function raffleStateSurfaceStyle(
  state: 'pending' | 'future' | 'past'
): CSSProperties {
  switch (state) {
    case 'pending':
      return {
        borderColor: '#f59e0b',
        ['--glow-rgb' as string]: '245, 158, 11',
      }
    case 'future':
      return {
        borderColor: '#ef4444',
        ['--glow-rgb' as string]: '239, 68, 68',
      }
    case 'past':
      return {
        borderColor: '#3b82f6',
        ['--glow-rgb' as string]: '59, 130, 246',
      }
  }
}

/**
 * Get theme accent CSS classes (base classes only; pair with getThemeAccentSurfaceStyle).
 * @param withHalo — set false for winner / golden treatment so filter does not fight animations.
 */
export function getThemeAccentClasses(
  theme: ThemeAccent,
  baseClasses?: string,
  options?: { withHalo?: boolean }
): string {
  return cn(
    baseClasses,
    'transition-all duration-300 border-2',
    options?.withHalo === false ? null : 'raffle-card-rounded-halo'
  )
}
