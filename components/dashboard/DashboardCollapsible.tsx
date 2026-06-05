'use client'

import { ChevronDown } from 'lucide-react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function DashboardCollapsible({
  title,
  count,
  readyLabel,
  defaultOpen = false,
  description,
  children,
}: {
  title: string
  count?: number
  readyLabel?: string | null
  defaultOpen?: boolean
  description?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)

  useLayoutEffect(() => {
    if (defaultOpen && ref.current) ref.current.open = true
  }, [defaultOpen])

  return (
    <details
      ref={ref}
      className="group rounded-lg border border-border/50 bg-background/40 open:border-border/60 open:bg-muted/10"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 touch-manipulation min-h-[44px] sm:px-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-foreground">
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden
          />
          <span className="truncate">{title}</span>
          {count != null ? (
            <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">({count})</span>
          ) : null}
        </span>
        {readyLabel ? (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-500 ring-1 ring-emerald-500/25">
            {readyLabel}
          </span>
        ) : null}
      </summary>
      <div className="space-y-2 border-t border-border/40 px-3 pb-3 pt-3 sm:px-4">
        {description ? <p className="text-xs text-muted-foreground leading-relaxed">{description}</p> : null}
        {children}
      </div>
    </details>
  )
}
