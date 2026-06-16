'use client'

import { useEffect, useState } from 'react'

import type { MintDetailsFormValues } from '@/lib/owl-center/launch-mint-config'
import { formatOwlCenterPlatformMintFeeLabel } from '@/lib/owl-center/platform-mint-fee'
import { defaultWalletSplitFormRows } from '@/lib/owl-center/wallet-splits'
import { WalletSplitEditor } from '@/components/owl-center/WalletSplitEditor'

type Props = {
  values: MintDetailsFormValues
  onChange: (next: MintDetailsFormValues) => void
  compact?: boolean
  /** Prefills split rows when empty (e.g. creator wallet from step 1). */
  defaultWallet?: string
  /** When true, royalty cannot be changed (Candy Machine already deployed). */
  royaltiesLocked?: boolean
}

export function MintDetailsConfigFields({
  values,
  onChange,
  compact,
  defaultWallet = '',
  royaltiesLocked = false,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (!defaultWallet.trim()) return
    const wallet = defaultWallet.trim()
    const royaltyEmpty = values.royalty_splits.every((row) => !row.address.trim())
    const mintFundEmpty = values.mint_fund_splits.every((row) => !row.address.trim())
    if (!royaltyEmpty && !mintFundEmpty) return
    onChange({
      ...values,
      royalty_splits: royaltyEmpty ? defaultWalletSplitFormRows(wallet) : values.royalty_splits,
      mint_fund_splits: mintFundEmpty ? defaultWalletSplitFormRows(wallet) : values.mint_fund_splits,
    })
  }, [defaultWallet]) // eslint-disable-line react-hooks/exhaustive-deps -- only prefill when creator wallet appears

  const set = <K extends keyof MintDetailsFormValues>(key: K, v: MintDetailsFormValues[K]) =>
    onChange({ ...values, [key]: v })

  const supply = Number(values.total_supply) || 0

  return (
    <div className="grid gap-4">
      {!compact ? (
        <p className="font-mono text-xs leading-relaxed text-[#9BA8B4]">
          These fields populate the <span className="text-[#E8EEF2]">Mint details</span> block on your collection card
          (supply split, prices, mint opens, per-wallet cap).
        </p>
      ) : null}

      <div className="grid gap-3 border border-[#1A222B] bg-[#0F1419]/60 p-4">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">
          Secondary royalty
        </p>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Creator royalty (% of secondary sales)
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            disabled={royaltiesLocked}
            value={values.royalty_percent}
            onChange={(e) => set('royalty_percent', e.target.value)}
            className="min-h-[44px] w-28 touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8] disabled:opacity-50"
          />
        </label>
        <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">
          {royaltiesLocked
            ? 'Locked — set at Candy Machine deploy. Already-minted NFTs and remaining supply use this on-chain rate.'
            : 'Choose before deploy (default 5%). Baked into the Candy Machine and every NFT minted from it. Cannot be changed after deploy.'}
        </p>
      </div>

      <WalletSplitEditor
        title="Secondary Royalty Split"
        hint="Who receives your secondary royalty % on marketplace sales. Shares must total 100%."
        rows={values.royalty_splits}
        onChange={(royalty_splits) => set('royalty_splits', royalty_splits)}
        disabled={royaltiesLocked}
      />

      <WalletSplitEditor
        title="Mint funds Split"
        hint="Where primary mint proceeds go (before the Owltopia platform fee). Shares must total 100%."
        rows={values.mint_fund_splits}
        onChange={(mint_fund_splits) => set('mint_fund_splits', mint_fund_splits)}
        disabled={royaltiesLocked}
      />

      <div className="grid gap-3 border border-[#1A222B] bg-[#0F1419]/60 p-4">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">
          Per-wallet mint limit
        </p>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Max mints per wallet (each phase)
          <input
            type="number"
            min={1}
            max={50}
            value={values.wallet_mint_limit}
            onChange={(e) => set('wallet_mint_limit', e.target.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">
          Each wallet can mint up to this many NFTs during PUBLIC (and presale / WL when those phases are enabled).
          Enforced on-chain at confirm time.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Public mint price
          <input
            type="number"
            step="any"
            min={0}
            value={values.public_price}
            onChange={(e) => set('public_price', e.target.value)}
            className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Currency
          <select
            value={values.currency}
            onChange={(e) => set('currency', e.target.value as 'SOL' | 'USDC')}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm"
          >
            <option value="SOL">SOL</option>
            <option value="USDC">USDC</option>
          </select>
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Mint opens (kickoff)
          <input
            type="datetime-local"
            value={values.launch_date}
            onChange={(e) => set('launch_date', e.target.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
          Public phase starts (shown as mint opens if set)
          <input
            type="datetime-local"
            value={values.public_start}
            onChange={(e) => set('public_start', e.target.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
      </div>

      <p className="font-mono text-[10px] text-[#5C6773]">{formatOwlCenterPlatformMintFeeLabel()} applies on top of creator price.</p>

      <label className="flex min-h-[44px] touch-manipulation items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        <span>Show Advanced</span>
        <input
          type="checkbox"
          checked={showAdvanced}
          onChange={(e) => setShowAdvanced(e.target.checked)}
          className="h-5 w-9 shrink-0 appearance-none rounded-full border border-[#2A343F] bg-[#0F1419] transition checked:border-[#00FF9C]/50 checked:bg-[#00FF9C]/20"
          role="switch"
          aria-checked={showAdvanced}
        />
      </label>

      {showAdvanced ? (
        <>
      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        <input
          type="checkbox"
          checked={values.presale_enabled}
          onChange={(e) => set('presale_enabled', e.target.checked)}
          className="h-4 w-4 accent-[#00FF9C]"
        />
        Presale phase (prepaid · free mint redemption)
      </label>
      {values.presale_enabled ? (
        <div className="grid gap-4 border border-[#1A222B] bg-[#0F1419]/60 p-4 sm:grid-cols-2">
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Presale supply
            <input
              type="number"
              min={1}
              max={supply || undefined}
              value={values.presale_supply}
              onChange={(e) => set('presale_supply', e.target.value)}
              placeholder={supply ? String(Math.max(1, Math.floor(supply * 0.9))) : '900'}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Presale+ overage pool
            <input
              type="number"
              min={0}
              max={500}
              value={values.presale_overage_supply}
              onChange={(e) => set('presale_overage_supply', e.target.value)}
              placeholder="13"
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
            Presale redemption starts
            <input
              type="datetime-local"
              value={values.presale_start}
              onChange={(e) => set('presale_start', e.target.value)}
              className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
        </div>
      ) : null}

      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        <input
          type="checkbox"
          checked={values.wl_enabled}
          onChange={(e) => set('wl_enabled', e.target.checked)}
          className="h-4 w-4 accent-[#00FF9C]"
        />
        Whitelist phase
      </label>
      {values.wl_enabled ? (
        <div className="grid gap-4 border border-[#1A222B] bg-[#0F1419]/60 p-4 sm:grid-cols-2">
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            WL supply
            <input
              type="number"
              min={1}
              max={supply || undefined}
              value={values.wl_supply}
              onChange={(e) => set('wl_supply', e.target.value)}
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            WL price (USDC)
            <input
              type="number"
              step="any"
              min={0}
              value={values.wl_price}
              onChange={(e) => set('wl_price', e.target.value)}
              placeholder="30"
              className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
            Whitelist phase starts
            <input
              type="datetime-local"
              value={values.wl_start}
              onChange={(e) => set('wl_start', e.target.value)}
              className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  )
}

export { defaultMintDetailsFormValues } from '@/lib/owl-center/launch-mint-config'
