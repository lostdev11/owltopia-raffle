'use client'

import { useEffect, useState } from 'react'

import { applyMintOpensDate, resolveFormMintOpensFromFirstPhase, type MintDetailsFormValues } from '@/lib/owl-center/launch-mint-config'
import {
  isOwlCenterWalletMintUnlimited,
  OWL_CENTER_MAX_LAUNCH_SUPPLY,
  OWL_CENTER_MAX_WALLET_MINT_LIMIT,
} from '@/lib/owl-center/launch-limits'
import { datetimeLocalToIso, formatMintDate } from '@/lib/owl-center/phase-schedule'
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
  /** Show editable total supply (creator Manage collection). */
  showSupplyField?: boolean
  /** When true, total supply + mint standard/freeze cannot change. */
  supplyConfigLocked?: boolean
}

export function MintDetailsConfigFields({
  values,
  onChange,
  compact,
  defaultWallet = '',
  royaltiesLocked = false,
  showSupplyField = false,
  supplyConfigLocked = false,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(
    () => values.presale_enabled || values.wl_enabled || values.allowlist_phases.length > 0
  )

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

  const simplePublic =
    !values.presale_enabled && !values.wl_enabled && values.allowlist_phases.length === 0
  const setMintOpens = (raw: string) => onChange(applyMintOpensDate(values, raw))
  const autoMintOpensLocal = simplePublic ? '' : resolveFormMintOpensFromFirstPhase(values)
  const mintOpensPreview = (simplePublic ? values.launch_date : autoMintOpensLocal).trim()
    ? formatMintDate(
        datetimeLocalToIso(simplePublic ? values.launch_date : autoMintOpensLocal)
      )
    : null

  const supply = Number(values.total_supply) || 0
  const standardLocked = royaltiesLocked || supplyConfigLocked
  const publicUnlimited = isOwlCenterWalletMintUnlimited(Number(values.wallet_mint_limit), supply)
  const unlimitedSupplyCap = Math.min(
    OWL_CENTER_MAX_WALLET_MINT_LIMIT,
    Math.max(1, Math.floor(supply) || OWL_CENTER_MAX_WALLET_MINT_LIMIT)
  )

  const setPublicUnlimited = (enabled: boolean) => {
    if (enabled) {
      onChange({ ...values, wallet_mint_limit: String(unlimitedSupplyCap) })
      return
    }
    const current = Math.floor(Number(values.wallet_mint_limit))
    const next =
      Number.isFinite(current) && current >= 1 && current < unlimitedSupplyCap
        ? String(current)
        : '5'
    onChange({ ...values, wallet_mint_limit: next })
  }

  const setTotalSupply = (raw: string) => {
    const nextSupply = Math.floor(Number(raw))
    if (
      publicUnlimited &&
      Number.isFinite(nextSupply) &&
      nextSupply >= 1 &&
      nextSupply <= OWL_CENTER_MAX_LAUNCH_SUPPLY
    ) {
      onChange({
        ...values,
        total_supply: raw,
        wallet_mint_limit: String(Math.min(OWL_CENTER_MAX_WALLET_MINT_LIMIT, nextSupply)),
      })
      return
    }
    set('total_supply', raw)
  }

  return (
    <div className="grid gap-4">
      {showSupplyField ? (
        <div className="grid gap-3 border border-[#1A222B] bg-[#0F1419]/60 p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">
            Collection supply
          </p>
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Total supply (how many NFTs)
            <input
              type="number"
              min={1}
              max={OWL_CENTER_MAX_LAUNCH_SUPPLY}
              disabled={supplyConfigLocked}
              value={values.total_supply}
              onChange={(e) => setTotalSupply(e.target.value)}
              className="min-h-[44px] w-36 touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8] disabled:opacity-50"
            />
          </label>
          <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">
            {supplyConfigLocked
              ? 'Locked after Candy Machine deploy (or once mints exist).'
              : 'You can change this until the Candy Machine is deployed. Keep it aligned with your staged art count.'}
          </p>
        </div>
      ) : null}

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
            disabled={standardLocked}
            onChange={(e) => {
              const next = e.target.value === 'token_metadata' ? 'token_metadata' : 'core'
              onChange({
                ...values,
                mint_standard: next,
                freeze_enabled: next === 'core' ? values.freeze_enabled : false,
              })
            }}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8] disabled:opacity-50"
          >
            <option value="core">Metaplex Core (recommended)</option>
            <option value="token_metadata">Token Metadata (legacy)</option>
          </select>
        </label>
        <p className="text-xs leading-relaxed text-[#9BA8B4]">
          {values.mint_standard === 'core'
            ? 'Core: your creator wallet becomes on-chain update authority after deploy (Orbis verify). Owltopia keeps an UpdateDelegate for reveal / refresh / thaw.'
            : 'Token Metadata: Owltopia keeps update authority in v1 — contact support for marketplace verify (no self-serve claim).'}
        </p>
        <label className="flex items-start gap-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          <input
            type="checkbox"
            checked={values.freeze_enabled}
            disabled={standardLocked || values.mint_standard !== 'core'}
            onChange={(e) => set('freeze_enabled', e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 touch-manipulation accent-[#00FF9C] disabled:opacity-50"
          />
          <span>
            Lock NFTs until trading
            <span className="mt-1 block normal-case tracking-normal text-[#9BA8B4]">
              Minted NFTs cannot be transferred or listed until you later tap{' '}
              <span className="text-[#E8EEF2]">Enable trading</span> on Manage collection (after sell-out).
              Checking this locks at mint — it does not unlock. Requires Metaplex Core.
            </span>
          </span>
        </label>
        {values.freeze_enabled ? (
          <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Planned unlock date (optional)
            <input
              type="datetime-local"
              value={values.unfreeze_date}
              disabled={standardLocked}
              onChange={(e) => set('unfreeze_date', e.target.value)}
              className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8] disabled:opacity-50"
            />
            <span className="font-mono text-[10px] normal-case tracking-normal text-[#5C6773]">
              Target / reminder only — does not auto-unlock. Unlock is still Enable trading after the
              collection sells out.
            </span>
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
          Public per-wallet mint limit
        </p>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 touch-manipulation font-mono text-[11px] uppercase tracking-widest text-[#9BA8B4]">
          <input
            type="checkbox"
            checked={publicUnlimited}
            onChange={(e) => setPublicUnlimited(e.target.checked)}
            className="h-4 w-4 accent-[#00C97A]"
          />
          Unlimited (one wallet can mint the whole collection)
        </label>
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Max mints per wallet (public phase)
          <input
            type="number"
            min={1}
            max={OWL_CENTER_MAX_WALLET_MINT_LIMIT}
            disabled={publicUnlimited}
            value={values.wallet_mint_limit}
            onChange={(e) => set('wallet_mint_limit', e.target.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8] disabled:opacity-50"
          />
        </label>
        <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">
          {publicUnlimited
            ? 'Unlimited sets the on-chain Candy Guard mintLimit to your collection supply — a wallet can mint until the drop sells out (still capped by remaining supply).'
            : 'Max NFTs a wallet can mint during PUBLIC only — not how many NFTs it already holds. Allowlist phases set their own caps below (Show Advanced); those stack (WL 2 + public 5 = up to 7 total). Enforced on-chain via Candy Guard mintLimit — changing this after deploy updates the on-chain cap when you save.'}
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
        {simplePublic ? (
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
          Mint opens
          <input
            type="datetime-local"
            value={values.launch_date}
            onChange={(e) => setMintOpens(e.target.value)}
            onInput={(e) => setMintOpens(e.currentTarget.value)}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
          {mintOpensPreview ? (
            <span className="font-mono text-[10px] normal-case tracking-normal text-[#00C97A]">
              Saves as {mintOpensPreview}
            </span>
          ) : null}
        </label>
        ) : (
        <div className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
          <span>Mint opens</span>
          <p className="normal-case tracking-normal text-[#9BA8B4]">
            Auto-set when the first allowlist or presale phase starts — no separate date to enter.
          </p>
          {mintOpensPreview ? (
            <span className="font-mono text-[10px] normal-case tracking-normal text-[#00C97A]">
              Opens {mintOpensPreview} (from first phase)
            </span>
          ) : (
            <span className="font-mono text-[10px] normal-case tracking-normal text-[#5C6773]">
              Set a Phase starts time below to open the mint.
            </span>
          )}
        </div>
        )}
        {simplePublic ? null : (
        <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
          Public phase starts
          <input
            type="datetime-local"
            value={values.public_start}
            onChange={(e) => {
              const public_start = e.target.value
              onChange({ ...values, public_start })
            }}
            className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
          />
          <span className="font-mono text-[10px] normal-case tracking-normal text-[#5C6773]">
            When public mint begins after allowlist or presale. Must be at or after the first phase start.
          </span>
        </label>
        )}
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
          onChange={(e) => {
            set('presale_enabled', e.target.checked)
            if (e.target.checked) setShowAdvanced(true)
          }}
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
                        start: values.wl_start || values.launch_date,
                        supply: values.wl_supply,
                        price: values.wl_price,
                        price_currency: 'USDC',
                        wallet_mint_limit: values.wallet_mint_limit || '1',
                      } satisfies PartnerAllowlistPhaseFormRow,
                    ]
              onChange({ ...values, wl_enabled: true, allowlist_phases: seed })
              setShowAdvanced(true)
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
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
                Phase name
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
                Currency
                <select
                  value={phase.price_currency === 'SOL' ? 'SOL' : 'USDC'}
                  onChange={(e) => {
                    const next = [...values.allowlist_phases]
                    next[idx] = {
                      ...phase,
                      price_currency: e.target.value === 'SOL' ? 'SOL' : 'USDC',
                    }
                    onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                  }}
                  className="min-h-[44px] touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                >
                  <option value="USDC">USDC (pay in SOL · live rate)</option>
                  <option value="SOL">SOL (fixed)</option>
                </select>
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                {phase.price_currency === 'SOL' ? 'Price (SOL)' : 'Price (USDC)'}
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
                  placeholder={phase.price_currency === 'SOL' ? '0.12' : '9'}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Max per wallet
                <input
                  type="number"
                  min={1}
                  max={OWL_CENTER_MAX_WALLET_MINT_LIMIT}
                  value={phase.wallet_mint_limit ?? ''}
                  onChange={(e) => {
                    const next = [...values.allowlist_phases]
                    next[idx] = { ...phase, wallet_mint_limit: e.target.value }
                    onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                  }}
                  placeholder={values.wallet_mint_limit || '1'}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                />
              </label>
              <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773] sm:col-span-2">
                Free Mint Token (SPL mint · optional)
                <input
                  value={phase.redeem_token_mint ?? ''}
                  onChange={(e) => {
                    const next = [...values.allowlist_phases]
                    const mint = e.target.value.trim()
                    next[idx] = {
                      ...phase,
                      redeem_token_mint: e.target.value,
                      label:
                        mint.length >= 32 && (!phase.label || phase.label === 'Whitelist')
                          ? 'Free Mint Token'
                          : phase.label,
                      price: mint.length >= 32 && !phase.price ? '0' : phase.price,
                    }
                    onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                  }}
                  placeholder="Partner Free Mint Token mint address"
                  spellCheck={false}
                  className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8]"
                />
              </label>
              {(phase.redeem_token_mint ?? '').trim().length >= 32 ? (
                <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                  Tokens burned per NFT
                  <input
                    type="number"
                    min={1}
                    value={phase.redeem_token_amount ?? '1'}
                    onChange={(e) => {
                      const next = [...values.allowlist_phases]
                      next[idx] = { ...phase, redeem_token_amount: e.target.value }
                      onChange({ ...values, allowlist_phases: next, wl_enabled: true })
                    }}
                    placeholder="1"
                    className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-sm text-[#F4FBF8]"
                  />
                </label>
              ) : null}
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
                    {
                      key: preset.key,
                      label: preset.label,
                      start: '',
                      supply: '',
                      price: '',
                      price_currency: 'USDC',
                      wallet_mint_limit: values.wallet_mint_limit || '1',
                    },
                  ],
                })
              }}
            >
              + Add phase (Team / OG / WL …)
            </button>
          ) : null}
          <p className="font-mono text-[10px] leading-relaxed text-[#5C6773]">
            Set Public start above so the last allowlist window ends when public mint opens. Mint opens
            automatically at the earliest Phase starts below. Phase supply is a hard
            cap (mints stop for that phase when used). Max per wallet defaults Spots per wallet when you paste lists
            below; leave blank to inherit the public per-wallet limit. Price currency: USDC is re-quoted to SOL as the
            market moves; SOL stays fixed on-chain (same as public SOL mint). Free Mint Token: set the SPL mint to
            require burning that ticket on mint (no wallet paste list needed for that phase); use price 0.
          </p>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  )
}

export { defaultMintDetailsFormValues } from '@/lib/owl-center/launch-mint-config'
