'use client'

import { cn } from '@/lib/utils'

export type ReadinessChecklistItem = { id: string; label: string; checked: boolean }

export function ReadinessChecklist({
  title,
  items,
  onToggle,
  disabled,
  className,
}: {
  title: string
  items: ReadinessChecklistItem[]
  onToggle: (id: string, next: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const done = items.filter((i) => i.checked).length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#00C97A]">{title}</h3>
        <p className="font-mono text-[10px] text-[#5C6773]">
          {done}/{items.length} · {pct}%
        </p>
      </div>
      <div className="h-1 w-full bg-[#1A222B]">
        <div className="h-1 bg-[#00FF9C]/70 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer touch-manipulation items-start gap-3 text-sm text-[#C5D0D8]">
              <input
                type="checkbox"
                checked={item.checked}
                disabled={disabled}
                onChange={(e) => onToggle(item.id, e.target.checked)}
                className="mt-1 h-[18px] w-[18px] shrink-0 accent-[#00FF9C]"
              />
              <span>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
