'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Trash2, ArrowLeftCircle, XCircle, Ban, CheckCircle } from 'lucide-react'
import type { Raffle, Entry } from '@/lib/types'
import Link from 'next/link'

const FULL_REFUND_WINDOW_HOURS = 24
function isWithinFullRefundWindow(createdAt: string): boolean {
  const created = new Date(createdAt).getTime()
  const hours = (Date.now() - created) / (60 * 60 * 1000)
  return hours <= FULL_REFUND_WINDOW_HOURS
}

const PRIZE_RETURN_REASONS = [
  { value: 'cancelled', label: 'Raffle cancelled' },
  { value: 'wrong_nft', label: 'Wrong NFT deposited' },
  { value: 'dispute', label: 'Dispute resolution' },
  { value: 'platform_error', label: 'Platform error' },
  { value: 'testing', label: 'Testing' },
] as const

interface AdminRaffleActionsProps {
  raffle: Raffle
  entries?: Entry[]
}

export function AdminRaffleActions({ raffle, entries = [] }: AdminRaffleActionsProps) {
  const router = useRouter()
  const { connected, publicKey } = useWallet()
  const [returnDialogOpen, setReturnDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [returning, setReturning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [returnReason, setReturnReason] = useState<string>('cancelled')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [acceptCancelDialogOpen, setAcceptCancelDialogOpen] = useState(false)
  const [acceptingCancel, setAcceptingCancel] = useState(false)
  const [blockingPurchases, setBlockingPurchases] = useState(false)
  const [fixMintDialogOpen, setFixMintDialogOpen] = useState(false)
  const [fixMintInput, setFixMintInput] = useState('')
  const [fixingMint, setFixingMint] = useState(false)

  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  const isNftRaffle = raffle.prize_type === 'nft' && !!raffle.nft_mint_address
  const purchasesBlocked = !!(raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
  const pendingSectionEligible = isNftRaffle
  const canReturnNft =
    isNftRaffle &&
    !!creatorWallet &&
    !!raffle.prize_deposited_at &&
    !raffle.nft_transfer_transaction &&
    !raffle.prize_returned_at

  const handleReturnNft = async () => {
    // No wallet signature needed — server signs with escrow keypair; only admin session required
    setReturning(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/return-prize-to-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: returnReason }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text: data.transactionSignature
            ? `NFT returned to creator. TX: ${data.transactionSignature}`
            : 'NFT returned to creator successfully.',
        })
        setReturnDialogOpen(false)
        router.refresh()
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to return NFT to creator' })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to return NFT to creator',
      })
    } finally {
      setReturning(false)
    }
  }

  const cancellationRequested = !!raffle.cancellation_requested_at
  const isCancelled = (raffle.status ?? '').toLowerCase() === 'cancelled'
  const fullRefundEligible = raffle.created_at ? isWithinFullRefundWindow(raffle.created_at) : false

  const handleAcceptCancellation = async () => {
    setAcceptingCancel(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/accept-cancellation`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setMessage({ type: 'success', text: data.message ?? 'Cancellation accepted.' })
        setAcceptCancelDialogOpen(false)
        router.refresh()
      } else {
        setMessage({ type: 'error', text: data.error ?? 'Failed to accept cancellation' })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to accept cancellation',
      })
    } finally {
      setAcceptingCancel(false)
    }
  }

  const handleFixNftMint = async () => {
    const mint = fixMintInput.trim()
    if (!mint) {
      setMessage({ type: 'error', text: 'Enter the correct NFT mint address from Solscan' })
      return
    }
    setFixingMint(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/fix-nft-mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nft_mint_address: mint }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text: data.message ?? 'NFT mint address updated. Solscan link will now show the correct prize.',
        })
        setFixMintDialogOpen(false)
        setFixMintInput('')
        router.refresh()
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to fix NFT mint address' })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to fix NFT mint address',
      })
    } finally {
      setFixingMint(false)
    }
  }

  const handleBlockPurchases = async (block: boolean) => {
    setBlockingPurchases(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/block-purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text: data.message ?? (block ? 'Ticket purchases blocked.' : 'Ticket purchases unblocked.'),
        })
        router.refresh()
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update' })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to update',
      })
    } finally {
      setBlockingPurchases(false)
    }
  }

  const handleDelete = async () => {
    if (!connected || !publicKey) {
      setMessage({ type: 'error', text: 'Please connect your wallet' })
      return
    }
    setDeleting(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58(),
        },
        body: JSON.stringify({ wallet_address: publicKey.toBase58() }),
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        setDeleteDialogOpen(false)
        router.push('/admin/raffles')
        router.refresh()
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete raffle' })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to delete raffle',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="container mx-auto py-6 sm:py-8 px-3 sm:px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/admin/raffles" className="inline-flex">
            <Button variant="outline" size="sm" className="touch-manipulation min-h-[44px] px-3 sm:px-4">
              <ArrowLeftCircle className="h-4 w-4 mr-2 shrink-0" />
              Back to raffles
            </Button>
          </Link>
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-4xl font-bold mb-2 break-words">Admin: {raffle.title}</h1>
          <p className="text-muted-foreground">
            Status: <span className="font-medium">{raffle.status ?? '—'}</span>
            {creatorWallet && (
              <>
                {' · Creator: '}
                <code className="text-xs">{creatorWallet}</code>
              </>
            )}
          </p>
        </div>
        {isNftRaffle && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
              Escrow moderation quick link
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              If escrow signing/deposit looks wrong, verify the escrow NFT portfolio directly on Solscan before allowing raffle activity.
            </p>
            <a
              href="https://solscan.io/account/3STVmBQNzymnTQx5DNTjFQUeHFx42rtSEGBxmnzFCfg7#portfolio_nfts"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center text-sm text-primary hover:underline touch-manipulation min-h-[44px] break-all"
            >
              solscan.io/account/3STVmB...FCfg7#portfolio_nfts
            </a>
          </div>
        )}

        {message && (
          <div
            className={`p-3 rounded-lg border ${
              message.type === 'success'
                ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
            }`}
          >
            <p className="text-sm">{message.text}</p>
          </div>
        )}

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle>Admin actions</CardTitle>
            <CardDescription>
              Return the NFT prize to the creator&apos;s wallet, then delete the raffle if needed.
              For NFT raffles, return the prize first so the creator gets their NFT back before
              deleting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Cancellation request: creator requested; admin can accept */}
            {cancellationRequested && !isCancelled && (
              <>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Cancellation requested by creator
                    {raffle.cancellation_requested_at && (
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        at {new Date(raffle.cancellation_requested_at).toLocaleString()}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fullRefundEligible
                      ? 'Within 24h: ticket buyers get refunds (treasury sends). No fee to host.'
                      : 'After 24h: ticket buyers get refunds (treasury sends). Host is charged a cancellation fee.'}
                  </p>
                </div>
                <Dialog open={acceptCancelDialogOpen} onOpenChange={setAcceptCancelDialogOpen}>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10 touch-manipulation min-h-[44px]"
                    onClick={() => setAcceptCancelDialogOpen(true)}
                    disabled={acceptingCancel}
                  >
                    <XCircle className="h-4 w-4 mr-2 shrink-0" />
                    Accept cancellation
                  </Button>
                  <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Accept cancellation</DialogTitle>
                      <DialogDescription>
                        This will mark the raffle as cancelled.
                        {fullRefundEligible ? (
                          <> Ticket buyers get refunds (treasury sends). Within 24h: no fee to host.</>
                        ) : (
                          <> Ticket buyers get refunds (treasury sends). After 24h: host will be charged the cancellation fee.</>
                        )}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setAcceptCancelDialogOpen(false)}
                        disabled={acceptingCancel}
                        className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleAcceptCancellation}
                        disabled={acceptingCancel}
                        className="bg-amber-600 hover:bg-amber-700 touch-manipulation min-h-[44px] w-full sm:w-auto"
                      >
                        {acceptingCancel ? 'Accepting...' : 'Accept cancellation'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
            {/* Move between normal lists and Pending/Paused section for NFT raffles waiting on escrow */}
            {pendingSectionEligible && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={purchasesBlocked ? 'default' : 'outline'}
                  className={
                    purchasesBlocked
                      ? 'bg-green-600 hover:bg-green-700 touch-manipulation min-h-[44px]'
                      : 'border-amber-500/50 text-amber-600 hover:bg-amber-500/10 touch-manipulation min-h-[44px]'
                  }
                  onClick={() => handleBlockPurchases(!purchasesBlocked)}
                  disabled={blockingPurchases}
                >
                  {purchasesBlocked
                    ? (blockingPurchases ? 'Restoring...' : 'Return to normal sections')
                    : (blockingPurchases ? 'Moving...' : 'Move to Pending/Paused section')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {purchasesBlocked
                    ? 'Currently in Pending/Paused section on the raffles page.'
                    : 'Manually place this raffle in Pending/Paused while escrow signing/verification is unresolved.'}
                </span>
              </div>
            )}

            {/* Block purchases — admin can block ticket purchases on any raffle (e.g. NFT not in escrow) */}
            <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={purchasesBlocked ? 'default' : 'outline'}
                  className={
                    purchasesBlocked
                      ? 'bg-green-600 hover:bg-green-700 touch-manipulation min-h-[44px]'
                      : 'border-red-500/50 text-red-600 hover:bg-red-500/10 touch-manipulation min-h-[44px]'
                  }
                  onClick={() => handleBlockPurchases(!purchasesBlocked)}
                  disabled={blockingPurchases}
                >
                  {purchasesBlocked ? (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2 shrink-0" />
                      {blockingPurchases ? 'Unblocking...' : 'Unblock ticket purchases'}
                    </>
                  ) : (
                    <>
                      <Ban className="h-4 w-4 mr-2 shrink-0" />
                      {blockingPurchases ? 'Blocking...' : 'Block ticket purchases'}
                    </>
                  )}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {purchasesBlocked
                    ? 'Ticket purchases are blocked. No new tickets can be bought.'
                    : 'Block new ticket purchases (e.g. NFT not in escrow, wrong prize).'}
                </span>
            </div>
            {/* Fix NFT mint — when raffle has wrong link but correct NFT was deposited */}
            {isNftRaffle && raffle.prize_deposited_at && !raffle.nft_transfer_transaction && (
              <Dialog open={fixMintDialogOpen} onOpenChange={setFixMintDialogOpen}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-blue-500/50 text-blue-600 hover:bg-blue-500/10 touch-manipulation min-h-[44px]"
                    onClick={() => {
                      setFixMintInput('')
                      setFixMintDialogOpen(true)
                    }}
                    disabled={fixingMint}
                  >
                    Fix NFT mint / link
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Wrong Solscan link but NFT was sent to escrow? Paste the correct mint from Solscan.
                  </span>
                </div>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Fix NFT mint address</DialogTitle>
                    <DialogDescription>
                      The raffle has the wrong NFT link stored, but the correct NFT was deposited to escrow.
                      Paste the correct mint address from Solscan (e.g. from the token URL).
                      Current: <code className="text-xs break-all">{raffle.nft_mint_address || '—'}</code>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-4">
                    <Label htmlFor="fix-mint-input">Correct NFT mint address</Label>
                    <Input
                      id="fix-mint-input"
                      placeholder="e.g. Gh2dp9UiFsJ4k6PuVRFyCZLG72Hy3DL2XuoQqNhzkyrb"
                      value={fixMintInput}
                      onChange={(e) => setFixMintInput(e.target.value)}
                      className="font-mono text-sm touch-manipulation min-h-[44px]"
                    />
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setFixMintDialogOpen(false)}
                      disabled={fixingMint}
                      className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleFixNftMint}
                      disabled={fixingMint || !fixMintInput.trim()}
                      className="bg-blue-600 hover:bg-blue-700 touch-manipulation min-h-[44px] w-full sm:w-auto"
                    >
                      {fixingMint ? 'Updating...' : 'Update mint address'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {isCancelled && raffle.cancelled_at && (
              <p className="text-sm text-muted-foreground">
                Cancelled at {new Date(raffle.cancelled_at).toLocaleString()}. Ticket buyers get refunds (see list below).
                {raffle.cancellation_refund_policy === 'no_refund' &&
                  raffle.cancellation_fee_amount != null &&
                  ` Host charged cancellation fee: ${raffle.cancellation_fee_amount} ${raffle.cancellation_fee_currency ?? 'SOL'}.`}
              </p>
            )}
            {/* Refund list for treasury admin — ticket buyers get refunds whenever a raffle is cancelled */}
            {isCancelled && (() => {
              const confirmed = entries.filter((e) => e.status === 'confirmed' && e.raffle_id === raffle.id)
              const currency = raffle.currency || 'SOL'
              const byWallet = new Map<string, number>()
              for (const e of confirmed) {
                const w = (e.wallet_address || '').trim()
                if (!w) continue
                byWallet.set(w, (byWallet.get(w) ?? 0) + e.amount_paid)
              }
              const refundList = Array.from(byWallet.entries()).map(([wallet, amount]) => ({
                wallet,
                amount,
                currency,
              }))
              if (refundList.length === 0) return null
              const copyText = refundList
                .map((r) => `${r.wallet},${r.amount},${r.currency}`)
                .join('\n')
              const copyCsv = () => {
                const header = 'wallet,amount,currency\n'
                if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(header + copyText).then(() => {}).catch(() => {})
                }
              }
              return (
                <Card className="border-green-500/30 bg-green-500/5 mt-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Refund list for treasury admin</CardTitle>
                    <CardDescription>
                      Ticket buyers get refunds whenever a raffle is cancelled. Treasury admin sends these amounts from the treasury wallet (per-wallet totals). Within 24h: no fee to host. After 24h: host is also charged a cancellation fee.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={copyCsv} className="touch-manipulation min-h-[44px]">
                        Copy as CSV
                      </Button>
                    </div>
                    <div className="max-h-64 overflow-auto rounded border border-border bg-muted/30 p-2 text-sm -mx-1">
                      <table className="w-full table-fixed">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="w-8">#</th>
                            <th className="truncate pr-2">Wallet</th>
                            <th className="text-right whitespace-nowrap">Amount</th>
                            <th className="w-16">Curr</th>
                          </tr>
                        </thead>
                        <tbody>
                          {refundList.map((r, i) => (
                            <tr key={r.wallet} className="border-t border-border/50">
                              <td className="py-1">{i + 1}</td>
                              <td className="truncate font-mono text-xs pr-2" title={r.wallet}>{r.wallet}</td>
                              <td className="text-right font-mono whitespace-nowrap">
                                {r.currency === 'USDC' ? r.amount.toFixed(2) : r.amount.toFixed(6)}
                              </td>
                              <td>{r.currency}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )
            })()}
            {/* Return NFT — always show for NFT raffles so the action is visible */}
            {isNftRaffle ? (
              <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10 touch-manipulation min-h-[44px]"
                    onClick={() => canReturnNft && setReturnDialogOpen(true)}
                    disabled={returning || !canReturnNft}
                  >
                    <ArrowLeftCircle className="h-4 w-4 mr-2 shrink-0" />
                    Return NFT to creator
                  </Button>
                  {!canReturnNft && (
                    <span className="text-sm text-muted-foreground">
                      {raffle.prize_returned_at
                        ? '(Already returned)'
                        : raffle.nft_transfer_transaction
                          ? '(Prize sent to winner)'
                          : !raffle.prize_deposited_at
                            ? '(Prize not in escrow yet)'
                            : !creatorWallet
                              ? '(No creator wallet)'
                              : '(Not available)'}
                    </span>
                  )}
                </div>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Return NFT to creator</DialogTitle>
                    <DialogDescription>
                      Send the raffle prize NFT from escrow back to the creator&apos;s wallet (
                      <code className="text-xs">{creatorWallet}</code>). Choose a reason for
                      records.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-4">
                    <Label>Reason</Label>
                    <select
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      className="flex h-11 sm:h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm touch-manipulation"
                    >
                      {PRIZE_RETURN_REASONS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setReturnDialogOpen(false)}
                      disabled={returning}
                      className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleReturnNft}
                      disabled={returning}
                      className="bg-amber-600 hover:bg-amber-700 touch-manipulation min-h-[44px] w-full sm:w-auto"
                    >
                      {returning ? 'Returning...' : 'Return NFT'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <p className="text-sm text-muted-foreground">This raffle has no NFT prize.</p>
            )}

            <div className="pt-2">
              <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={deleting}
                  className="touch-manipulation min-h-[44px]"
                >
                  <Trash2 className="h-4 w-4 mr-2 shrink-0" />
                  Delete raffle
                </Button>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Delete raffle</DialogTitle>
                    <DialogDescription>
                      Permanently delete &quot;{raffle.title}&quot; and all its entries. This cannot
                      be undone.
                      {canReturnNft && (
                        <span className="block mt-2 text-amber-600 dark:text-amber-400">
                          For NFT raffles, return the NFT to the creator first so they get their
                          prize back.
                        </span>
                      )}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setDeleteDialogOpen(false)}
                      disabled={deleting}
                      className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                    >
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="touch-manipulation min-h-[44px] w-full sm:w-auto">
                      {deleting ? 'Deleting...' : 'Delete raffle'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Public page</CardTitle>
            <CardDescription>View this raffle as visitors see it.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={`/raffles/${raffle.slug}`}
              className="text-primary hover:underline touch-manipulation inline-flex items-center min-h-[44px] break-all"
              target="_blank"
              rel="noopener noreferrer"
            >
              /raffles/{raffle.slug}
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
