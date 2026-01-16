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
    default:
      return '#00ff88'
  }
}

/**
 * Get theme accent glow color (rgba)
 */
export function getThemeAccentGlow(theme: ThemeAccent): string {
  switch (theme) {
    case 'prime':
      return 'rgba(0, 255, 136, 0.5)'
    case 'midnight':
      return 'rgba(0, 212, 255, 0.5)'
    case 'dawn':
      return 'rgba(168, 255, 0, 0.5)'
    default:
      return 'rgba(0, 255, 136, 0.5)'
  }
}

/**
 * Get theme accent border style object
 */
export function getThemeAccentBorderStyle(theme: ThemeAccent): { borderColor: string; boxShadow: string } {
  const color = getThemeAccentColor(theme)
  const glow = getThemeAccentGlow(theme)
  
  return {
    borderColor: color,
    boxShadow: `0 0 20px ${glow}`,
  }
}

/**
 * Get theme accent CSS classes (base classes only, use style for colors)
 */
export function getThemeAccentClasses(theme: ThemeAccent, baseClasses?: string): string {
  return cn(baseClasses, 'transition-all duration-300 border-2')
}
