'use client'

import { useState, useCallback, type ReactNode, type SyntheticEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const SHELL: Record<string, string> = {
  default: 'rounded-lg border border-border bg-card shadow-sm',
  accent: 'rounded-lg border border-green-500/30 bg-green-500/5 shadow-sm',
  amber: 'rounded-lg border border-amber-500/25 bg-amber-500/[0.04] shadow-sm',
  'amber-soft': 'rounded-lg border border-amber-500/20 bg-amber-500/[0.03] shadow-sm',
  green: 'rounded-lg border border-green-500/20 bg-green-500/[0.03] shadow-sm',
  violet: 'rounded-lg border border-violet-500/20 bg-violet-500/[0.03] shadow-sm',
  teal: 'rounded-lg border border-teal-500/25 bg-teal-500/[0.04] shadow-sm',
}

const BORDER_T: Record<string, string> = {
  default: 'border-border/60',
  accent: 'border-green-500/20',
  amber: 'border-amber-500/20',
  'amber-soft': 'border-amber-500/20',
  green: 'border-green-500/20',
  violet: 'border-violet-500/20',
  teal: 'border-teal-500/20',
}

export type OwlVisionDisclosureVariant = keyof typeof SHELL

export function OwlVisionDisclosure({
  title,
  children,
  defaultOpen = false,
  variant = 'default',
  className,
  contentClassName,
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  variant?: OwlVisionDisclosureVariant
  className?: string
  contentClassName?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const onToggle = useCallback((e: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(e.currentTarget.open)
  }, [])
  const shell = SHELL[variant] ?? SHELL.default
  const borderT = BORDER_T[variant] ?? BORDER_T.default
  return (
    <details className={cn(shell, className)} open={open} onToggle={onToggle}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-6 touch-manipulation min-h-[44px] [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1 text-left">{title}</div>
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
          aria-hidden
        />
      </summary>
      <div className={cn('border-t px-4 pb-5 pt-4 sm:px-6', borderT, contentClassName)}>{children}</div>
    </details>
  )
}
