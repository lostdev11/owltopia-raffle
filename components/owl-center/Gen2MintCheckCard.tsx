'use client'

import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import { MintAllocationBar } from '@/components/owl-center/MintAllocationBar'
import { owlCenterActivePhaseTag } from '@/lib/owl-center/phase-display'
import type { Gen2MintCheckPhasePreview, Gen2MintCheckResponse } from '@/lib/owl-center/types'
import { Gen2WlShareButton } from '@/components/owl-center/Gen2WlShareButton'
import { cn } from '@/lib/utils'

function phaseActiveTag(p: Gen2MintCheckPhasePreview, presaleSoldOut: boolean): string | null {
  if (!p.is_active) return null
  return owlCenterActivePhaseTag(p.phase, { presaleSoldOut })
}

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

function reasonLabel(reason: string | null): string {
  if (!reason) return ''
  const map: Record<string, string> = {
    wallet_required: 'Connect wallet to check',
    not_gen1_holder: 'No Owltopia Gen1 NFT detected on this wallet (check collection + Helius)',
    gen1_on_linked_wallet: 'Gen1 NFT is on a linked wallet — connect the wallet that holds your Gen1 to mint',
    gen1_collection_not_configured: 'Server missing OWLTOPIA_COLLECTION_ADDRESS — contact support',
    gen1_pool_exhausted: '343 GEN1 mint cap reached globally',
    gen1_mint_limit: 'GEN1 mint limit reached for this wallet',
    not_presale_participant: 'This wallet did not pay during presale',
    no_paid_presale_credits: 'No paid presale credits left to mint',
    no_presale_credits: 'No presale credits on this wallet',
    no_presale_allocation: 'No presale allocation',
    presale_pool_exhausted: '657 presale mint cap reached globally',
    wl_pool_exhausted: '800 WL mint cap reached globally',
    not_on_overage_list: 'Not on Presale+13 list (spots 658–670)',
    overage_pool_exhausted: 'All 13 overshoot spots minted',
    not_whitelisted: 'Not on WL mint list — admin-added wallets appear here once spots are assigned',
    wl_on_linked_wallet: 'WL spots are on a linked wallet — connect the wallet with your WL allocation',
    wl_pending_allocation: 'On Discord WL — mint slots not assigned yet (admin assigns spots before WL opens)',
    wallet_mint_limit: 'Wallet mint limit reached',
    gen1_phase_pending: 'GEN1 mint opens before presale redemption',
  }
  return map[reason] ?? reason.replace(/_/g, ' ')
}

function phaseHeaderRight(p: Gen2MintCheckPhasePreview, connected: boolean): string {
  if (!connected) return '—'
  if (p.is_active && p.is_eligible && p.max_mintable > 0) {
    return `Can mint ${p.max_mintable}`
  }
  if (p.reserved_mints > 0) {
    return `${p.reserved_mints} reserved`
  }
  return '—'
}

