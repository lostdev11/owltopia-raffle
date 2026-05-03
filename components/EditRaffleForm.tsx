'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { OwlVisionBadge } from '@/components/OwlVisionBadge'
import type { Raffle, Entry, OwlVisionScore } from '@/lib/types'
import {
  getThemeAccentBorderStyle,
  getThemeAccentClasses,
  THEME_ACCENT_SELECT_OPTIONS,
} from '@/lib/theme-accent'
import { AlertCircle, ArrowLeftCircle, RotateCcw, Trash2, Trophy } from 'lucide-react'
import { utcToLocalDateTime, localDateTimeToUtc } from '@/lib/utils'
import {
  canSelectWinner,
  isRaffleEligibleToDraw,
  calculateTicketsSold,
  getRaffleMinimum,
} from '@/lib/db/raffles'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import {
  NFT_DEFAULT_SUGGEST_TICKET_COUNT,
  computeNftMinTicketsFromFloorAndTicket,
  parseNftFloorPrice,
  parseNftTicketPrice,
} from '@/lib/raffles/nft-raffle-economics'
import {
  ADMIN_HARD_DELETE_REASON_MAX_CHARS,
  ADMIN_HARD_DELETE_REASON_MIN_CHARS,
} from '@/lib/raffles/admin-hard-delete'

interface EditRaffleFormProps {
  raffle: Raffle
  entries: Entry[]
  owlVisionScore: OwlVisionScore
}

interface LiveRaffleXTemplate {
  id: string
  label: string
  text: string
  intentUrl: string
}

function prizeSummary(raffle: Raffle): string {
  if (raffle.prize_type === 'nft') {
    const name = raffle.nft_collection_name?.trim()
    return name ? `NFT - ${name}` : 'NFT prize'
  }
  const amount = raffle.prize_amount
  const currency = raffle.prize_currency?.trim() || 'SOL'
  if (amount != null && Number.isFinite(Number(amount))) {
    return `${amount} ${currency}`
  }
  return `${currency} prize`
}

function buildXIntentUrl(text: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
}

