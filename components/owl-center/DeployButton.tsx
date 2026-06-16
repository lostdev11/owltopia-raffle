'use client'

import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function DeployButton({
  className,
  variant = 'primary',
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
  loading?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex min-h-[44px] touch-manipulation items-center justify-center gap-2 px-6 font-bold uppercase tracking-wide transition',
        variant === 'primary' &&
          'border border-[#00FF9C] bg-[#00FF9C] text-[#0B0F14] shadow-[0_0_32px_rgba(0,255,156,0.38)] hover:border-[#00E58B] hover:bg-[#00E58B] disabled:border-[#1A222B] disabled:bg-[#141A21] disabled:text-[#5C6773] disabled:opacity-100 disabled:shadow-none',
        variant === 'ghost' &&
          'border border-[#1A222B] bg-transparent text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#E8EEF2] disabled:opacity-40',
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}
