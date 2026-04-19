'use client'

import { useState, useEffect, useCallback } from 'react'
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
import {
  ADMIN_HARD_DELETE_REASON_MAX_CHARS,
  ADMIN_HARD_DELETE_REASON_MIN_CHARS,
} from '@/lib/raffles/admin-hard-delete'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Trash2, ArrowLeftCircle, XCircle, Ban, CheckCircle, Send } from 'lucide-react'
import type { Raffle, Entry } from '@/lib/types'
import Link from 'next/link'
import { getRaffleMinimum } from '@/lib/db/raffles'
import { AdminManualRefundRecorder } from '@/components/AdminManualRefundRecorder'

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
  { value: 'min_threshold_not_met', label: 'Min tickets not met (after extension)' },
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
  const [deleteReason, setDeleteReason] = useState('')
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
  const [sendingPrizeToWinner, setSendingPrizeToWinner] = useState(false)
  const [imageFallbackInput, setImageFallbackInput] = useState(raffle.image_fallback_url ?? '')
  const [savingImageFallback, setSavingImageFallback] = useState(false)

  useEffect(() => {
    setImageFallbackInput(raffle.image_fallback_url ?? '')
  }, [raffle.id, raffle.image_fallback_url])

  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  const isNftRaffle = raffle.prize_type === 'nft' && !!raffle.nft_mint_address

  const noWinner =
    !(raffle.winner_wallet ?? '').trim() && !raffle.winner_selected_at
  const statusLc = (raffle.status ?? '').toLowerCase()
  /** Ended or terminal-ish states where full admin can set a new end_time and return sales/draw flow (no winner, prize still in escrow). */
  const RESTORE_ELIGIBLE_STATUSES = [
    'live',
    'ready_to_draw',
    'pending_min_not_met',
    'failed_refund_available',
    'cancelled',
    'completed',
  ] as const

  const canOverrideNftEconomics =
    raffle.prize_type === 'nft' &&
    noWinner &&
    RESTORE_ELIGIBLE_STATUSES.includes(statusLc as (typeof RESTORE_ELIGIBLE_STATUSES)[number])

  const canDeadlineAdminOverride =
    noWinner &&
    !raffle.prize_returned_at &&
    RESTORE_ELIGIBLE_STATUSES.includes(statusLc as (typeof RESTORE_ELIGIBLE_STATUSES)[number])

  const hasWinner =
    !!(raffle.winner_wallet ?? '').trim() || !!raffle.winner_selected_at
  const canVoidWinner =
    hasWinner &&
    !raffle.prize_returned_at &&
    !(raffle.nft_transfer_transaction ?? '').trim() &&
    !raffle.creator_claimed_at &&
    !(raffle.creator_funds_claim_locked_at ?? '').trim()

  const voidWinnerBlockedReason =
    hasWinner && !canVoidWinner
      ? raffle.prize_returned_at
        ? 'Prize was returned to the creator — resolve escrow before changing draw state.'
        : (raffle.nft_transfer_transaction ?? '').trim()
          ? 'NFT transfer to the winner is already on-chain; the app cannot void this draw.'
          : raffle.creator_claimed_at
            ? 'Creator already claimed funds-escrow proceeds.'
            : (raffle.creator_funds_claim_locked_at ?? '').trim()
              ? 'Funds claim is in progress (lock). Retry when idle.'
              : 'Void winner is not available.'
      : null

  const [nftMinInput, setNftMinInput] = useState('')
  const [nftFloorInput, setNftFloorInput] = useState('')
  const [nftTicketInput, setNftTicketInput] = useState('')
  const [nftMaxInput, setNftMaxInput] = useState('')
  const [nftEconomicsConfirm, setNftEconomicsConfirm] = useState(false)
  const [savingNftEconomics, setSavingNftEconomics] = useState(false)

  const [reopenEndLocal, setReopenEndLocal] = useState('')
  const [reopenStatus, setReopenStatus] = useState<'live' | 'ready_to_draw'>('live')
  const [reopenExtCount, setReopenExtCount] = useState('')
  const [reopenDeadlineConfirm, setReopenDeadlineConfirm] = useState(false)
  /** Extra acknowledgement when lifting `cancelled` (refunds may have been processed). */
  const [reopenRestoreCancelledConfirm, setReopenRestoreCancelledConfirm] = useState(false)
  const [savingDeadline, setSavingDeadline] = useState(false)

  const [voidEndLocal, setVoidEndLocal] = useState('')
  const [voidStatus, setVoidStatus] = useState<'live' | 'ready_to_draw'>('live')
  const [voidWinnerConfirm, setVoidWinnerConfirm] = useState(false)
  const [savingVoidWinner, setSavingVoidWinner] = useState(false)

  const resetNftEconomicsForm = useCallback((r: Raffle) => {
    const eff = getRaffleMinimum(r)
    setNftMinInput(
      eff != null ? String(eff) : r.min_tickets != null ? String(r.min_tickets) : ''
    )
    setNftFloorInput(r.floor_price ?? '')
    setNftTicketInput(
      r.ticket_price != null && Number.isFinite(r.ticket_price) ? String(r.ticket_price) : ''
    )
    setNftMaxInput(r.max_tickets != null ? String(r.max_tickets) : '')
    setNftEconomicsConfirm(false)
  }, [])

  useEffect(() => {
    if (canOverrideNftEconomics) {
      resetNftEconomicsForm(raffle)
    }
  }, [raffle, canOverrideNftEconomics, resetNftEconomicsForm])

  useEffect(() => {
    if (!canDeadlineAdminOverride) return
    const d = new Date(Date.now() + 72 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    setReopenEndLocal(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    )
    setReopenStatus('live')
    setReopenExtCount('')
    setReopenDeadlineConfirm(false)
    setReopenRestoreCancelledConfirm(false)
  }, [raffle.id, canDeadlineAdminOverride])

  useEffect(() => {
    if (!canVoidWinner) return
    const d = new Date(Date.now() + 72 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    setVoidEndLocal(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    )
    setVoidStatus('live')
    setVoidWinnerConfirm(false)
  }, [raffle.id, canVoidWinner])

  const purchasesBlocked = !!(raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
  const pendingSectionEligible = isNftRaffle
  const canReturnNft =
    isNftRaffle &&
    !!creatorWallet &&
    !!raffle.prize_deposited_at &&
    !!raffle.prize_deposit_tx &&
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

  const canAdminSendPrizeFromEscrow =
    isNftRaffle &&
    !isCancelled &&
    !!raffle.prize_deposited_at &&
    !!(raffle.winner_wallet ?? '').trim() &&
    !raffle.nft_transfer_transaction &&
    !raffle.prize_returned_at

  const handleSendPrizeFromEscrow = async () => {
    setSendingPrizeToWinner(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/admin-send-prize-to-winner`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && (data.success || data.alreadySent)) {
        setMessage({
          type: 'success',
          text:
            typeof data.transactionSignature === 'string'
              ? `Prize sent to winner from escrow. TX: ${data.transactionSignature}`
              : data.alreadySent
                ? 'Prize was already sent to the winner (signature on file).'
                : 'Prize sent to winner from escrow.',
        })
        router.refresh()
      } else {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Failed to send prize from escrow',
        })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to send prize from escrow',
      })
    } finally {
      setSendingPrizeToWinner(false)
    }
  }

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

  const handleSaveImageFallback = async () => {
    setSavingImageFallback(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          image_fallback_url: imageFallbackInput.trim() ? imageFallbackInput.trim() : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({ type: 'success', text: 'Fallback listing image saved.' })
        router.refresh()
      } else {
        setMessage({ type: 'error', text: typeof data?.error === 'string' ? data.error : 'Failed to save' })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to save',
      })
    } finally {
      setSavingImageFallback(false)
    }
  }

  const handleSaveNftEconomics = async () => {
    setMessage(null)
    const minParsed = parseInt(nftMinInput.trim(), 10)
    if (!Number.isFinite(minParsed) || minParsed <= 0) {
      setMessage({ type: 'error', text: 'Draw threshold must be a positive whole number.' })
      return
    }
    if (!nftFloorInput.trim()) {
      setMessage({ type: 'error', text: 'Floor price is required.' })
      return
    }
    const tp = parseFloat(nftTicketInput.trim())
    if (!Number.isFinite(tp) || tp <= 0) {
      setMessage({ type: 'error', text: 'Ticket price must be a positive number.' })
      return
    }
    if (!nftEconomicsConfirm) {
      setMessage({
        type: 'error',
        text: 'Check the box to confirm you intend to change live NFT ticket economics.',
      })
      return
    }

    const payload: Record<string, unknown> = {
      nft_economics_admin_override: true,
      min_tickets: minParsed,
      floor_price: nftFloorInput.trim(),
      ticket_price: tp,
    }
    if (nftMaxInput.trim() !== '') {
      const m = parseInt(nftMaxInput.trim(), 10)
      if (!Number.isFinite(m) || m <= 0) {
        setMessage({ type: 'error', text: 'Max tickets must be a positive whole number or left empty.' })
        return
      }
      payload.max_tickets = m
    }

    setSavingNftEconomics(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({
          type: 'success',
          text: 'NFT draw threshold and economics updated. Public page will reflect changes after refresh.',
        })
        setNftEconomicsConfirm(false)
        router.refresh()
      } else {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Failed to update economics',
        })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to update economics',
      })
    } finally {
      setSavingNftEconomics(false)
    }
  }

  const handleSaveDeadline = async () => {
    setMessage(null)
    if (!reopenDeadlineConfirm) {
      setMessage({ type: 'error', text: 'Confirm deadline change before saving.' })
      return
    }
    if (statusLc === 'cancelled' && !reopenRestoreCancelledConfirm) {
      setMessage({
        type: 'error',
        text: 'Confirm restoring from cancelled: check refunds and treasury state before saving.',
      })
      return
    }
    const end = new Date(reopenEndLocal)
    if (!Number.isFinite(end.getTime())) {
      setMessage({ type: 'error', text: 'Invalid end date/time.' })
      return
    }
    if (end.getTime() <= Date.now()) {
      setMessage({ type: 'error', text: 'End time must be in the future.' })
      return
    }

    const body: Record<string, unknown> = {
      raffle_deadline_admin_override: true,
      end_time: end.toISOString(),
      status: reopenStatus,
    }
    if (reopenExtCount.trim() !== '') {
      const n = parseInt(reopenExtCount.trim(), 10)
      if (!Number.isFinite(n) || n < 0 || n > 10) {
        setMessage({
          type: 'error',
          text: 'Extension count must be between 0 and 10, or leave empty to keep the current value.',
        })
        return
      }
      body.time_extension_count = n
    }

    setSavingDeadline(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({
          type: 'success',
          text: 'Deadline updated. Raffle is open again for the new end time (status and is_active adjusted).',
        })
        setReopenDeadlineConfirm(false)
        router.refresh()
      } else {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Failed to update deadline',
        })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to update deadline',
      })
    } finally {
      setSavingDeadline(false)
    }
  }

  const handleVoidWinner = async () => {
    setMessage(null)
    if (!voidWinnerConfirm) {
      setMessage({ type: 'error', text: 'Confirm void winner before saving.' })
      return
    }
    const end = new Date(voidEndLocal)
    if (!Number.isFinite(end.getTime())) {
      setMessage({ type: 'error', text: 'Invalid end date/time.' })
      return
    }
    if (end.getTime() <= Date.now()) {
      setMessage({ type: 'error', text: 'End time must be in the future.' })
      return
    }

    setSavingVoidWinner(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          void_winner_admin_override: true,
          confirm_void_winner: true,
          end_time: end.toISOString(),
          status: voidStatus,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({
          type: 'success',
          text: 'Winner voided in the database. Set correct draw economics if needed, then monitor sales and redraw.',
        })
        setVoidWinnerConfirm(false)
        router.refresh()
      } else {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Failed to void winner',
        })
      }
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Failed to void winner',
      })
    } finally {
      setSavingVoidWinner(false)
    }
  }

  const handleDelete = async () => {
    const trimmedReason = deleteReason.trim()
    if (trimmedReason.length < ADMIN_HARD_DELETE_REASON_MIN_CHARS) {
      setMessage({
        type: 'error',
        text: `Enter a delete reason (at least ${ADMIN_HARD_DELETE_REASON_MIN_CHARS} characters), e.g. duplicate NFT listing cleanup.`,
      })
      return
    }
    if (trimmedReason.length > ADMIN_HARD_DELETE_REASON_MAX_CHARS) {
      setMessage({
        type: 'error',
        text: `Delete reason must be at most ${ADMIN_HARD_DELETE_REASON_MAX_CHARS} characters.`,
      })
      return
    }
    setDeleting(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ delete_reason: trimmedReason }),
      })
      const data = await res.json()
      if (res.ok) {
        setDeleteDialogOpen(false)
        setDeleteReason('')
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

        <AdminManualRefundRecorder
          raffleId={raffle.id}
          raffleCurrency={raffle.currency || 'SOL'}
          entries={entries}
          onRecorded={() => router.refresh()}
          adminFundsEscrowRefundEnabled={raffle.status === 'failed_refund_available'}
        />

        <Card>
          <CardHeader>
            <CardTitle>Listing artwork fallback</CardTitle>
            <CardDescription>
              If the prize NFT image fails to load (broken IPFS, etc.), this URL is shown on raffle cards and the detail page after normal fallbacks. Use HTTPS or ipfs://. Clear the field and save to remove.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="admin-image-fallback">Image URL</Label>
            <Input
              id="admin-image-fallback"
              value={imageFallbackInput}
              onChange={(e) => setImageFallbackInput(e.target.value)}
              placeholder="https://… or ipfs://…"
              className="font-mono text-sm touch-manipulation min-h-[44px]"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveImageFallback}
              disabled={savingImageFallback}
              className="touch-manipulation min-h-[44px] w-full sm:w-auto"
            >
              {savingImageFallback ? 'Saving…' : 'Save fallback image'}
            </Button>
          </CardContent>
        </Card>

        {canOverrideNftEconomics && (
          <Card className="border-amber-600/40 bg-amber-500/[0.07]">
            <CardHeader>
              <CardTitle>NFT draw goal &amp; ticket economics (full admin)</CardTitle>
              <CardDescription>
                The database does not keep the previous draw threshold after it is changed. To recover
                originals, use Supabase backups / point-in-time recovery, internal analytics, or listing
                copy you trust — then set values here. Changing ticket price affects what new buyers pay;
                align floor, ticket price, and draw goal so round(floor ÷ ticket) is consistent with your
                min tickets (the API enforces max cap and max ≥ min).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-nft-min">Draw threshold (tickets)</Label>
                  <Input
                    id="admin-nft-min"
                    inputMode="numeric"
                    value={nftMinInput}
                    onChange={(e) => setNftMinInput(e.target.value)}
                    className="touch-manipulation min-h-[44px]"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-nft-max">Max tickets (optional)</Label>
                  <Input
                    id="admin-nft-max"
                    inputMode="numeric"
                    value={nftMaxInput}
                    onChange={(e) => setNftMaxInput(e.target.value)}
                    placeholder="Leave empty for unlimited"
                    className="touch-manipulation min-h-[44px]"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="admin-nft-floor">Floor price (text, raffle currency)</Label>
                  <Input
                    id="admin-nft-floor"
                    value={nftFloorInput}
                    onChange={(e) => setNftFloorInput(e.target.value)}
                    className="touch-manipulation min-h-[44px] font-mono text-sm"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="admin-nft-ticket">Ticket price</Label>
                  <Input
                    id="admin-nft-ticket"
                    inputMode="decimal"
                    value={nftTicketInput}
                    onChange={(e) => setNftTicketInput(e.target.value)}
                    className="touch-manipulation min-h-[44px] font-mono text-sm"
                    autoComplete="off"
                  />
                </div>
              </div>
              <label className="flex items-start gap-3 text-sm cursor-pointer touch-manipulation min-h-[44px] py-1">
                <input
                  type="checkbox"
                  checked={nftEconomicsConfirm}
                  onChange={(e) => setNftEconomicsConfirm(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-input"
                  aria-label="Confirm changing live NFT ticket economics"
                />
                <span className="text-muted-foreground leading-snug">
                  I confirm this raffle is live (or pending min) and I intend to change draw threshold
                  and/or ticket pricing shown to buyers.
                </span>
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveNftEconomics}
                disabled={savingNftEconomics}
                className="touch-manipulation min-h-[44px] w-full sm:w-auto border-amber-600/50"
              >
                {savingNftEconomics ? 'Saving…' : 'Save NFT economics'}
              </Button>
            </CardContent>
          </Card>
        )}

        {voidWinnerBlockedReason && (
          <Card className="border-muted">
            <CardHeader className="py-3">
              <CardTitle className="text-base">Winner already selected</CardTitle>
              <CardDescription className="text-amber-700 dark:text-amber-400">
                {voidWinnerBlockedReason}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {canVoidWinner && (
          <Card className="border-destructive/40 bg-destructive/[0.06]">
            <CardHeader>
              <CardTitle>Void winner &amp; reopen raffle (full admin)</CardTitle>
              <CardDescription>
                Use only for a <strong>bad draw</strong> (e.g. wrong min_tickets) when the NFT is{' '}
                <strong>still in escrow</strong> (no prize TX to winner) and the creator has{' '}
                <strong>not</strong> claimed funds-escrow proceeds. Clears winner, settlement fields, and
                claim locks in the database, then sets a new <strong>end time</strong> and{' '}
                <strong>live</strong> or <strong>ready_to_draw</strong>. Does <strong>not</strong> undo an
                on-chain NFT transfer or a completed claim.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm font-mono text-muted-foreground break-all">
                Current winner: {(raffle.winner_wallet ?? '').trim() || '—'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="admin-void-winner-end">New end time (after reopen)</Label>
                  <Input
                    id="admin-void-winner-end"
                    type="datetime-local"
                    value={voidEndLocal}
                    onChange={(e) => setVoidEndLocal(e.target.value)}
                    className="touch-manipulation min-h-[44px]"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="admin-void-winner-status">Status after void</Label>
                  <select
                    id="admin-void-winner-status"
                    value={voidStatus}
                    onChange={(e) => setVoidStatus(e.target.value as 'live' | 'ready_to_draw')}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background touch-manipulation min-h-[44px]"
                  >
                    <option value="live">live (ticket sales)</option>
                    <option value="ready_to_draw">ready_to_draw (ended, draw again later)</option>
                  </select>
                </div>
              </div>
              <label className="flex items-start gap-3 text-sm cursor-pointer touch-manipulation min-h-[44px] py-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <input
                  type="checkbox"
                  checked={voidWinnerConfirm}
                  onChange={(e) => setVoidWinnerConfirm(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-input"
                  aria-label="Confirm voiding winner and reopening raffle"
                />
                <span className="text-muted-foreground leading-snug">
                  I confirm the prize was <strong className="text-foreground">not</strong> sent to the winner
                  on-chain, proceeds were <strong className="text-foreground">not</strong> claimed, and I am
                  intentionally voiding this draw to fix platform data. I will communicate with buyers if
                  needed.
                </span>
              </label>
              <Button
                type="button"
                variant="destructive"
                onClick={handleVoidWinner}
                disabled={savingVoidWinner}
                className="touch-manipulation min-h-[44px] w-full sm:w-auto"
              >
                {savingVoidWinner ? 'Saving…' : 'Void winner & reopen'}
              </Button>
            </CardContent>
          </Card>
        )}

        {canDeadlineAdminOverride && (
          <Card className="border-sky-600/40 bg-sky-500/[0.07]">
            <CardHeader>
              <CardTitle>Restore ended raffle / extend deadline (full admin)</CardTitle>
              <CardDescription>
                For raffles that ended or were marked cancelled / failed-refund / completed <strong>with no
                winner</strong> — e.g. wrong draw threshold (e.g. min_tickets forced to 50). Sets a new{' '}
                <strong>end time in the future</strong>, moves status to <strong>live</strong> (or
                ready_to_draw), turns <strong>is_active</strong> on for live, and for{' '}
                <strong>cancelled</strong> clears cancellation timestamps so the listing is operational again.
                Correct NFT draw threshold in the economics card before or after. If purchases are blocked,
                clear that separately. Restoring <strong>cancelled</strong> may be wrong if buyers were already
                refunded — confirm treasury and support first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="admin-reopen-end">New end time</Label>
                  <Input
                    id="admin-reopen-end"
                    type="datetime-local"
                    value={reopenEndLocal}
                    onChange={(e) => setReopenEndLocal(e.target.value)}
                    className="touch-manipulation min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-reopen-status">Status after save</Label>
                  <select
                    id="admin-reopen-status"
                    value={reopenStatus}
                    onChange={(e) => setReopenStatus(e.target.value as 'live' | 'ready_to_draw')}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background touch-manipulation min-h-[44px]"
                  >
                    <option value="live">live (ticket sales)</option>
                    <option value="ready_to_draw">ready_to_draw (ended, draw winner)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-reopen-ext">time_extension_count (optional)</Label>
                  <Input
                    id="admin-reopen-ext"
                    inputMode="numeric"
                    value={reopenExtCount}
                    onChange={(e) => setReopenExtCount(e.target.value)}
                    placeholder="Leave empty to keep DB value"
                    className="touch-manipulation min-h-[44px]"
                    autoComplete="off"
                  />
                </div>
              </div>
              <label className="flex items-start gap-3 text-sm cursor-pointer touch-manipulation min-h-[44px] py-1">
                <input
                  type="checkbox"
                  checked={reopenDeadlineConfirm}
                  onChange={(e) => setReopenDeadlineConfirm(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-input"
                  aria-label="Confirm extending raffle deadline"
                />
                <span className="text-muted-foreground leading-snug">
                  I confirm this raffle has no winner yet and I am intentionally changing the end time and
                  status.
                </span>
              </label>
              {statusLc === 'cancelled' && (
                <label className="flex items-start gap-3 text-sm cursor-pointer touch-manipulation min-h-[44px] py-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <input
                    type="checkbox"
                    checked={reopenRestoreCancelledConfirm}
                    onChange={(e) => setReopenRestoreCancelledConfirm(e.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 rounded border-input"
                    aria-label="Confirm restoring raffle from cancelled status"
                  />
                  <span className="text-muted-foreground leading-snug">
                    This raffle is <strong className="text-foreground">cancelled</strong>. I have checked
                    refunds and support impact; I still want to clear cancellation fields and reopen sales
                    (or ready_to_draw) with the new end time.
                  </span>
                </label>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveDeadline}
                disabled={savingDeadline}
                className="touch-manipulation min-h-[44px] w-full sm:w-auto border-sky-600/50"
              >
                {savingDeadline ? 'Saving…' : 'Save / restore raffle'}
              </Button>
            </CardContent>
          </Card>
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
            {canAdminSendPrizeFromEscrow && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Winner prize — escrow transfer
                </p>
                <p className="text-xs text-muted-foreground">
                  If the winner&apos;s &quot;Claim prize&quot; fails (RPC, frozen token account, wallet ATA, etc.), try this
                  first—it signs the same path as claim from the platform escrow key. If the escrow SPL account is frozen
                  and you have no thaw key, send the NFT to the winner with a wallet that can thaw (e.g. collection
                  authority), then use <strong>Record NFT transfer</strong> on the raffle page to paste the Solana
                  signature. Clears any stuck claim lock first.
                </p>
                <Button
                  type="button"
                  className="bg-emerald-600 hover:bg-emerald-700 touch-manipulation min-h-[44px]"
                  disabled={sendingPrizeToWinner}
                  onClick={handleSendPrizeFromEscrow}
                >
                  <Send className="h-4 w-4 mr-2 shrink-0" />
                  {sendingPrizeToWinner ? 'Sending…' : 'Send prize from escrow to winner'}
                </Button>
              </div>
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
              const confirmed = entries.filter(
                (e) =>
                  e.status === 'confirmed' &&
                  e.raffle_id === raffle.id &&
                  !e.refunded_at
              )
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
            {/* Return NFT — show only when escrow return is actually possible */}
            {canReturnNft ? (
              <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10 touch-manipulation min-h-[44px]"
                    onClick={() => setReturnDialogOpen(true)}
                    disabled={returning}
                  >
                    <ArrowLeftCircle className="h-4 w-4 mr-2 shrink-0" />
                    Return NFT to creator
                  </Button>
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
            ) : null}

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
                  <div className="space-y-2 py-2">
                    <Label htmlFor="admin-delete-reason">Delete reason (required)</Label>
                    <textarea
                      id="admin-delete-reason"
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      placeholder="e.g. Duplicate listing for the same NFT — removing the extra draft after migration 070."
                      maxLength={ADMIN_HARD_DELETE_REASON_MAX_CHARS}
                      rows={4}
                      className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground">
                      {ADMIN_HARD_DELETE_REASON_MIN_CHARS}–{ADMIN_HARD_DELETE_REASON_MAX_CHARS} characters. Logged for audit.
                    </p>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setDeleteDialogOpen(false)}
                      disabled={deleting}
                      className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={
                        deleting ||
                        deleteReason.trim().length < ADMIN_HARD_DELETE_REASON_MIN_CHARS
                      }
                      className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                    >
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
