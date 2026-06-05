'use client'

import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function DeployButton({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-[44px] touch-manipulation items-center justify-center px-6 font-bold uppercase tracking-wide transition',
        variant === 'primary' &&
          'border border-[#00FF9C]/40 bg-[#00FF9C]/10 text-[#E8FDF4] shadow-[0_0_24px_rgba(0,255,156,0.18)] hover:bg-[#00FF9C]/18 disabled:opacity-40',
        variant === 'ghost' &&
          'border border-[#1A222B] bg-transparent text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2] disabled:opacity-40',
        className
      )}
      {...props}
    />
  )
}
