'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ImageUpload } from '@/components/ImageUpload'
import { OwlVisionBadge } from '@/components/OwlVisionBadge'
import type { Raffle, Entry, OwlVisionScore } from '@/lib/types'
import { getThemeAccentBorderStyle, getThemeAccentClasses } from '@/lib/theme-accent'
import { AlertCircle, Trash2, Trophy } from 'lucide-react'
import { utcToLocalDateTime, localDateTimeToUtc } from '@/lib/utils'
import { canSelectWinner, isRaffleEligibleToDraw, hasSevenDaysPassedSinceOriginalEnd, calculateTicketsSold } from '@/lib/db/raffles'

interface EditRaffleFormProps {
  raffle: Raffle
  entries: Entry[]
  owlVisionScore: OwlVisionScore
}

export function EditRaffleForm({ raffle, entries, owlVisionScore }: EditRaffleFormProps) {
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(raffle.image_url)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [entriesList, setEntriesList] = useState<Entry[]>(entries)
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null)
  const [selectingWinner, setSelectingWinner] = useState(false)
  const [winnerMessage, setWinnerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Check admin status when wallet connects
  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!connected || !publicKey) {
        setIsAdmin(false)
        return
      }

      try {
        const response = await fetch(`/api/admin/check?wallet=${publicKey.toBase58()}`)
        if (response.ok) {
          const data = await response.json()
          setIsAdmin(data.isAdmin)
        } else {
          setIsAdmin(false)
        }
      } catch (error) {
        console.error('Error checking admin status:', error)
        setIsAdmin(false)
      }
    }

    checkAdminStatus()
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

    // Validate 7-day maximum duration
    const startTimeValue = formData.get('start_time') as string
    const endTimeValue = formData.get('end_time') as string
    if (startTimeValue && endTimeValue) {
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
    const minTicketsValue = formData.get('min_tickets') as string
    const rankValue = formData.get('rank') as string
    const floorPriceValue = formData.get('floor_price') as string
    const data = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      image_url: imageUrl || null,
      ticket_price: parseFloat(formData.get('ticket_price') as string),
      currency: formData.get('currency') as string,
      max_tickets: maxTicketsValue ? parseInt(maxTicketsValue) : null,
      min_tickets: minTicketsValue ? parseInt(minTicketsValue) : null,
      rank: rankValue && rankValue.trim() ? rankValue.trim() : null,
      floor_price: floorPriceValue && floorPriceValue.trim() ? floorPriceValue.trim() : null,
      start_time: localDateTimeToUtc(startTimeValue),
      end_time: localDateTimeToUtc(endTimeValue),
      theme_accent: formData.get('theme_accent') as string,
      wallet_address: publicKey.toBase58(),
    }

    try {
      const response = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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

    setDeleting(true)

    try {
      const response = await fetch(`/api/raffles/${raffle.id}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'x-wallet-address': publicKey.toBase58()
        },
        body: JSON.stringify({ wallet_address: publicKey.toBase58() }),
      })

      if (response.ok) {
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
        body: JSON.stringify({ raffleId: raffle.id }),
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

        {/* Winner Selection Section */}
        {(() => {
          const now = new Date()
          const endTime = new Date(raffle.end_time)
          const hasEnded = endTime <= now
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
          let sevenDaysPassed = true
          let ticketsSold = 0
          const isExtended = !!raffle.original_end_time
          
          try {
            canDraw = canSelectWinner(raffle, entriesList)
            meetsMinTickets = raffle.min_tickets ? isRaffleEligibleToDraw(raffle, entriesList) : true
            // Only check 7 days if raffle was extended
            sevenDaysPassed = (raffle.min_tickets && isExtended) ? hasSevenDaysPassedSinceOriginalEnd(raffle) : true
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
                  {raffle.min_tickets && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Minimum Tickets Required:</span>
                        <span className={`text-sm font-semibold ${meetsMinTickets ? 'text-green-500' : 'text-red-500'}`}>
                          {raffle.min_tickets} {meetsMinTickets ? '✓' : '✗'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Tickets Sold:</span>
                        <span className="text-sm font-semibold">{ticketsSold}</span>
                      </div>
                      {isExtended && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">7 Days Passed Since Original End:</span>
                          <span className={`text-sm font-semibold ${sevenDaysPassed ? 'text-green-500' : 'text-red-500'}`}>
                            {sevenDaysPassed ? 'Yes ✓' : 'No ✗'}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {!raffle.min_tickets && (
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

                <div className="flex gap-4">
                  <Button
                    type="button"
                    onClick={handleSelectWinner}
                    disabled={selectingWinner || !canDraw}
                    className="flex items-center gap-2"
                  >
                    <Trophy className="h-4 w-4" />
                    {selectingWinner ? 'Selecting Winner...' : 'Select Winner'}
                  </Button>
                  {!canDraw && (
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">
                        {!meetsMinTickets 
                          ? `Minimum ticket requirement not met (need ${raffle.min_tickets}, have ${ticketsSold})`
                          : (isExtended && !sevenDaysPassed)
                          ? 'Must wait 7 days after original end time before drawing winner'
                          : 'Cannot select winner at this time'}
                      </p>
                    </div>
                  )}
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

              <ImageUpload
                value={imageUrl}
                onChange={setImageUrl}
                label="NFT Image"
                disabled={loading}
              />

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
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency *</Label>
                  <select
                    id="currency"
                    name="currency"
                    defaultValue={raffle.currency}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional rank metadata (text or integer)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="floor_price">Floor Price (optional)</Label>
                  <Input
                    id="floor_price"
                    name="floor_price"
                    type="text"
                    defaultValue={raffle.floor_price || ''}
                    placeholder="e.g., 5.5 SOL or 1000"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional floor price metadata (text or numeric)
                  </p>
                </div>
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
                  <option value="prime">Prime Time (Electric Green)</option>
                  <option value="midnight">Midnight Drop (Cool Teal)</option>
                  <option value="dawn">Dawn Run (Soft Lime)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
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
                      const maxDate = new Date(startDate)
                      maxDate.setDate(maxDate.getDate() + 7)
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
                        disabled={loading || deleting}
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
                          Are you sure you want to delete "{raffle.title}"? This action cannot be undone and will also delete all associated entries.
                        </DialogDescription>
                      </DialogHeader>
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
                          disabled={deleting}
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
