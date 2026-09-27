'use client'

import { CommandCard } from '@/components/owl-center/CommandCard'
import type { SimpleMintEligibilityResponse } from '@/lib/owl-center/types'
import { cn } from '@/lib/utils'

function shortWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

/**
 * Buyer-facing eligibility status for partner collection mints.
 * Gen2 has a dedicated mint-check card; public_simple launches previously only
 * buried a one-line reason inside the mint button area.
 */
export function CollectionMintEligibilityCard({
  connected,
  wallet,
  elig,
  loading,
  error,
  onRefresh,
}: {
  connected: boolean
  wallet: string | null
  elig: SimpleMintEligibilityResponse | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const phaseChecks = elig?.allowlist_phase_checks ?? []
  const onListPhases = phaseChecks.filter((c) => c.on_list === true)
  const checkedPhases = phaseChecks.filter((c) => c.on_list != null)
  const phaseLabel =
    elig?.active_allowlist_label ??
    (onListPhases.length === 1
      ? onListPhases[0]!.label
      : checkedPhases.length === 1
        ? checkedPhases[0]!.label
        : null)
  const onList = elig?.on_allowlist
  const spots = elig?.allowlist_spots_remaining
  const showCheckmark = onList === true || (elig?.is_eligible === true && connected)

  let statusTone: 'ok' | 'warn' | 'muted' = 'muted'
  let statusTitle = 'Eligibility'
  let statusBody = 'Connect your wallet to check allowlist and public mint eligibility.'

  if (error) {
    statusTone = 'warn'
    statusTitle = 'Could not check eligibility'
    statusBody = error
  } else if (loading && !elig) {
    statusBody = 'Checking eligibility…'
  } else if (elig) {
    if (!connected || !wallet) {
      statusBody =
        elig.reason ??
        (phaseLabel
          ? `${phaseLabel} is live — connect wallet to check if you’re on the list`
          : 'Connect wallet to check eligibility')
    } else if (elig.is_eligible) {
      statusTone = 'ok'
      statusTitle = phaseLabel ? `Eligible · ${phaseLabel}` : 'Eligible · Public'
      statusBody =
        elig.reason ??
        `You can mint up to ${elig.max_mintable} from this wallet` +
          (spots != null ? ` (${spots} allowlist spot${spots === 1 ? '' : 's'} left)` : '')
    } else if (onList === true) {
      // On the list but phase not open yet (or already minted / sold out).
      statusTone = 'ok'
      const listLabel =
        phaseLabel ??
        (onListPhases.length > 1
          ? onListPhases.map((p) => p.label).join(' · ')
          : onListPhases[0]?.label ?? 'Allowlist')
      statusTitle = `On list · ${listLabel}`
      statusBody = elig.reason ?? `Wallet is on ${listLabel} — mint when the phase opens`
    } else if (onList === false && (phaseLabel || onListPhases.length === 0)) {
      const missLabel = phaseLabel ?? elig.active_allowlist_label ?? 'Allowlist'
      statusTone = 'warn'
      statusTitle = `Not on ${missLabel}`
      statusBody =
        elig.reason ?? `This wallet is not on the ${missLabel} list. Wait for the next phase or public.`
    } else {
      statusTone = 'warn'
      statusTitle = phaseLabel ? `${phaseLabel} · not eligible` : 'Not eligible yet'
      statusBody = elig.reason ?? 'Not eligible to mint right now'
    }
  }

  const onListDetail =
    onList === true
      ? onListPhases.length > 1
        ? ` · on list (${onListPhases.map((p) => p.label).join(', ')})`
        : ' · on list'
      : onList === false
        ? ' · not on list'
        : ''

  return (
    <CommandCard label="ELIGIBILITY // CHECK">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className={cn(
                'flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest',
                statusTone === 'ok' && 'text-[#00FF9C]',
                statusTone === 'warn' && 'text-[#FFD769]',
                statusTone === 'muted' && 'text-[#9BA8B4]'
              )}
            >
              {showCheckmark ? (
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-[#00FF9C]/50 bg-[#00FF9C]/12 text-sm text-[#00FF9C]"
                  title="Wallet is on this phase list"
                  aria-label="On list"
                >
                  ✓
                </span>
              ) : null}
              <span>{statusTitle}</span>
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[#C5D0D8]">{statusBody}</p>
            {connected && wallet ? (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Wallet {shortWallet(wallet)}
                {elig
                  ? ` · minted ${elig.wallet_minted}/${elig.wallet_mint_limit} from ${
                      phaseLabel ? phaseLabel : 'public'
                    } this phase`
                  : ''}
                {onListDetail}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[44px] shrink-0 touch-manipulation border border-[#1A222B] px-3 font-mono text-[10px] uppercase tracking-widest text-[#00C97A] hover:border-[#00FF9C]/35"
          >
            Refresh
          </button>
        </div>
      </div>
    </CommandCard>
  )
}
