'use client'

import type { ReactNode } from 'react'
import { ArrowDownUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Jupiter-style asset / perch selector chip (display-only unless `onClick` is set). */
export function NestSwapAssetChip({
  label,
  sublabel,
  icon,
  className,
  onClick,
  disabled,
  'aria-label': ariaLabel,
}: {
  label: string
  sublabel?: string | null
  icon: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  'aria-label'?: string
}) {
  const inner = (
    <>
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/25"
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
        {sublabel ? (
          <span className="block truncate text-[10px] text-muted-foreground">{sublabel}</span>
        ) : null}
      </span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
    </>
  )

  const chipClass = cn(
    'inline-flex min-h-[44px] max-w-[min(100%,11.5rem)] touch-manipulation items-center gap-2 rounded-full border border-white/10 bg-[#1c2620] px-2.5 py-1.5 text-left transition-colors',
    onClick && !disabled && 'hover:border-emerald-500/35 hover:bg-[#243328]',
    disabled && 'opacity-60',
    className
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={chipClass}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel ?? `Select ${label}`}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={chipClass} aria-label={ariaLabel}>
      {inner}
    </div>
  )
}

export function NestSwapPanel({
  label,
  labelExtra,
  children,
  footer,
  className,
}: {
  label: string
  labelExtra?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.06] bg-[#121a15]/95 p-4 sm:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium tracking-wide">{label}</span>
        {labelExtra}
      </div>
      {children}
      {footer ? <div className="mt-3 border-t border-white/[0.06] pt-3">{footer}</div> : null}
    </div>
  )
}

/** Center swap control overlapping pay / receive panels (Jupiter-style). */
export function NestSwapDirectionControl({ className }: { className?: string }) {
  return (
    <div className={cn('relative z-[2] flex justify-center', className)} aria-hidden>
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-xl border-2 border-[#1a241c] bg-[#1c2620]',
          'shadow-[0_4px_24px_rgba(0,0,0,0.5),0_0_0_4px_rgba(8,14,11,0.95)]'
        )}
      >
        <ArrowDownUp className="h-[18px] w-[18px] text-theme-prime drop-shadow-[0_0_8px_rgba(0,255,136,0.4)]" />
      </div>
    </div>
  )
}

/** Outer card wrapping pay → receive flow. */
export function NestSwapFlowShell({
  payPanel,
  receivePanel,
  payFooter,
  receiveFooter,
  details,
  actions,
}: {
  payPanel: ReactNode
  receivePanel: ReactNode
  payFooter?: ReactNode
  receiveFooter?: ReactNode
  details?: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="rounded-[1.35rem] border border-emerald-500/20 bg-[#0c100e]/90 p-1.5 sm:p-2 shadow-[0_8px_40px_rgba(0,0,0,0.45),0_0_60px_rgba(0,255,136,0.06)]">
      <NestSwapPanel label="You pay" footer={payFooter}>
        {payPanel}
      </NestSwapPanel>

      <NestSwapDirectionControl className="-my-4" />

      <NestSwapPanel label="You receive" footer={receiveFooter}>
        {receivePanel}
      </NestSwapPanel>

      {details ? (
        <div className="mx-1 mt-3 rounded-xl border border-white/[0.05] bg-black/25 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
          {details}
        </div>
      ) : null}

      <div className="mt-4 space-y-3 px-0.5 pb-0.5">{actions}</div>
    </div>
  )
}