export function EditRaffleForm({ raffle, entries, owlVisionScore }: EditRaffleFormProps) {
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const wallet = publicKey?.toBase58() ?? ''
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )
  const [adminRole, setAdminRole] = useState<'full' | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [adminHardDeleteReason, setAdminHardDeleteReason] = useState('')
  const [entriesList, setEntriesList] = useState<Entry[]>(entries)
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null)
  const [selectingWinner, setSelectingWinner] = useState(false)
  const [winnerMessage, setWinnerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [forceOverride, setForceOverride] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreExtension, setRestoreExtension] = useState<24 | 72 | 168>(24) // 24h, 3 days, 7 days
  const [returnNftDialogOpen, setReturnNftDialogOpen] = useState(false)
  const [returningNft, setReturningNft] = useState(false)
  const [returnNftReason, setReturnNftReason] = useState<string>('cancelled')
  const isDraft = (raffle.status ?? '').toLowerCase() === 'draft'
  const isDraftNft = isDraft && raffle.prize_type === 'nft'
  const isNonDraftNft = !isDraft && raffle.prize_type === 'nft'
  const [nftDraftFloor, setNftDraftFloor] = useState(raffle.floor_price ?? '')
  const [nftDraftTicket, setNftDraftTicket] = useState(
    raffle.ticket_price != null ? String(raffle.ticket_price) : ''
  )
  useEffect(() => {
    setNftDraftFloor(raffle.floor_price ?? '')
    setNftDraftTicket(raffle.ticket_price != null ? String(raffle.ticket_price) : '')
  }, [raffle.id, raffle.floor_price, raffle.ticket_price])

  const noWinnerNft = !(raffle.winner_wallet ?? '').trim() && !raffle.winner_selected_at
  const statusLcNft = (raffle.status ?? '').toLowerCase()
  const allowNftEconomicsStatuses = new Set([
    'live',
    'ready_to_draw',
    'pending_min_not_met',
    'failed_refund_available',
    'cancelled',
    'completed',
  ])
  const canOverrideNftEconomics =
    isNonDraftNft && noWinnerNft && allowNftEconomicsStatuses.has(statusLcNft)

  const [nftLiveEconomicsConfirm, setNftLiveEconomicsConfirm] = useState(false)
  useEffect(() => {
    setNftLiveEconomicsConfirm(false)
  }, [raffle.id])

  const nftComputedMin = useMemo(() => {
    const forDraftOrAdminNft =
      isDraftNft || (isNonDraftNft && canOverrideNftEconomics)
    if (!forDraftOrAdminNft) return null
    const fp = parseNftFloorPrice(nftDraftFloor)
    const tp = parseNftTicketPrice(nftDraftTicket)
    if (!fp.ok || !tp.ok) return null
    return computeNftMinTicketsFromFloorAndTicket(fp.value, tp.value)
  }, [
    isDraftNft,
    isNonDraftNft,
    canOverrideNftEconomics,
    nftDraftFloor,
    nftDraftTicket,
  ])
  const hasSettlement =
    !!raffle.settled_at &&
    raffle.platform_fee_amount != null &&
    raffle.creator_payout_amount != null &&
    raffle.fee_bps_applied != null &&
    typeof raffle.fee_tier_reason === 'string'
  const xTemplates = useMemo<LiveRaffleXTemplate[]>(() => {
    const siteBase = (
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://www.owltopia.xyz')
    ).replace(/\/$/, '')
    const raffleUrl = `${siteBase}/raffles/${encodeURIComponent(raffle.slug)}`
    const title = raffle.title.trim()
    const compactTitle = title.length > 72 ? `${title.slice(0, 69)}...` : title
    const prize = prizeSummary(raffle)
    const platformName = (process.env.NEXT_PUBLIC_PLATFORM_NAME || 'Owl Raffle').trim()
    const templates: Array<Omit<LiveRaffleXTemplate, 'intentUrl'>> = [
      {
        id: 'launch',
        label: 'Launch',
        text: `New raffle is LIVE on ${platformName}: "${compactTitle}"\nPrize: ${prize}\nEnter now: ${raffleUrl}\n#Solana #NFT #Raffle`,
      },
      {
        id: 'hype',
        label: 'Hype',
        text: `Community fam, this one is heating up.\n"${compactTitle}" is live now on ${platformName}.\nGrab your tickets before it closes: ${raffleUrl}\n#Solana #Web3`,
      },
      {
        id: 'last-call',
        label: 'Last call',
        text: `Last call for "${compactTitle}" on ${platformName}.\nPrize: ${prize}\nFinal entries: ${raffleUrl}\n#Solana #Crypto`,
      },
    ]
    return templates.map((template) => ({
      ...template,
      intentUrl: buildXIntentUrl(template.text),
    }))
  }, [raffle])

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setAdminRole(null)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setIsAdmin(cached)
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role: 'full' | null = admin ? 'full' : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
        setAdminRole(role)
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false)
          setAdminRole(null)
        }
      })
    return () => { cancelled = true }
  }, [connected, publicKey])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    if (!connected || !publicKey) {
      alert('Please connect your wallet to update a raffle')
      return
    }

    if (!isAdmin) {
      alert('Only admins can update raffles')
      return
    }

    const formData = new FormData(e.currentTarget)

    // Validate 7-day maximum duration (skip for extended raffles — they already have a longer end time)
    const startTimeValue = formData.get('start_time') as string
    const endTimeValue = formData.get('end_time') as string
    if (startTimeValue && endTimeValue && !raffle.original_end_time) {
      const startDate = new Date(localDateTimeToUtc(startTimeValue))
      const endDate = new Date(localDateTimeToUtc(endTimeValue))
      const durationMs = endDate.getTime() - startDate.getTime()
      const durationDays = durationMs / (1000 * 60 * 60 * 24)
      
      if (durationDays > 7) {
        alert('Raffle duration cannot exceed 7 days')
        return
      }
    }

    setLoading(true)
    const maxTicketsValue = formData.get('max_tickets') as string
    const rankValue = formData.get('rank') as string

    const data: Record<string, unknown> = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      start_time: localDateTimeToUtc(startTimeValue),
      end_time: localDateTimeToUtc(endTimeValue),
      theme_accent: formData.get('theme_accent') as string,
      status: formData.get('status') as string,
      wallet_address: publicKey.toBase58(),
      rank: rankValue && rankValue.trim() ? rankValue.trim() : null,
    }

    if (isDraftNft) {
      const fp = parseNftFloorPrice(nftDraftFloor)
      if (!fp.ok) {
        alert(fp.error)
        setLoading(false)
        return
      }
      const tp = parseNftTicketPrice(nftDraftTicket)
      if (!tp.ok) {
        alert(tp.error)
        setLoading(false)
        return
      }
      data.ticket_price = tp.value
      data.currency = formData.get('currency') as string
      data.max_tickets = maxTicketsValue ? parseInt(maxTicketsValue, 10) : null
      data.floor_price = fp.string
    } else if (isNonDraftNft) {
      if (adminRole === 'full' && canOverrideNftEconomics) {
        if (!nftLiveEconomicsConfirm) {
          alert('Confirm that you intend to change live ticket economics before saving.')
          setLoading(false)
          return
        }
        const fp = parseNftFloorPrice(nftDraftFloor)
        if (!fp.ok) {
          alert(fp.error)
          setLoading(false)
          return
        }
        const tp = parseNftTicketPrice(nftDraftTicket)
        if (!tp.ok) {
          alert(tp.error)
          setLoading(false)
          return
        }
        const computedMin = computeNftMinTicketsFromFloorAndTicket(fp.value, tp.value)
        data.nft_economics_admin_override = true
        data.floor_price = fp.string
        data.ticket_price = tp.value
        data.min_tickets = computedMin
        const cur = (formData.get('currency') as string | null)?.trim()
        if (cur) {
          data.currency = cur
        }
        if (maxTicketsValue?.trim()) {
          const parsed = parseInt(maxTicketsValue.trim(), 10)
          if (!Number.isFinite(parsed) || parsed <= 0) {
            alert('Max tickets must be a positive whole number, or leave empty to keep the current cap.')
            setLoading(false)
            return
          }
          data.max_tickets = parsed
        }
      }
    } else {
      const minTicketsValue = formData.get('min_tickets') as string
      const floorPriceValue = formData.get('floor_price') as string
      data.ticket_price = parseFloat(formData.get('ticket_price') as string)
      data.currency = formData.get('currency') as string
      data.max_tickets = maxTicketsValue ? parseInt(maxTicketsValue, 10) : null
      data.min_tickets = minTicketsValue ? parseInt(minTicketsValue, 10) : null
      data.floor_price = floorPriceValue && floorPriceValue.trim() ? floorPriceValue.trim() : null
    }
    if (adminRole !== null) {
      const fb = (formData.get('image_fallback_url') as string)?.trim()
      data.image_fallback_url = fb ? fb : null
    }

    try {
      const response = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      })

      if (response.ok) {
        router.push(`/raffles/${raffle.slug}`)
      } else {
        const errorData = await response.json()
        alert(errorData.error || 'Error updating raffle')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error updating raffle')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!connected || !publicKey) {
      alert('Please connect your wallet to delete a raffle')
      return
    }

    if (!isAdmin) {
      alert('Only admins can delete raffles')
      return
    }
    if (isAdmin && adminRole === null) {
      alert('Loading your admin role. Please try again in a moment.')
      return
    }

    const reasonTrimmed = adminHardDeleteReason.trim()
    if (reasonTrimmed.length < ADMIN_HARD_DELETE_REASON_MIN_CHARS) {
      alert(
        `Enter a delete reason (${ADMIN_HARD_DELETE_REASON_MIN_CHARS}–${ADMIN_HARD_DELETE_REASON_MAX_CHARS} characters). Required for permanent admin deletes.`
      )
      return
    }
    if (reasonTrimmed.length > ADMIN_HARD_DELETE_REASON_MAX_CHARS) {
      alert(`Delete reason must be at most ${ADMIN_HARD_DELETE_REASON_MAX_CHARS} characters.`)
      return
    }

    setDeleting(true)

    try {
      const response = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58()
        },
        body: JSON.stringify({
          wallet_address: publicKey.toBase58(),
          delete_reason: reasonTrimmed,
        }),
      })

      if (response.ok) {
        setAdminHardDeleteReason('')
        router.push('/admin')
      } else {
        const errorData = await response.json()
        alert(errorData.error || 'Error deleting raffle')
        setDeleteDialogOpen(false)
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error deleting raffle')
      setDeleteDialogOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteEntry = async (entryId: string) => {
    if (!connected || !publicKey) {
      alert('Please connect your wallet to delete an entry')
      return
    }

    if (!isAdmin) {
      alert('Only admins can delete entries')
      return
    }

    if (!confirm('Are you sure you want to delete this entry? This action cannot be undone.')) {
      return
    }

    setDeletingEntryId(entryId)

    try {
      const response = await fetch(`/api/entries/${entryId}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58()
        },
        body: JSON.stringify({ wallet_address: publicKey.toBase58() }),
      })

      if (response.ok) {
        // Remove entry from local state
        setEntriesList(prev => prev.filter(e => e.id !== entryId))
        // Refresh the page to update owl vision score
        router.refresh()
      } else {
        const errorData = await response.json()
        alert(errorData.error || 'Error deleting entry')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error deleting entry')
    } finally {
      setDeletingEntryId(null)
    }
  }

  const handleSelectWinner = async () => {
    if (!connected || !publicKey) {
      alert('Please connect your wallet to select a winner')
      return
    }

    if (!isAdmin) {
      alert('Only admins can select winners')
      return
    }

    setSelectingWinner(true)
    setWinnerMessage(null)

    try {
      const response = await fetch('/api/raffles/select-winners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raffleId: raffle.id, forceOverride }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setWinnerMessage({
          type: 'success',
          text: `Winner selected successfully! Winner: ${data.winnerWallet}`
        })
        // Refresh the page to show the winner
        setTimeout(() => {
          router.refresh()
        }, 2000)
      } else {
        setWinnerMessage({
          type: 'error',
          text: data.error || 'Failed to select winner'
        })
      }
    } catch (error) {
      console.error('Error:', error)
      setWinnerMessage({
        type: 'error',
        text: 'Error selecting winner. Please try again.'
      })
    } finally {
      setSelectingWinner(false)
    }
  }

  const handleRestoreRaffle = async () => {
    if (!connected || !publicKey) {
      alert('Please connect your wallet to restore a raffle')
      return
    }

    if (!isAdmin) {
      alert('Only admins can restore raffles')
      return
    }

    setRestoring(true)

    try {
      const response = await fetch(`/api/raffles/${raffle.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: publicKey.toBase58(),
          extension_hours: restoreExtension,
        }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setRestoreDialogOpen(false)
        alert(data.message || 'Raffle restored successfully.')
        router.refresh()
      } else {
        alert(data.error || 'Failed to restore raffle')
      }
    } catch (error) {
      console.error('Error restoring raffle:', error)
      alert('Error restoring raffle. Please try again.')
    } finally {
      setRestoring(false)
    }
  }

  const creatorWalletRaffle = (raffle.creator_wallet || raffle.created_by || '').trim()
  const isNftRaffle = raffle.prize_type === 'nft' && !!raffle.nft_mint_address
  const canSetNftLive = !isNftRaffle || !!raffle.prize_deposited_at
  const canReturnNftDraft =
    isNftRaffle &&
    !!creatorWalletRaffle &&
    !!raffle.prize_deposited_at &&
    !raffle.nft_transfer_transaction &&
    !raffle.prize_returned_at

  const handleReturnNft = async () => {
    // No wallet signature needed — server signs with escrow keypair; only admin session required
    setReturningNft(true)
    try {
      const res = await fetch(`/api/raffles/${raffle.id}/return-prize-to-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: returnNftReason }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setReturnNftDialogOpen(false)
        router.refresh()
      } else {
        alert(data.error || 'Failed to return NFT to creator')
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to return NFT to creator')
    } finally {
      setReturningNft(false)
    }
  }

  const borderStyle = getThemeAccentBorderStyle(raffle.theme_accent)

  // Show loading state while checking admin status
  if (isAdmin === null) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">Checking admin status...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Show error if not admin or not connected
  if (!connected || !isAdmin) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>
                {!connected 
                  ? 'Please connect your wallet to access this page.'
                  : 'Only admins can edit raffles. Your wallet is not authorized.'}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-4xl font-bold mb-2">Edit Raffle</h1>
          <p className="text-muted-foreground">Update raffle details</p>
        </div>

        {hasSettlement && (
          <Card className="border border-emerald-500/30 bg-emerald-500/5">
            <CardHeader>
              <CardTitle>Settlement (platform fee V1)</CardTitle>
              <CardDescription>Snapshot of the applied platform fee at settlement time.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="font-medium">Gross revenue:</span>{' '}
                {((raffle.platform_fee_amount ?? 0) + (raffle.creator_payout_amount ?? 0)).toFixed(6)}{' '}
                {raffle.currency}
              </p>
              <p>
                <span className="font-medium">Applied fee:</span>{' '}
                {(raffle.fee_bps_applied! / 100).toFixed(2)}% ({raffle.fee_bps_applied} bps, reason:{' '}
                {raffle.fee_tier_reason})
              </p>
              <p>
                <span className="font-medium">Platform fee:</span> {raffle.platform_fee_amount?.toFixed(6)}{' '}
                {raffle.currency}
              </p>
              <p>
                <span className="font-medium">Creator payout:</span> {raffle.creator_payout_amount?.toFixed(6)}{' '}
                {raffle.currency}
              </p>
              <p>
                <span className="font-medium">Settled at:</span> {raffle.settled_at}
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="border-violet-500/20 bg-violet-500/[0.03]">
          <CardHeader>
            <CardTitle>Share this raffle on X</CardTitle>
            <CardDescription>
              One-click templates to market this raffle. Opens X with prefilled text and your raffle link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {xTemplates.map((template) => (
                <Button
                  key={template.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  asChild
                  className="touch-manipulation min-h-[44px]"
                >
                  <a href={template.intentUrl} target="_blank" rel="noopener noreferrer">
                    Post to X: {template.label}
                  </a>
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: use Launch when a raffle goes live, Hype mid-way, and Last call near close.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Owl Vision Breakdown</CardTitle>
                <CardDescription>Trust score analysis</CardDescription>
              </div>
              <OwlVisionBadge score={owlVisionScore} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Verified Payments Ratio:</span>
                <span className="ml-2 font-semibold">
                  {Math.round(owlVisionScore.verifiedRatio * 100)}%
                </span>
                <p className="text-xs text-muted-foreground mt-1">
                  {owlVisionScore.confirmedEntries} / {owlVisionScore.totalEntries} entries
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Wallet Diversity Ratio:</span>
                <span className="ml-2 font-semibold">
                  {Math.round(owlVisionScore.diversityRatio * 100)}%
                </span>
                <p className="text-xs text-muted-foreground mt-1">
                  {owlVisionScore.uniqueWallets} unique wallets
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Time Integrity:</span>
                <span className="ml-2 font-semibold">
                  {owlVisionScore.integrityScore}/10
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Score:</span>
                <span className="ml-2 font-semibold text-xl">
                  {owlVisionScore.score}/100
                </span>
              </div>
            </div>
            {raffle.edited_after_entries && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">
                  This raffle was edited after entries were confirmed
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Admin: Return NFT to creator (only when NFT is in escrow and return is possible) */}
        {canReturnNftDraft && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftCircle className="h-5 w-5" />
                Return NFT to creator
              </CardTitle>
              <CardDescription>
                Send the prize NFT from escrow back to the creator&apos;s wallet. Use if the raffle
                is cancelled or the wrong NFT was deposited.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog open={returnNftDialogOpen} onOpenChange={setReturnNftDialogOpen}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                    onClick={() => setReturnNftDialogOpen(true)}
                    disabled={returningNft}
                  >
                    <ArrowLeftCircle className="h-4 w-4 mr-2" />
                    Return NFT to creator
                  </Button>
                </div>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Return NFT to creator</DialogTitle>
                    <DialogDescription>
                      Send the prize NFT to the creator&apos;s wallet (
                      <code className="text-xs">{creatorWalletRaffle}</code>). Choose a reason.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-4">
                    <Label>Reason</Label>
                    <select
                      value={returnNftReason}
                      onChange={(e) => setReturnNftReason(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="cancelled">Raffle cancelled</option>
                      <option value="wrong_nft">Wrong NFT deposited</option>
                      <option value="dispute">Dispute resolution</option>
                      <option value="platform_error">Platform error</option>
                      <option value="testing">Testing</option>
                    </select>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setReturnNftDialogOpen(false)}
                      disabled={returningNft}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleReturnNft}
                      disabled={returningNft}
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      {returningNft ? 'Returning...' : 'Return NFT'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        )}

        {/* Outage Recovery: Restore Raffle - only when ended, no winner, and no tickets purchased */}
        {(() => {
          const now = new Date()
          // Use end_time only: after restore, end_time is the extended time
          const endTimeToCheck = new Date(raffle.end_time)
          const hasEnded = endTimeToCheck <= now
          const hasNoWinner = !raffle.winner_wallet && !raffle.winner_selected_at
          const ticketsSold = calculateTicketsSold(entriesList)

          // Only allow restore when raffle ended, no winner, and absolutely no confirmed tickets
          if (!hasEnded || !hasNoWinner || ticketsSold > 0) return null

          return (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RotateCcw className="h-5 w-5" />
                  Outage Recovery
                </CardTitle>
                <CardDescription>
                  Use only when tickets couldn&apos;t be purchased due to site or database outage and no tickets were bought. Extends the raffle end time (24 hours, 3 days, or 7 days) so people can buy tickets again.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300"
                      disabled={restoring}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Restore Raffle
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Restore Raffle (Outage Recovery)</DialogTitle>
                      <DialogDescription>
                        Extend the raffle end time from now so tickets can be purchased again. Use only when the site or database was down and people couldn&apos;t buy tickets during the scheduled window.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-4">
                      <Label>Extension length</Label>
                      <div className="flex flex-wrap gap-3">
                        {[
                          { value: 24 as const, label: '24 hours' },
                          { value: 72 as const, label: '3 days' },
                          { value: 168 as const, label: '7 days' },
                        ].map(({ value, label }) => (
                          <Button
                            key={value}
                            type="button"
                            variant={restoreExtension === value ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setRestoreExtension(value)}
                            className={restoreExtension === value ? 'bg-amber-600 hover:bg-amber-700' : ''}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRestoreDialogOpen(false)} disabled={restoring}>
                        Cancel
                      </Button>
                      <Button
                        onClick={handleRestoreRaffle}
                        disabled={restoring}
                        className="bg-amber-600 hover:bg-amber-700"
                      >
                        {restoring ? 'Restoring...' : 'Restore Raffle'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          )
        })()}

        {/* Winner Selection Section */}
        {(() => {
          const now = new Date()
          // Use end_time only: after restore, end_time is the extended time
          const endTimeToCheck = new Date(raffle.end_time)
          const hasEnded = endTimeToCheck <= now
          const hasNoWinner = !raffle.winner_wallet && !raffle.winner_selected_at
          
          // Only show if raffle has ended
          if (!hasEnded) {
            return null
          }

          // If winner already selected, show winner info
          if (!hasNoWinner) {
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Winner Selected</CardTitle>
                  <CardDescription>This raffle already has a winner</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Winner Wallet:</span>
                      <code className="text-sm font-mono">{raffle.winner_wallet}</code>
                    </div>
                    {raffle.winner_selected_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Selected At:</span>
                        <span className="text-sm">{new Date(raffle.winner_selected_at).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          }

          // Calculate eligibility (with error handling)
          let canDraw = false
          let meetsMinTickets = true
          let ticketsSold = 0
          const isExtended = !!raffle.original_end_time
          
          try {
            canDraw = canSelectWinner(raffle, entriesList)
            meetsMinTickets = getRaffleMinimum(raffle)
              ? isRaffleEligibleToDraw(raffle, entriesList)
              : true
            ticketsSold = calculateTicketsSold(entriesList)
          } catch (error) {
            console.error('Error calculating eligibility:', error)
          }

          return (
            <Card>
              <CardHeader>
                <CardTitle>Winner Selection</CardTitle>
                <CardDescription>Manually trigger winner selection for this raffle</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Raffle Status:</span>
                    <span className="text-sm font-semibold">Ended - No Winner Selected</span>
                  </div>
                  {getRaffleMinimum(raffle) != null && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Minimum Tickets Required:</span>
                        <span className={`text-sm font-semibold ${meetsMinTickets ? 'text-green-500' : 'text-red-500'}`}>
                          {getRaffleMinimum(raffle)} {meetsMinTickets ? '✓' : '✗'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Tickets Sold:</span>
                        <span className="text-sm font-semibold">{ticketsSold}</span>
                      </div>
                      {isExtended && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Extended Raffle:</span>
                          <span className="text-sm font-semibold">
                            Yes ✓
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {getRaffleMinimum(raffle) == null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Tickets Sold:</span>
                      <span className="text-sm font-semibold">{ticketsSold}</span>
                    </div>
                  )}
                </div>

                {winnerMessage && (
                  <div className={`p-3 rounded-lg border ${
                    winnerMessage.type === 'success' 
                      ? 'bg-green-500/10 border-green-500/20 text-green-500'
                      : 'bg-red-500/10 border-red-500/20 text-red-500'
                  }`}>
                    <p className="text-sm">{winnerMessage.text}</p>
                  </div>
                )}

                <div className="space-y-3">
                  {!canDraw && (
                    <div className="flex items-start gap-2 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10">
                      <Switch
                        id="force-override"
                        name="force-override"
                        ariaLabel="Force override: bypass restrictions and select winner anyway"
                        checked={forceOverride}
                        onCheckedChange={setForceOverride}
                        className="mt-0.5 shrink-0"
                      />
                      <label htmlFor="force-override" className="text-sm text-muted-foreground cursor-pointer flex-1">
                        <span className="font-semibold text-yellow-600 dark:text-yellow-400">Force Override:</span> Bypass restrictions and select winner anyway
                        {!meetsMinTickets && (
                          <span className="block mt-1 text-xs">
                            ⚠️ Minimum ticket requirement not met (need {getRaffleMinimum(raffle)}, have{' '}
                            {ticketsSold})
                          </span>
                        )}
                      </label>
                    </div>
                  )}
                  <div className="flex gap-4">
                    <Button
                      type="button"
                      onClick={handleSelectWinner}
                      disabled={selectingWinner || (!canDraw && !forceOverride)}
                      className="flex items-center gap-2"
                    >
                      <Trophy className="h-4 w-4" />
                      {selectingWinner ? 'Selecting Winner...' : 'Select Winner'}
                    </Button>
                    {!canDraw && !forceOverride && (
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground">
                          {!meetsMinTickets
                            ? `Minimum ticket requirement not met (need ${getRaffleMinimum(raffle)}, have ${ticketsSold})`
                            : 'Cannot select winner at this time'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })()}

        {entriesList.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Entries ({entriesList.length})</CardTitle>
              <CardDescription>Manage raffle entries</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {entriesList.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-mono truncate">{entry.wallet_address}</code>
                        <span className="text-xs text-muted-foreground">
                          • {entry.ticket_quantity} ticket(s)
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          entry.status === 'confirmed' 
                            ? 'bg-green-500/10 text-green-500'
                            : entry.status === 'pending'
                            ? 'bg-yellow-500/10 text-yellow-500'
                            : 'bg-red-500/10 text-red-500'
                        }`}>
                          {entry.status}
                        </span>
                        {entry.transaction_signature && (
                          <a
                            href={`https://solscan.io/tx/${entry.transaction_signature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            View TX
                          </a>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {entry.amount_paid} {entry.currency} • {new Date(entry.created_at).toLocaleString()}
                      </div>
                    </div>
                    {entry.status === 'pending' && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteEntry(entry.id)}
                        disabled={deletingEntryId === entry.id}
                        className="ml-4 flex-shrink-0"
                      >
                        {deletingEntryId === entry.id ? (
                          'Deleting...'
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className={getThemeAccentClasses(raffle.theme_accent)} style={borderStyle}>
          <CardHeader>
            <CardTitle>Raffle Details</CardTitle>
            <CardDescription>Update raffle information</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input id="title" name="title" defaultValue={raffle.title} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <textarea
                  id="description"
                  name="description"
                  defaultValue={raffle.description || ''}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <Label>Listing image</Label>
                <p className="text-xs text-muted-foreground">
                  Art comes from the prize NFT when the raffle is created. It cannot be changed here, so listings stay aligned with on-chain metadata and we avoid user-uploaded images.
                </p>
                {raffle.image_url ? (
                  <div className="relative w-full max-w-md h-48 rounded-md overflow-hidden border border-input bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={raffle.image_url}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No image stored for this raffle.</p>
                )}
                {adminRole !== null && (
                  <div className="space-y-2 pt-2 border-t border-border mt-2">
                    <Label htmlFor="image_fallback_url">Fallback listing image (optional)</Label>
                    <p className="text-xs text-muted-foreground">
                      If the NFT image fails to load (e.g. dead gateway), this URL is shown instead. HTTPS or ipfs://. Leave empty and save to clear.
                    </p>
                    <Input
                      id="image_fallback_url"
                      name="image_fallback_url"
                      type="url"
                      defaultValue={raffle.image_fallback_url ?? ''}
                      placeholder="https://… or ipfs://…"
                      className="font-mono text-sm touch-manipulation min-h-[44px]"
                      autoComplete="off"
                    />
                  </div>
                )}
              </div>

              {isNonDraftNft ? (
                adminRole === 'full' && canOverrideNftEconomics ? (
                  <div className="rounded-md border border-amber-600/40 bg-amber-500/[0.07] px-3 py-3 space-y-4 text-sm">
                    <div>
                      <p className="font-medium text-foreground">Ticket economics (full admin)</p>
                      <p className="text-muted-foreground text-xs pt-1">
                        Floor and ticket price are editable here. Draw goal is set to match round(floor ÷ ticket
                        price) when you save, consistent with the public NFT raffle rules. For draw threshold, max
                        cap, and currency in other states, use the deeper controls on the admin actions page.
                      </p>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="currency_nft_live">Currency *</Label>
                        {raffle.currency === 'OWL' && (
                          <p className="text-xs text-amber-600 dark:text-amber-500">
                            This listing used OWL; ticket currency is now SOL or USDC only. Choose one and save.
                          </p>
                        )}
                        <select
                          id="currency_nft_live"
                          name="currency"
                          defaultValue={raffle.currency === 'USDC' ? 'USDC' : 'SOL'}
                          className="flex h-10 w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation"
                        >
                          <option value="SOL">SOL</option>
                          <option value="USDC">USDC</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="ticket_price_nft_live">Ticket price *</Label>
                          <Input
                            id="ticket_price_nft_live"
                            name="ticket_price_nft_live"
                            type="number"
                            step="any"
                            className="min-h-[44px] touch-manipulation"
                            value={nftDraftTicket}
                            onChange={(e) => setNftDraftTicket(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">Suggested: floor ÷ {NFT_DEFAULT_SUGGEST_TICKET_COUNT}</p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="floor_price_nft_live">Floor price (prize value) *</Label>
                          <Input
                            id="floor_price_nft_live"
                            name="floor_price_nft_live"
                            type="text"
                            inputMode="decimal"
                            value={nftDraftFloor}
                            onChange={(e) => setNftDraftFloor(e.target.value)}
                            placeholder="e.g. 0.25 (in raffle currency)"
                            className="min-h-[44px] touch-manipulation"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="max_tickets_nft_live">Max tickets (optional)</Label>
                      <Input
                        id="max_tickets_nft_live"
                        name="max_tickets"
                        type="number"
                        min={nftComputedMin ?? 1}
                        defaultValue={raffle.max_tickets ?? undefined}
                        placeholder="Leave empty to keep current (or unlimited)"
                        className="min-h-[44px] touch-manipulation"
                        key={raffle.id + String(raffle.max_tickets ?? '')}
                      />
                      <p className="text-xs text-muted-foreground">
                        If set, must be at least the new draw goal ({nftComputedMin ?? '—'}). Empty leaves the current
                        cap unchanged.
                      </p>
                    </div>
                    <div className="rounded-md border border-border/80 bg-background/50 px-3 py-2 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Draw goal (computed on save):</span>{' '}
                      {nftComputedMin != null
                        ? `${nftComputedMin} tickets`
                        : 'Enter valid floor and ticket price.'}
                    </div>
                    <label className="flex items-start gap-3 text-sm cursor-pointer touch-manipulation min-h-[44px] py-1">
                      <input
                        type="checkbox"
                        checked={nftLiveEconomicsConfirm}
                        onChange={(e) => setNftLiveEconomicsConfirm(e.target.checked)}
                        className="mt-1 h-5 w-5 shrink-0 rounded border-input"
                        aria-label="Confirm changing live ticket economics"
                      />
                      <span className="text-muted-foreground leading-snug">
                        I understand this is a live (or pre-draw) listing and I intend to change floor and/or ticket
                        prices shown to buyers.
                      </span>
                    </label>
                  </div>
                ) : (
                  <div className="rounded-md border border-border px-3 py-2.5 text-sm space-y-1.5 text-muted-foreground">
                    <p className="font-medium text-foreground">Ticket economics (read-only)</p>
                    <p>
                      <span className="text-foreground font-medium">Currency:</span> {raffle.currency}
                    </p>
                    <p>
                      <span className="text-foreground font-medium">Floor price:</span> {raffle.floor_price ?? '—'}
                    </p>
                    <p>
                      <span className="text-foreground font-medium">Ticket price:</span> {raffle.ticket_price ?? '—'}
                    </p>
                    <p>
                      <span className="text-foreground font-medium">Draw goal:</span>{' '}
                      {getRaffleMinimum(raffle) ?? raffle.min_tickets ?? '—'} tickets
                    </p>
                    <p>
                      <span className="text-foreground font-medium">Max tickets:</span>{' '}
                      {raffle.max_tickets != null ? raffle.max_tickets : 'Unlimited'}
                    </p>
                    <p className="text-xs pt-1">
                      {adminRole === null
                        ? 'Checking admin permissions…'
                        : adminRole === 'full' && !canOverrideNftEconomics
                          ? 'A winner is already set or this status is not eligible to change floor/ticket here. Use the admin actions page for “NFT draw goal & ticket economics” (with optional draw threshold) or other tools.'
                          : "Only full admins can change live floor and ticket from this form when the listing is eligible. Otherwise use the admin actions page."}
                    </p>
                  </div>
                )
              ) : isDraftNft ? (
                <>
                  <div className="rounded-md border border-muted-foreground/25 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    Set floor price and ticket price. Draw goal is computed as round(floor ÷ ticket price) — not editable
                    on its own. We suggest starting with ticket = floor ÷ {NFT_DEFAULT_SUGGEST_TICKET_COUNT}.
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="currency">Currency *</Label>
                      {raffle.currency === 'OWL' && (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          This raffle used OWL; ticket currency is now SOL or USDC only. Choose one and save.
                        </p>
                      )}
                      <select
                        id="currency"
                        name="currency"
                        defaultValue={raffle.currency === 'USDC' ? 'USDC' : 'SOL'}
                        className="flex h-10 w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation"
                        required
                      >
                        <option value="SOL">SOL</option>
                        <option value="USDC">USDC</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="ticket_price">Ticket price *</Label>
                        <Input
                          id="ticket_price"
                          name="ticket_price"
                          type="number"
                          step="any"
                          required
                          className="min-h-[44px] touch-manipulation"
                          value={nftDraftTicket}
                          onChange={(e) => setNftDraftTicket(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Suggested default: floor ÷ {NFT_DEFAULT_SUGGEST_TICKET_COUNT}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="floor_price">Floor price (prize value) *</Label>
                        <Input
                          id="floor_price"
                          name="floor_price"
                          type="text"
                          inputMode="decimal"
                          value={nftDraftFloor}
                          onChange={(e) => setNftDraftFloor(e.target.value)}
                          placeholder="e.g., 0.25 (in raffle currency)"
                          className="min-h-[44px] touch-manipulation"
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          Revenue threshold for rev share; ticket price is derived from this value.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max_tickets">Max tickets (optional)</Label>
                    <Input
                      id="max_tickets"
                      name="max_tickets"
                      type="number"
                      min={nftComputedMin ?? 1}
                      defaultValue={raffle.max_tickets || ''}
                      placeholder="Leave empty for unlimited"
                      className="min-h-[44px] touch-manipulation"
                    />
                    <p className="text-xs text-muted-foreground">
                      If set, must be at least the draw goal ({nftComputedMin ?? '—'}), or leave empty for unlimited.
                    </p>
                  </div>
                  <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Draw goal (computed):</span>{' '}
                    {nftComputedMin != null
                      ? `${nftComputedMin} tickets`
                      : 'Enter valid floor and ticket price.'}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rank">Rank (optional)</Label>
                    <Input
                      id="rank"
                      name="rank"
                      type="text"
                      defaultValue={raffle.rank || ''}
                      placeholder="e.g., #123 or 123"
                      className="min-h-[44px] touch-manipulation"
                    />
                    <p className="text-xs text-muted-foreground">Optional rank metadata (text or integer)</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ticket_price">Ticket Price *</Label>
                      <Input
                        id="ticket_price"
                        name="ticket_price"
                        type="number"
                        step="0.000001"
                        defaultValue={raffle.ticket_price}
                        required
                        className="min-h-[44px] touch-manipulation"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="currency">Currency *</Label>
                      {raffle.currency === 'OWL' && (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          This raffle used OWL; ticket currency is now SOL or USDC only. Choose one and save.
                        </p>
                      )}
                      <select
                        id="currency"
                        name="currency"
                        defaultValue={raffle.currency === 'USDC' ? 'USDC' : 'SOL'}
                        className="flex h-10 w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation"
                        required
                      >
                        <option value="SOL">SOL</option>
                        <option value="USDC">USDC</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="max_tickets">Max Tickets (optional)</Label>
                    <Input
                      id="max_tickets"
                      name="max_tickets"
                      type="number"
                      min="1"
                      defaultValue={raffle.max_tickets || ''}
                      placeholder="Leave empty for unlimited tickets"
                      className="min-h-[44px] touch-manipulation"
                    />
                    <p className="text-xs text-muted-foreground">
                      Set a limit on the total number of tickets that can be purchased. Leave empty for unlimited.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="min_tickets">Goal: Minimum Tickets Required (optional)</Label>
                    <Input
                      id="min_tickets"
                      name="min_tickets"
                      type="number"
                      min="1"
                      defaultValue={raffle.min_tickets || '50'}
                      placeholder="50 (recommended)"
                      className="min-h-[44px] touch-manipulation"
                    />
                    <p className="text-xs text-muted-foreground">
                      Raffle will only be eligible to draw once this minimum is reached. Recommended: 50 tickets.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="rank">Rank (optional)</Label>
                      <Input
                        id="rank"
                        name="rank"
                        type="text"
                        defaultValue={raffle.rank || ''}
                        placeholder="e.g., #123 or 123"
                        className="min-h-[44px] touch-manipulation"
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional rank metadata (text or integer)
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="floor_price">Floor Price (prize value for NFT)</Label>
                      <Input
                        id="floor_price"
                        name="floor_price"
                        type="text"
                        defaultValue={raffle.floor_price || ''}
                        placeholder="e.g., 0.25 or 5.5 (in raffle currency)"
                        className="min-h-[44px] touch-manipulation"
                      />
                      <p className="text-xs text-muted-foreground">
                        Prize value for this NFT raffle. Used as the profit threshold: revenue above this amount goes to
                        rev share.
                      </p>
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="status">Status *</Label>
                <select
                  id="status"
                  name="status"
                  defaultValue={raffle.status ?? 'draft'}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                >
                  <option value="draft">Draft</option>
                  <option value="live" disabled={!canSetNftLive}>
                    Live{!canSetNftLive ? ' (requires escrow deposit)' : ''}
                  </option>
                  <option value="ready_to_draw" disabled={!canSetNftLive}>
                    Ready to Draw{!canSetNftLive ? ' (requires escrow deposit)' : ''}
                  </option>
                  <option value="completed">Completed</option>
                </select>
                {isNftRaffle && (
                  <p className="text-xs text-muted-foreground">
                    Escrow status:{' '}
                    {raffle.prize_deposited_at
                      ? 'Deposited and verified.'
                      : 'Not deposited yet. NFT raffles stay draft until deposit is verified.'}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="theme_accent">Theme Accent *</Label>
                <select
                  id="theme_accent"
                  name="theme_accent"
                  defaultValue={raffle.theme_accent}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                >
                  {THEME_ACCENT_SELECT_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start_time">Start Time *</Label>
                  <Input
                    id="start_time"
                    name="start_time"
                    type="datetime-local"
                    defaultValue={utcToLocalDateTime(raffle.start_time)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end_time">End Time * (Max 7 days from start)</Label>
                  <Input
                    id="end_time"
                    name="end_time"
                    type="datetime-local"
                    defaultValue={utcToLocalDateTime(raffle.end_time)}
                    required
                    className="text-base sm:text-sm"
                    max={(() => {
                      const startDate = new Date(raffle.start_time)
                      const maxFromStart = new Date(startDate)
                      maxFromStart.setDate(maxFromStart.getDate() + 7)
                      // If raffle was extended (e.g. Restore), allow current end_time so the saved value doesn't trigger validation
                      const maxDate =
                        raffle.original_end_time && new Date(raffle.end_time) > maxFromStart
                          ? new Date(raffle.end_time)
                          : maxFromStart
                      return utcToLocalDateTime(maxDate.toISOString())
                    })()}
                  />
                  <p className="text-xs text-muted-foreground">
                    Raffles have a maximum duration of 7 days.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <Button type="submit" disabled={loading || deleting} className="flex-1">
                  {loading ? 'Updating...' : 'Update Raffle'}
                </Button>
                <div className="flex gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.back()}
                    disabled={loading || deleting}
                  >
                    Cancel
                  </Button>
                  <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={
                          loading || deleting || (Boolean(isAdmin) && adminRole === null)
                        }
                        className="flex items-center gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete Raffle</DialogTitle>
                        <DialogDescription>
                          Are you sure you want to delete &quot;{raffle.title}&quot;? This action cannot be undone and will also delete all associated entries.
                          <span className="block mt-2 font-medium text-foreground">
                            Enter a short reason for the audit log (required).
                          </span>
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-2 py-2">
                        <Label htmlFor="edit-raffle-delete-reason">Delete reason (required)</Label>
                        <textarea
                          id="edit-raffle-delete-reason"
                          value={adminHardDeleteReason}
                          onChange={(e) => setAdminHardDeleteReason(e.target.value)}
                          placeholder="e.g. Duplicate NFT prize listing — removing extra draft."
                          maxLength={ADMIN_HARD_DELETE_REASON_MAX_CHARS}
                          rows={4}
                          className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <p className="text-xs text-muted-foreground">
                          {ADMIN_HARD_DELETE_REASON_MIN_CHARS}–{ADMIN_HARD_DELETE_REASON_MAX_CHARS} characters.
                        </p>
                      </div>
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setDeleteDialogOpen(false)}
                          disabled={deleting}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleDelete}
                          disabled={
                            deleting ||
                            adminRole === null ||
                            adminHardDeleteReason.trim().length < ADMIN_HARD_DELETE_REASON_MIN_CHARS
                          }
                        >
                          {deleting ? 'Deleting...' : 'Delete Raffle'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
