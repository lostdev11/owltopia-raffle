'use client'

import { useEffect, useState } from 'react'

import type { MintDetailsFormValues } from '@/lib/owl-center/launch-mint-config'
import {
  nextPresetForPhases,
  PARTNER_ALLOWLIST_MAX_PHASES,
  type PartnerAllowlistPhaseFormRow,
} from '@/lib/owl-center/partner-allowlist-phases'
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
      <div className="grid gap-3 border border-[#1A222B] bg-[#0F1419]/60 p-4">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">
          On-chain standard
        </p>
        <p className="text-xs leading-relaxed text-[#9BA8B4]">
          New launches mint as Metaplex Core assets (lighter wallets, Freeze Collection support). Legacy Token
          Metadata is only for special cases.
        </p>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Mint standard
          <select
            value={values.mint_standard}
            onChange={(e) => {
              const next = e.target.value === 'token_metadata' ? 'token_metadata' : 'core'
              onChange({
                ...values,
                mint_standard: next,
                freeze_enabled: next === 'core' ? values.freeze_enabled : false,
              })
            }}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          >
            <option value="core">Metaplex Core (recommended)</option>
            <option value="token_metadata">Token Metadata (legacy)</option>
          </select>
        </label>
        <label className="flex items-start gap-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          <input
            type="checkbox"
            checked={values.freeze_enabled}
            disabled={values.mint_standard !== 'core'}
            onChange={(e) => set('freeze_enabled', e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 touch-manipulation accent-[#00FF9C] disabled:opacity-50"
          />
          <span>
            Freeze Collection at mint
            <span className="mt-1 block normal-case tracking-normal text-[#9BA8B4]">
              Minted NFTs stay non-transferable until you thaw. Checking this freezes them at mint —
              do not press Thaw to freeze. Thaw = unfreeze for trading when mint is done (or you are
              ready for secondary). Requires Metaplex Core.
            </span>
          </span>
        </label>
        {values.freeze_enabled ? (
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Planned thaw / unfreeze (optional)
            <input
              type="datetime-local"
              value={values.unfreeze_date}
              onChange={(e) => set('unfreeze_date', e.target.value)}
              className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
            />
          </label>
        ) : null}
      </div>

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
            ? 'Locked — this rate was set when the collection was deployed on-chain and applies to every NFT.'
            : 'The percent of every secondary marketplace sale paid to your team (default 5%). Written on-chain at deploy — it cannot be changed afterwards.'}
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
          Mint opens
          <input
            type="datetime-local"
            value={values.launch_date}
            onChange={(e) => set('launch_date', e.target.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
          Public phase starts
          <input
            type="datetime-local"
            value={values.public_start}
            onChange={(e) => set('public_start', e.target.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
          <span className="font-mono text-[10px] normal-case tracking-normal text-[#5C6773]">
            Only needed when presale or whitelist phases run first — leave empty to open straight into public mint.
          </span>
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
          checked={values.allowlist_phases.length > 0 || values.wl_enabled}
          onChange={(e) => {
            if (e.target.checked) {
              const seed =
                values.allowlist_phases.length > 0
                  ? values.allowlist_phases
                  : [
                      {
                        key: 'wl',
                        label: 'Whitelist',
                        start: values.wl_start,
                        supply: values.wl_supply,
                        price: values.wl_price,
                      } satisfies PartnerAllowlistPhaseFormRow,
                    ]
              onChange({ ...values, wl_enabled: true, allowlist_phases: seed })
            } else {
              onChange({ ...values, wl_enabled: false, allowlist_phases: [], wl_supply: '', wl_start: '', wl_price: '' })
            }
          }}
          className="h-4 w-4 accent-[#00FF9C]"
        />
        Allowlist phases (Team / OG / WL / …)
      </label>
      {values.allowlist_phases.length > 0 || values.wl_enabled ? (
        <div className="grid gap-4 border border-[#1A222B] bg-[#0F1419]/60 p-4">
          <p className="text-xs leading-relaxed text-[#9BA8B4]">
            Add up to {PARTNER_ALLOWLIST_MAX_PHASES} sequential lists before public. Each phase needs a start time;
            the next phase (or Public start) ends the previous window. After saving, paste wallets per phase in
            Whitelist · Wallets below.
          </p>
          {values.allowlist_phases.map((phase, idx) => (
            <div key={`${phase.key}-${idx}`} className="grid gap-3 border border-[#1A222B] bg-[#0A0E12]/80 p-3 sm:grid-cols-2">
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Label
                <input
                  value={phase.label}
                  onChange={(e) => {
                    const next = [...values.allowlist_phases]
                    next[idx] = { ...phase, label: e.target.value }
                    onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                  }}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Key
                <input
                  value={phase.key}
                  onChange={(e) => {
                    const next = [...values.allowlist_phases]
                    next[idx] = { ...phase, key: e.target.value }
                    onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                  }}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Supply (hard cap)
                <input
                  type="number"
                  min={1}
                  max={supply || undefined}
                  value={phase.supply}
                  onChange={(e) => {
                    const next = [...values.allowlist_phases]
                    next[idx] = { ...phase, supply: e.target.value }
                    onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                  }}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Price (USDC)
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={phase.price}
                  onChange={(e) => {
                    const next = [...values.allowlist_phases]
                    next[idx] = { ...phase, price: e.target.value }
                    onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                  }}
                  placeholder="30"
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
                Phase starts
                <input
                  type="datetime-local"
                  value={phase.start}
                  onChange={(e) => {
                    const next = [...values.allowlist_phases]
                    next[idx] = { ...phase, start: e.target.value }
                    onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                  }}
                  className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  className="font-mono text-[10px] uppercase tracking-widest text-[#FF9C9C] underline-offset-2 hover:underline"
                  onClick={() => {
                    const next = values.allowlist_phases.filter((_, i) => i !== idx)
                    onChange({
                      ...values,
                      allowlist_phases: next,
                      wl_enabled: next.length > 0,
                    })
                  }}
                >
                  Remove phase
                </button>
              </div>
            </div>
          ))}
          {values.allowlist_phases.length < PARTNER_ALLOWLIST_MAX_PHASES ? (
            <button
              type="button"
              className="min-h-[44px] border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C]"
              onClick={() => {
                const preset = nextPresetForPhases(values.allowlist_phases)
                onChange({
                  ...values,
                  wl_enabled: true,
                  allowlist_phases: [
                    ...values.allowlist_phases,
                    { key: preset.key, label: preset.label, start: '', supply: '', price: '' },
                  ],
                })
              }}
            >
              + Add phase (Team / OG / WL …)
            </button>
          ) : null}
          <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">
            Set Public start above so the last allowlist window ends when public mint opens. Phase supply is a hard
            cap (mints stop for that phase when used). Per-phase prices are shown in UI; on-chain Candy Machine price
            is still the collection mint price unless redeployed with separate guards.
          </p>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  )
}

export { defaultMintDetailsFormValues } from '@/lib/owl-center/launch-mint-config'
