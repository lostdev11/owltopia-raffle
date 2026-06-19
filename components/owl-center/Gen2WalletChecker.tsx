'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { MintAllocationBar } from '@/components/owl-center/MintAllocationBar'
import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import { reasonLabel } from '@/lib/owl-center/mint-check-reason-label'
import { owlCenterActivePhaseTag } from '@/lib/owl-center/phase-display'
import type { Gen2MintCheckPhasePreview, Gen2MintCheckResponse } from '@/lib/owl-center/types'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { cn } from '@/lib/utils'

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

type PhaseStatus = 'mint_now' | 'eligible' | 'ineligible'

function phaseStatus(p: Gen2MintCheckPhasePreview): PhaseStatus {
  if (p.is_active && p.is_eligible && p.max_mintable > 0) return 'mint_now'
  if (p.reserved_mints > 0 || (p.is_eligible && p.max_mintable > 0)) return 'eligible'
  return 'ineligible'
}

function phaseStatusLabel(p: Gen2MintCheckPhasePreview, presaleSoldOut: boolean): string {
  const status = phaseStatus(p)
  if (status === 'mint_now') return `Mint now · up to ${p.max_mintable}`
  if (status === 'eligible') {
    const n = p.reserved_mints > 0 ? p.reserved_mints : p.max_mintable
    return `Eligible · ${n} spot${n === 1 ? '' : 's'}${p.is_active ? '' : ' when phase opens'}`
  }
  const tag = p.is_active ? owlCenterActivePhaseTag(p.phase, { presaleSoldOut }) : null
  return tag ? `Live · ${tag}` : 'Not eligible'
}

