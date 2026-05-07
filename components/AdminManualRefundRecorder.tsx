'use client'

import { useState, useEffect, useCallback, useMemo, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { Entry } from '@/lib/types'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'

function adminSolscanTxUrl(signature: string): string {
  const q = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${encodeURIComponent(signature.trim())}${q}`
}

export type AdminManualRefundRecorderProps = {
  raffleId: string
  raffleCurrency: string
  entries: Entry[]
  /** After a successful record, e.g. refresh RSC + refetch client entries */
  onRecorded?: () => void
  /** When true (funds-escrow raffle in a refund-eligible status), show bulk send from FUNDS_ESCROW. */
  adminFundsEscrowRefundEnabled?: boolean
}

/**
 * Full admin: bulk-send from FUNDS_ESCROW when eligible, or record an existing payout via tx signature.
 */
export function AdminManualRefundRecorder({
  raffleId,
  raffleCurrency,
  entries,
  onRecorded,
  adminFundsEscrowRefundEnabled = false,
}: AdminManualRefundRecorderProps) {
  const router = useRouter()
  const refundTxInputId = useId()

  const unrefundedConfirmed = useMemo(
    () =>
      entries.filter(
        (e) => e.raffle_id === raffleId && e.status === 'confirmed' && !e.refunded_at
      ),
    [entries, raffleId]
  )

  const refundedConfirmed = useMemo(
    () =>
      entries.filter(
        (e) => e.raffle_id === raffleId && e.status === 'confirmed' && !!e.refunded_at
      ),
    [entries, raffleId]
  )

  const [recordRefundTx, setRecordRefundTx] = useState('')
  const [recordingRefunds, setRecordingRefunds] = useState(false)
  const [legacyEscrowSending, setLegacyEscrowSending] = useState(false)
  const [selectedRefundEntryIds, setSelectedRefundEntryIds] = useState<string[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const allowed = new Set(
      entries
        .filter(
          (e) => e.raffle_id === raffleId && e.status === 'confirmed' && !e.refunded_at
        )
        .map((e) => e.id)
    )
    setSelectedRefundEntryIds((prev) => prev.filter((id) => allowed.has(id)))
  }, [entries, raffleId])

  const toggleRefundEntrySelected = useCallback((entryId: string) => {
    setSelectedRefundEntryIds((prev) =>
      prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId]
    )
  }, [])

  const handleRecordManualRefunds = async () => {
    setMessage(null)
    const sig = recordRefundTx.trim()
    if (!sig) {
      setMessage({ type: 'error', text: 'Paste the Solana transaction signature first.' })
      return
    }
    if (selectedRefundEntryIds.length === 0) {
      setMessage({ type: 'error', text: 'Select at least one ticket row to mark as refunded.' })
      return
    }
    setRecordingRefunds(true)
    try {
      const res = await fetch(`/api/raffles/${raffleId}/record-refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entryIds: selectedRefundEntryIds,
          transactionSignature: sig,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setMessage({
          type: 'error',
          text:
            'Sign in to Owl Vision (wallet sign-in) is required — open /admin and sign in, then try again.',
        })
        return
      }
      if (res.ok && data?.success) {
        const req = typeof data.requestedCount === 'number' ? data.requestedCount : selectedRefundEntryIds.length
        const upd = typeof data.updatedCount === 'number' ? data.updatedCount : 0
        const partial = upd < req
        setMessage({
          type: 'success',
          text: partial
            ? `Recorded refund on ${upd} of ${req} selected ticket(s). Others were already refunded or did not match. Buyers see refunded/sent for updated rows.`
            : `Recorded refund for ${upd} ticket row(s). Buyers see refunded/sent; same tx is stored for each row.`,
        })
        setRecordRefundTx('')
        setSelectedRefundEntryIds([])
        if (onRecorded) {
          onRecorded()
        } else {
          router.refresh()
        }
      } else {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Failed to record refunds',
        })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to record refunds',
      })
    } finally {
      setRecordingRefunds(false)
    }
  }

  const handleBulkFundsEscrowRefund = async () => {
    setMessage(null)
    if (selectedRefundEntryIds.length === 0) {
      setMessage({ type: 'error', text: 'Select at least one ticket row first.' })
      return
    }
    setLegacyEscrowSending(true)
    try {
      const res = await fetch('/api/admin/legacy-escrow-refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ entryIds: selectedRefundEntryIds }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        results?: Array<{
          entryId: string
          ok: boolean
          error?: string
          transactionSignature?: string
          alreadyRefunded?: boolean
        }>
        okCount?: number
        requestedCount?: number
        error?: string
      }
      if (res.status === 401) {
        setMessage({
          type: 'error',
          text: 'Sign in to Owl Vision (full admin) on /admin, then try again.',
        })
        return
      }
      if (!res.ok) {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Funds escrow bulk refund request failed',
        })
        return
      }
      const rows = Array.isArray(data.results) ? data.results : []
      const lines = rows.map((r) => {
        if (!r.ok) return `${r.entryId.slice(0, 8)}… — ${r.error ?? 'failed'}`
        if (r.alreadyRefunded) {
          const tx = (r.transactionSignature ?? '').trim()
          return `${r.entryId.slice(0, 8)}… — already refunded${tx ? ` (${tx.slice(0, 8)}…)` : ''}`
        }
        return `${r.entryId.slice(0, 8)}… — ok — ${(r.transactionSignature ?? '').slice(0, 12)}…`
      })
      const allOk = data.ok === true
      setMessage({
        type: allOk ? 'success' : 'error',
        text: [
          `Processed ${typeof data.okCount === 'number' ? data.okCount : rows.filter((x) => x.ok).length}/${typeof data.requestedCount === 'number' ? data.requestedCount : selectedRefundEntryIds.length} ticket(s).`,
          ...lines,
        ].join('\n'),
      })
      if (rows.some((r) => r.ok && !r.alreadyRefunded)) {
        setSelectedRefundEntryIds([])
        if (onRecorded) onRecorded()
        else router.refresh()
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Funds escrow bulk refund failed',
      })
    } finally {
      setLegacyEscrowSending(false)
    }
  }

  if (unrefundedConfirmed.length === 0 && refundedConfirmed.length === 0) {
    return null
  }

  const curDefault = (raffleCurrency || 'SOL').toUpperCase()

  return (
    <div id="manual-refunds" className="space-y-4 scroll-mt-24">
      {message && (
        <div
          className={`p-3 rounded-lg border text-sm whitespace-pre-wrap ${
            message.type === 'success'
              ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
              : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {unrefundedConfirmed.length > 0 && (
        <Card className="border-teal-500/30 bg-teal-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pending ticket refunds</CardTitle>
            <CardDescription>
              {adminFundsEscrowRefundEnabled ? (
                <>
                  Select tickets, then use Send from funds escrow to pay buyers
                  from the server escrow wallet (same as buyer &quot;Claim refund&quot;). Each row is sent in its own
                  transaction. This includes live or ready-to-draw raffles after the escrow prize was returned to the
                  creator. Or, if you already paid from treasury or another wallet, paste the Solana signature to record{' '}
                  <code className="text-xs">refunded_at</code> only.
                </>
              ) : (
                <>
                  If refunds were sent from treasury or another wallet, select the rows the payout covered and paste the
                  Solana transaction signature. This sets <code className="text-xs">refunded_at</code> so buyers and hosts
                  see refunded/sent. One chain transaction can cover multiple rows — use the same signature for all of
                  them.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="touch-manipulation min-h-[44px]"
                onClick={() => setSelectedRefundEntryIds(unrefundedConfirmed.map((e) => e.id))}
              >
                Select all pending
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="touch-manipulation min-h-[44px]"
                onClick={() => setSelectedRefundEntryIds([])}
                disabled={selectedRefundEntryIds.length === 0}
              >
                Clear selection
              </Button>
            </div>
            <div className="max-h-72 overflow-auto rounded border border-border bg-muted/30 -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/60">
                    <th className="py-2 pl-2 w-10" scope="col">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="py-2 pr-2">Wallet</th>
                    <th className="py-2 pr-2 text-right whitespace-nowrap">Amount</th>
                    <th className="py-2 pr-2 w-14">Curr</th>
                    <th className="py-2 pr-2 font-mono text-xs">Entry ID</th>
                  </tr>
                </thead>
                <tbody>
                  {unrefundedConfirmed.map((e) => {
                    const w = (e.wallet_address || '').trim()
                    const cur = (e.currency || curDefault).toUpperCase()
                    const checked = selectedRefundEntryIds.includes(e.id)
                    return (
                      <tr key={e.id} className="border-t border-border/50">
                        <td className="py-2 pl-2 align-top">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRefundEntrySelected(e.id)}
                            className="h-5 w-5 touch-manipulation"
                            aria-label={`Select ticket ${e.id} for refund`}
                          />
                        </td>
                        <td className="py-2 pr-2 font-mono text-xs break-all align-top" title={w}>
                          {w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w}
                        </td>
                        <td className="py-2 pr-2 text-right font-mono whitespace-nowrap align-top">
                          {cur === 'USDC' ? Number(e.amount_paid).toFixed(2) : Number(e.amount_paid).toFixed(6)}
                        </td>
                        <td className="py-2 pr-2 align-top">{cur}</td>
                        <td className="py-2 pr-2 font-mono text-[10px] sm:text-xs text-muted-foreground break-all align-top">
                          {e.id}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {adminFundsEscrowRefundEnabled && (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/[0.07] p-3 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Sends from <code className="text-xs">FUNDS_ESCROW</code>. Ensure the escrow wallet holds enough for the
                  selected amounts.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="touch-manipulation min-h-[44px] w-full sm:w-auto border-amber-600/50"
                  disabled={
                    legacyEscrowSending || recordingRefunds || selectedRefundEntryIds.length === 0
                  }
                  onClick={handleBulkFundsEscrowRefund}
                >
                  {legacyEscrowSending ? 'Sending…' : 'Send selected refunds from funds escrow'}
                </Button>
              </div>
            )}

            <div className="space-y-2 pt-1 border-t border-border/60">
              <Label htmlFor={refundTxInputId}>
                {adminFundsEscrowRefundEnabled ? 'Or paste payout tx (already sent off-app)' : 'Transaction signature'}
              </Label>
              <Input
                id={refundTxInputId}
                value={recordRefundTx}
                onChange={(e) => setRecordRefundTx(e.target.value)}
                placeholder="Paste Solana transaction signature"
                className="font-mono text-sm touch-manipulation min-h-[44px]"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              type="button"
              className="bg-teal-600 hover:bg-teal-700 touch-manipulation min-h-[44px] w-full sm:w-auto"
              disabled={recordingRefunds || selectedRefundEntryIds.length === 0 || !recordRefundTx.trim()}
              onClick={handleRecordManualRefunds}
            >
              {recordingRefunds ? 'Recording…' : 'Record refund for selected tickets'}
            </Button>
          </CardContent>
        </Card>
      )}

      {refundedConfirmed.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tickets already marked refunded</CardTitle>
            <CardDescription>
              Rows with <code className="text-xs">refunded_at</code> set (including via buyer self-claim). Use Solscan
              to audit payouts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-48 overflow-auto rounded border border-border bg-muted/20 text-sm -mx-1">
              <ul className="divide-y divide-border/60">
                {refundedConfirmed.map((e) => {
                  const tx = (e.refund_transaction_signature || '').trim()
                  return (
                    <li
                      key={e.id}
                      className="px-2 py-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="font-mono text-xs break-all text-muted-foreground">{e.id}</span>
                      <span className="font-mono text-xs shrink-0">
                        {tx ? (
                          <a
                            href={adminSolscanTxUrl(tx)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline touch-manipulation min-h-[44px] inline-flex items-center"
                          >
                            View tx
                          </a>
                        ) : (
                          '—'
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
