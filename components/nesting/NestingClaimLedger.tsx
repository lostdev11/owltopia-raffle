'use client'

import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { StakingRewardEventRow } from '@/lib/db/staking-reward-events'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { cn } from '@/lib/utils'

type Props = {
  events: StakingRewardEventRow[]
  className?: string
}

function formatClaimWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function NestingClaimLedger({ events, className }: Props) {
  const [expanded, setExpanded] = useState(false)

  const collapsedSummary = useMemo(() => {
    if (events.length === 0) return ''
    const latest = events[0]
    const latestWhen = formatClaimWhen(latest.created_at)
    const latestAmount = latest.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })
    const countLabel = `${events.length} claim${events.length === 1 ? '' : 's'}`
    return `${countLabel} · latest ${latestAmount} OWL · ${latestWhen}`
  }, [events])

  if (events.length === 0) return null

  const devnet = /devnet/i.test(resolvePublicSolanaRpcUrl())
  const contentId = 'nesting-claim-ledger-list'

  return (
    <div className={cn('rounded-xl border border-border/80 bg-card/40 px-4 py-3 sm:px-5 sm:py-4', className)}>
      <button
        type="button"
        className={cn(
          'flex w-full min-h-[44px] touch-manipulation items-start justify-between gap-3 rounded-lg text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
        )}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="sr-only">{expanded ? 'Collapse' : 'Expand'} claim ledger</span>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Claim ledger</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {expanded
              ? 'Completed OWL claims for your wallet. On-chain rows include a Solscan link when SPL was sent.'
              : collapsedSummary}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-180'
          )}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ul id={contentId} className="mt-3 divide-y divide-border/60">
          {events.map((ev) => {
            const sig = ev.transaction_signature?.trim() ?? ''
            const onChain = ev.execution_path === 'onchain_transfer' && sig.length > 0
            const appOnly = ev.execution_path === 'database_only'
            const explorerHref = sig
              ? `https://solscan.io/tx/${sig}${devnet ? '?cluster=devnet' : ''}`
              : null
            const amountLabel = ev.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })

            return (
              <li
                key={ev.id}
                className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <ClaimLedgerRow amountLabel={amountLabel} when={formatClaimWhen(ev.created_at)} />
                <ClaimLedgerBadges
                  onChain={onChain}
                  appOnly={appOnly}
                  sig={sig}
                  explorerHref={explorerHref}
                />
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function ClaimLedgerRow({ amountLabel, when }: { amountLabel: string; when: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">{amountLabel} OWL</p>
      <p className="text-xs text-muted-foreground">{when}</p>
    </div>
  )
}

function ClaimLedgerBadges({
  onChain,
  appOnly,
  sig,
  explorerHref,
}: {
  onChain: boolean
  appOnly: boolean
  sig: string
  explorerHref: string | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      {onChain ? (
        <span className="rounded-md border border-green-500/35 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
          On-chain
        </span>
      ) : null}
      {appOnly ? (
        <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          App ledger
        </span>
      ) : null}
      {explorerHref ? (
        <a
          href={explorerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-[44px] inline-flex items-center text-xs font-medium text-theme-prime underline-offset-4 hover:underline touch-manipulation"
        >
          View tx
        </a>
      ) : sig ? (
        <span className="text-xs text-muted-foreground font-mono truncate max-w-[10rem]" title={sig}>
          {sig.slice(0, 8)}…
        </span>
      ) : null}
    </div>
  )
}
