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
import { AlertCircle, Trash2 } from 'lucide-react'
import { utcToLocalDateTime, localDateTimeToUtc } from '@/lib/utils'

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

    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const maxTicketsValue = formData.get('max_tickets') as string
    const minTicketsValue = formData.get('min_tickets') as string
    const data = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      image_url: imageUrl || null,
      ticket_price: parseFloat(formData.get('ticket_price') as string),
      currency: formData.get('currency') as string,
      max_tickets: maxTicketsValue ? parseInt(maxTicketsValue) : null,
      min_tickets: minTicketsValue ? parseInt(minTicketsValue) : null,
      start_time: localDateTimeToUtc(formData.get('start_time') as string),
      end_time: localDateTimeToUtc(formData.get('end_time') as string),
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
                <Label htmlFor="min_tickets">Minimum to Draw (optional)</Label>
                <Input
                  id="min_tickets"
                  name="min_tickets"
                  type="number"
                  min="1"
                  defaultValue={raffle.min_tickets || ''}
                  placeholder="Leave empty for no minimum"
                />
                <p className="text-xs text-muted-foreground">
                  Raffle will only be eligible to draw once this minimum is reached.
                </p>
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
                  <Label htmlFor="end_time">End Time *</Label>
                  <Input
                    id="end_time"
                    name="end_time"
                    type="datetime-local"
                    defaultValue={utcToLocalDateTime(raffle.end_time)}
                    required
                  />
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