export function Gen2WalletChecker({ initialWallet = '' }: { initialWallet?: string }) {
  const [input, setInput] = useState(initialWallet)
  const [wallet, setWallet] = useState<string | null>(null)
  const [check, setCheck] = useState<Gen2MintCheckResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const reqId = useRef(0)

  const runCheck = useCallback(async (raw: string) => {
    const normalized = normalizeSolanaWalletAddress(raw)
    if (!normalized) {
      setErr('Enter a valid Solana wallet address.')
      setCheck(null)
      setWallet(null)
      return
    }

    const id = ++reqId.current
    setLoading(true)
    setErr(null)
    setWallet(normalized)
    try {
      const res = await fetch(`/api/owl-center/gen2/mint-check?wallet=${encodeURIComponent(normalized)}`, {
        cache: 'no-store',
      })
      if (id !== reqId.current) return
      if (res.status === 429) {
        setErr('Too many checks — wait a moment and try again.')
        setCheck(null)
        return
      }
      if (!res.ok) {
        setErr('Could not check this wallet right now. Try again shortly.')
        setCheck(null)
        return
      }
      const data = (await res.json()) as Gen2MintCheckResponse
      if (id !== reqId.current) return
      setCheck(data)
    } catch {
      if (id !== reqId.current) return
      setErr('Network error — check your connection (WiFi / mobile data) and try again.')
      setCheck(null)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialWallet && normalizeSolanaWalletAddress(initialWallet)) {
      void runCheck(initialWallet)
    }
    // Run once for a prefilled (e.g. shared link) wallet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const eligiblePhases = check?.phases.filter((p) => phaseStatus(p) !== 'ineligible') ?? []

  return (
    <CommandCard label="wallet_eligibility_checker.sys">
      <div className="space-y-5">
        <p className="text-sm text-[#9BA8B4]">
          Paste any Solana wallet to see every Gen2 mint phase it qualifies for — Airdrop (Gen1 holders), Presale,
          Whitelist, and Public. No wallet connection required.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void runCheck(input)
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Wallet address (e.g. 4Nd1m…)"
            aria-label="Solana wallet address"
            className="min-h-[44px] w-full flex-1 touch-manipulation border border-[#1A222B] bg-[#0B0F14] px-3 font-mono text-sm text-[#C5D0D8] placeholder:text-[#3C4753] focus:border-[#00FF9C]/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || input.trim().length === 0}
            className="min-h-[44px] touch-manipulation border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-5 font-mono text-xs font-bold uppercase tracking-widest text-[#00FF9C] hover:bg-[#00FF9C]/15 disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Check'}
          </button>
        </form>

        {err ? <p className="text-sm text-[#FF9C9C]">{err}</p> : null}

        {check && wallet ? (
          <>
            <div className="border border-[#1A222B] bg-[#0F1419] px-3 py-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                {shortWallet(wallet)}
              </p>
              {eligiblePhases.length > 0 ? (
                <p className="mt-1 font-mono text-sm text-[#00FF9C]">
                  Eligible for {eligiblePhases.length} phase{eligiblePhases.length === 1 ? '' : 's'}:{' '}
                  {eligiblePhases.map((p) => p.label).join(', ')}
                </p>
              ) : (
                <p className="mt-1 font-mono text-sm text-[#FFD769]">
                  No mint allocation found for this wallet in any phase yet.
                </p>
              )}
            </div>

            <ul className="space-y-3">
              {check.phases.map((p) => {
                const status = phaseStatus(p)
                return (
                  <li
                    key={p.phase}
                    className={cn(
                      'border px-3 py-3 font-mono text-xs',
                      status === 'mint_now' && 'border-[#00FF9C] bg-[#00FF9C]/12 ring-1 ring-[#00FF9C]/45',
                      status === 'eligible' && 'border-[#00FF9C]/40 border-dashed bg-[#00FF9C]/6',
                      status === 'ineligible' && 'border-[#1A222B] bg-[#0B0F14]'
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold uppercase tracking-widest text-[#C5D0D8]">{p.label}</span>
                      <span
                        className={
                          status === 'mint_now'
                            ? 'text-[#00FF9C]'
                            : status === 'eligible'
                              ? 'text-[#9BA8B4]'
                              : 'text-[#5C6773]'
                        }
                      >
                        {phaseStatusLabel(p, check.presale_sold_out)}
                      </span>
                    </div>
                    <p className="mt-1 text-[#5C6773]">
                      {formatPhasePriceSolOrFree(p.unit_lamports_estimate, {
                        paid: p.price_usdc != null && p.price_usdc > 0,
                      })}{' '}
                      · cap {p.phase_supply}
                    </p>

                    {p.phase === 'AIRDROP' && p.gen1 ? (
                      <p className="mt-2 text-[#9BA8B4]">
                        Gen1 on this wallet: {p.gen1.is_holder ? `yes (${p.gen1.gen1_nft_count})` : 'no'}
                        {p.reserved_mints > 0 ? ` · ${p.reserved_mints} reserved (1 per Gen1 NFT)` : ''}
                      </p>
                    ) : null}

                    {(p.phase === 'PRESALE' || p.phase === 'PRESALE_OVERAGE') && p.presale ? (
                      <p className="mt-2 text-[#9BA8B4]">
                        Paid participant: {p.presale.is_paid_participant ? 'yes' : 'no'} ·{' '}
                        {p.presale.purchased_available_mints ?? p.presale.available_mints} spot(s) left ·{' '}
                        {p.presale.purchased_mints} purchased
                        {p.presale.gifted_mints > 0 ? ` · ${p.presale.gifted_mints} gifted` : ''}
                      </p>
                    ) : null}

                    {p.phase === 'WHITELIST' && p.wl ? (
                      <p className="mt-2 text-[#9BA8B4]">
                        WL spots assigned: {p.wl.allowed_mints} · {p.wl.available_mints} left
                        {p.wl.community ? ` · ${p.wl.community}` : ''}
                        {p.wl.discord_whitelist && !p.wl.admin_allocated ? ' · Discord WL (spots pending)' : ''}
                      </p>
                    ) : null}

                    {status !== 'mint_now' && p.reason ? (
                      <p className="mt-2 text-[#FFD769]">{reasonLabel(p.reason)}</p>
                    ) : null}
                  </li>
                )
              })}
            </ul>

            {check.presale_pool ? (
              <div className="space-y-3 border border-[#1A222B] bg-[#0F1419] p-4">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773]">
                  Global pools
                </p>
                <MintAllocationBar
                  label="Presale phase"
                  minted={check.presale_pool.presale_mints_recorded}
                  total={check.presale_pool.mint_cap}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </CommandCard>
  )
}
