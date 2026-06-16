'use client'

import { useEffect, useMemo } from 'react'

export function parseMintQuantityText(text: string, max: number): number {
  const trimmed = text.trim()
  if (!trimmed) return 1
  const n = parseInt(trimmed, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(max, n)
}

export function MintQuantityInput({
  max,
  value,
  onChange,
  disabled,
  className,
}: {
  max: number
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}) {
  const parsed = useMemo(() => parseMintQuantityText(value, max), [value, max])

  useEffect(() => {
    const n = parseInt(value.trim(), 10)
    if (Number.isFinite(n) && n > max) {
      onChange(String(max))
    }
  }, [max, onChange, value])

  return (
    <label
      className={
        className ??
        'grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]'
      }
    >
      Quantity
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={value}
        disabled={disabled}
        aria-label="Mint quantity"
        aria-valuemin={1}
        aria-valuemax={max}
        aria-valuenow={parsed}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        onBlur={() => {
          if (!value.trim()) {
            onChange('1')
            return
          }
          onChange(String(parseMintQuantityText(value, max)))
        }}
        className="min-h-[44px] w-24 touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
      />
    </label>
  )
}
