'use client'

import { Plus, X } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import {
  MAX_WALLET_SPLITS,
  sumWalletSplitShares,
  type WalletSplitFormRow,
} from '@/lib/owl-center/wallet-splits'

type Props = {
  title: string
  hint?: string
  rows: WalletSplitFormRow[]
  onChange: (rows: WalletSplitFormRow[]) => void
  disabled?: boolean
}

export function WalletSplitEditor({ title, hint, rows, onChange, disabled = false }: Props) {
  const total = sumWalletSplitShares(rows)
  const totalOk = Math.abs(total - 100) <= 0.01

  function updateRow(index: number, patch: Partial<WalletSplitFormRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addRow() {
    if (rows.length >= MAX_WALLET_SPLITS) return
    onChange([...rows, { share: '', address: '' }])
  }

  function removeRow(index: number) {
    if (rows.length <= 1) return
    onChange(rows.filter((_, i) => i !== index))
  }

  return (
    <div className="grid gap-3 border border-[#1A222B] bg-[#0F1419]/60 p-4">
      <p className="font-mono text-sm font-semibold tracking-wide text-[#F4FBF8]">{title}</p>
      {hint ? <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">{hint}</p> : null}

      <div className="grid gap-3">
        {rows.map((row, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[minmax(5rem,6rem)_1fr_auto] sm:items-end">
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              Share
              <div className="flex min-h-[44px] items-center gap-1 border border-[#1A222B] bg-[#0F1419] px-2 touch-manipulation">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  disabled={disabled}
                  value={row.share}
                  onChange={(e) => updateRow(index, { share: e.target.value })}
                  className="w-full min-w-0 bg-transparent py-2 text-sm text-[#F4FBF8] outline-none disabled:opacity-50"
                  inputMode="decimal"
                />
                <span className="shrink-0 text-sm text-[#5C6773]">%</span>
              </div>
            </label>
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              Address
              <input
                type="text"
                disabled={disabled}
                value={row.address}
                onChange={(e) => updateRow(index, { address: e.target.value })}
                placeholder="Solana wallet address"
                className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8] disabled:opacity-50"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {rows.length > 1 && !disabled ? (
              <button
                type="button"
                onClick={() => removeRow(index)}
                className="flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center self-end border border-[#1A222B] text-[#7D8A93] hover:border-[#FF9C9C]/40 hover:text-[#FF9C9C]"
                aria-label={`Remove split ${index + 1}`}
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <span className="hidden sm:block" aria-hidden />
            )}
          </div>
        ))}
      </div>

      {!totalOk ? (
        <p className="font-mono text-[10px] text-[#FF9C9C]">
          Shares must total 100% (currently {total.toFixed(1)}%).
        </p>
      ) : null}

      {!disabled ? (
        <DeployButton
          type="button"
          variant="ghost"
          className="w-full justify-center gap-2 border-[#2A343F]"
          disabled={rows.length >= MAX_WALLET_SPLITS}
          onClick={addRow}
        >
          <Plus className="h-4 w-4" />
          Add split
        </DeployButton>
      ) : null}
    </div>
  )
}