export function Gen2MintCheckCard({
  check,
  loading,
  err,
  onRefresh,
}: {
  check: Gen2MintCheckResponse | null
  loading: boolean
  err: string | null
  onRefresh: () => void
}) {
  const { publicKey, connected } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null

  const pool = check?.presale_pool
  const cluster = check?.wallet_cluster
  const connectedRow = cluster?.wallets.find((w) => w.is_connected_wallet)

  return (
    <CommandCard label="mint_allocation_checker.sys">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#9BA8B4]">
            Allocation is shown for every phase even before it goes live. GEN1 — 1 per Owltopia Gen1 NFT on the minting
            wallet; Presale — 1 per paid presale spot; WL — admin-assigned spots, first come first served against the 800
            cap. Connect the wallet that holds your NFT, presale credits, or WL row.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {connected && walletStr ? <Gen2WlShareButton wallet={walletStr} mintCheck={check} /> : null}
            {!connected ? (
              <p className="text-xs text-[#9BA8B4]">Connect your wallet using the button in the site header above.</p>
            ) : null}
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="min-h-[44px] touch-manipulation px-3 font-mono text-[10px] uppercase tracking-widest text-[#00FF9C] underline-offset-4 hover:underline disabled:opacity-50"
            >
              {loading ? 'Checking…' : 'Refresh'}
            </button>
          </div>
        </div>

        {check?.presale_sold_out ? (
          <p className="border border-[#00FF9C]/25 bg-[#00FF9C]/8 px-3 py-2 text-xs text-[#9BA8B4]">
            Presale purchases are sold out. Paid buyers can still redeem credits during the Presale mint phase below.
          </p>
        ) : null}

        {pool ? (
          <div className="space-y-3 border border-[#1A222B] bg-[#0F1419] p-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773]">Global presale pools</p>
            <MintAllocationBar
              label="Presale phase (657)"
              minted={pool.presale_mints_recorded}
              total={pool.mint_cap}
              hint={`${pool.credits_issued} credits issued${pool.credits_overshoot > 0 ? ` · ${pool.credits_overshoot} handled in Presale+13 phase` : ''}`}
            />
            {pool.credits_overshoot > 0 ? (
              <MintAllocationBar
                label="Presale+13 overshoot"
                minted={pool.overage_mints_recorded}
                total={pool.overage_supply}
                hint="Admin-assigned wallets for spots 658–670"
              />
            ) : null}
          </div>
        ) : null}

        {connected && cluster && cluster.linked_count > 0 ? (
          <div className="space-y-3 border border-[#1A222B] bg-[#0F1419] p-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773]">
              Linked cluster · primary {shortWallet(cluster.primary_wallet)}
            </p>
            <MintAllocationBar
              label="Paid presale credits (linked cluster)"
              minted={cluster.totals.purchased_mints - cluster.totals.purchased_available_mints}
              total={cluster.totals.purchased_mints}
              hint={`${cluster.totals.purchased_available_mints} paid spots left to mint · ${cluster.paid_participant_count} wallet(s) with presale purchases`}
            />
            <ul className="space-y-1 font-mono text-[10px] text-[#9BA8B4]">
              {cluster.wallets.map((row) => (
                <li key={row.wallet} className={row.is_connected_wallet ? 'text-[#00FF9C]' : ''}>
                  {shortWallet(row.wallet)}
                  {row.is_connected_wallet ? ' (connected)' : ''}
                  {row.is_paid_participant ? '' : ' · no presale payment'}
                  {row.is_paid_participant
                    ? `: ${row.purchased_available_mints} paid left · ${row.purchased_mints} bought`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : connected && connectedRow && connectedRow.is_paid_participant ? (
          <MintAllocationBar
            label="This wallet — paid presale"
            minted={connectedRow.purchased_mints - connectedRow.purchased_available_mints}
            total={connectedRow.purchased_mints}
            hint={`${connectedRow.purchased_available_mints} paid spots left to mint (${connectedRow.purchased_mints} purchased)`}
          />
        ) : connected && connectedRow && !connectedRow.is_paid_participant ? (
          <p className="text-xs text-[#FFD769]">
            Connected wallet is not in presale purchase records. Link the wallet that paid, or switch wallets.
          </p>
        ) : null}

        {err ? <p className="text-sm text-[#FF9C9C]">{err}</p> : null}

        {check ? (
          <ul className="space-y-3">
            {check.phases.map((p) => {
              const active = p.is_active
              const eligible = p.is_eligible
              const canMintNow = connected && active && eligible && p.max_mintable > 0
              const hasUserAllocation = connected && p.reserved_mints > 0
              const activeTag = phaseActiveTag(p, check.presale_sold_out)
              return (
                <li
                  key={p.phase}
                  className={cn(
                    'border px-3 py-3 font-mono text-xs',
                    canMintNow && 'border-[#00FF9C] bg-[#00FF9C]/12 ring-1 ring-[#00FF9C]/45',
                    active && !canMintNow && 'border-[#00FF9C]/40 bg-[#00FF9C]/6',
                    !active && hasUserAllocation && 'border-[#00FF9C]/30 border-dashed bg-[#00FF9C]/5',
                    !active && !hasUserAllocation && !canMintNow && 'border-[#1A222B] bg-[#0B0F14]'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold uppercase tracking-widest text-[#C5D0D8]">
                      {p.label}
                      {canMintNow ? (
                        <span className="ml-2 text-[#00FF9C]">· Your mint</span>
                      ) : activeTag ? (
                        <span className="ml-2 text-[#00FF9C]">· {activeTag}</span>
                      ) : !active && hasUserAllocation ? (
                        <span className="ml-2 text-[#9BA8B4]">· Your allocation</span>
                      ) : null}
                    </span>
                    <span
                      className={
                        connected && p.reserved_mints > 0
                          ? eligible && active
                            ? 'text-[#00FF9C]'
                            : 'text-[#9BA8B4]'
                          : 'text-[#5C6773]'
                      }
                    >
                      {phaseHeaderRight(p, connected)}
                    </span>
                  </div>
                  <p className="mt-1 text-[#5C6773]">
                    {formatPhasePriceSolOrFree(p.unit_lamports_estimate, {
                      paid: p.price_usdc != null && p.price_usdc > 0,
                    })}{' '}
                    · cap {p.phase_supply}
                  </p>

                  {p.phase === 'AIRDROP' && p.gen1 ? (
                    <div className="mt-2 space-y-1 text-[#9BA8B4]">
                      <p>
                        Gen1 on this wallet: {p.gen1.is_holder ? `yes (${p.gen1.gen1_nft_count})` : 'no'}
                        {p.reserved_mints > 0
                          ? ` · ${p.reserved_mints} reserved (1 per Gen1 NFT on minting wallet)`
                          : p.gen1.is_holder
                            ? ' · none left to mint'
                            : ''}
                        {p.gen1.minted_in_phase > 0 ? ` · minted ${p.gen1.minted_in_phase} in GEN1 phase` : ''}
                      </p>
                      {(p.gen1.cluster_gen1_nft_count ?? 0) > p.gen1.gen1_nft_count ? (
                        <p className="text-[#5C6773]">
                          Linked cluster total: {p.gen1.cluster_gen1_nft_count} Gen1 NFT
                          {(p.gen1.cluster_gen1_nft_count ?? 0) === 1 ? '' : 's'}
                        </p>
                      ) : null}
                      {p.gen1.gen1_on_linked_wallet ? (
                        <p className="text-[#FFD769]">{reasonLabel('gen1_on_linked_wallet')}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {p.phase === 'PRESALE' && p.presale ? (
                    <p className="mt-2 text-[#9BA8B4]">
                      Paid participant: {p.presale.is_paid_participant ? 'yes' : 'no'} ·{' '}
                      {p.presale.purchased_available_mints ?? 0} paid spots left · {p.presale.purchased_mints} purchased
                      {p.presale.is_paid_participant &&
                      (p.presale.purchased_available_mints ?? 0) > 0 &&
                      active &&
                      eligible
                        ? ` · mint up to ${p.max_mintable} at once (1 per presale spot)`
                        : ''}
                      {p.presale.gifted_mints > 0 ? ` · ${p.presale.gifted_mints} gifted (not used in presale phase)` : ''}
                    </p>
                  ) : null}

                  {p.phase === 'PRESALE_OVERAGE' && p.presale ? (
                    <p className="mt-2 text-[#9BA8B4]">
                      Overshoot list + {p.presale.available_mints} credit(s) on this wallet
                    </p>
                  ) : null}

                  {p.phase === 'WHITELIST' && p.wl ? (
                    <div className="mt-2 space-y-1 text-[#9BA8B4]">
                      <p>
                        WL on this wallet: {p.wl.allowed_mints} spot{p.wl.allowed_mints === 1 ? '' : 's'} assigned ·{' '}
                        {p.wl.available_mints} left
                        {p.wl.admin_allocated ? ' · admin allocation' : ''}
                        {p.wl.available_mints > 0 && active
                          ? ` · mint up to ${p.max_mintable} at once`
                          : p.reserved_mints > 0
                            ? ` · ${p.reserved_mints} reserved for WL`
                            : ''}
                        {p.wl.community ? ` · ${p.wl.community}` : ''}
                        {p.wl.discord_whitelist && !p.wl.admin_allocated ? ' · Discord WL (spots pending)' : ''}
                      </p>
                      <p className="text-[#5C6773]">
                        FCFS when WL opens — shared {p.phase_supply} cap; mint order matters once the phase is live.
                      </p>
                      {(p.wl.cluster_available_mints ?? 0) > p.wl.available_mints ? (
                        <p className="text-[#5C6773]">
                          Linked cluster WL available: {p.wl.cluster_available_mints}
                        </p>
                      ) : null}
                      {p.wl.wl_on_linked_wallet ? (
                        <p className="text-[#FFD769]">{reasonLabel('wl_on_linked_wallet')}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {p.phase_note && connected ? (
                    <p className="mt-2 text-[#9BA8B4]">{p.phase_note}</p>
                  ) : null}
                  {p.reason && connected ? <p className="mt-2 text-[#FFD769]">{reasonLabel(p.reason)}</p> : null}
                </li>
              )
            })}
          </ul>
        ) : loading ? (
          <p className="font-mono text-sm text-[#9BA8B4]">Loading allocation checker…</p>
        ) : null}
      </div>
    </CommandCard>
  )
}
