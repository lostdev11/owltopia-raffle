'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ImageUpload } from '@/components/ImageUpload'
import { NIGHT_MODE_PRESETS } from '@/lib/night-mode-presets'
import type { ThemeAccent } from '@/lib/types'
import { getThemeAccentBorderStyle, getThemeAccentClasses } from '@/lib/theme-accent'
import { localDateTimeToUtc, utcToLocalDateTime } from '@/lib/utils'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { isOwlEnabled } from '@/lib/tokens'

export function CreateRaffleForm() {
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>('prime')
  const [startTime, setStartTime] = useState(() => new Date().toISOString().slice(0, 16))
  const [endTime, setEndTime] = useState('')
  const [loading, setLoading] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() =>
    typeof window !== 'undefined' && wallet ? getCachedAdmin(wallet) : null
  )
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    if (cached !== null) {
      setIsAdmin(cached)
      return
    }
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        setCachedAdmin(addr, admin)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
    return () => { cancelled = true }
  }, [connected, publicKey])

  const handlePresetSelect = (presetName: string) => {
    const preset = NIGHT_MODE_PRESETS.find(p => p.name === presetName)
    if (preset) {
      setSelectedPreset(presetName)
      setThemeAccent(preset.themeAccent)
      const presetEndTime = preset.getEndTime()
      // Convert the Date object (which is in local time) to datetime-local format
      const year = presetEndTime.getFullYear()
      const month = String(presetEndTime.getMonth() + 1).padStart(2, '0')
      const day = String(presetEndTime.getDate()).padStart(2, '0')
      const hours = String(presetEndTime.getHours()).padStart(2, '0')
      const minutes = String(presetEndTime.getMinutes()).padStart(2, '0')
      setEndTime(`${year}-${month}-${day}T${hours}:${minutes}`)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    if (!connected || !publicKey) {
      alert('Please connect your wallet to create a raffle')
      return
    }

    if (!isAdmin) {
      alert('Only admins can create raffles')
      return
    }

    // Validate 7-day maximum duration
    if (startTime && endTime) {
      const startDate = new Date(startTime)
      const endDate = new Date(endTime)
      const durationMs = endDate.getTime() - startDate.getTime()
      const durationDays = durationMs / (1000 * 60 * 60 * 24)
      
      if (durationDays > 7) {
        alert('Raffle duration cannot exceed 7 days')
        return
      }
    }

    setLoading(true)

    const formData = new FormData(e.currentTarget)
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
      start_time: localDateTimeToUtc(startTime),
      end_time: localDateTimeToUtc(endTime),
      theme_accent: themeAccent,
      status: (formData.get('status') as string) || 'draft',
      slug: (formData.get('title') as string)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, ''),
      wallet_address: publicKey.toBase58(),
    }

    try {
      const response = await fetch('/api/raffles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        const raffle = await response.json()
        router.push(`/raffles/${raffle.slug}`)
      } else {
        const errorData = await response.json()
        alert(errorData.error || 'Error creating raffle')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error creating raffle')
    } finally {
      setLoading(false)
    }
  }

  const borderStyle = getThemeAccentBorderStyle(themeAccent)

  // Show loading state while checking admin status
  if (isAdmin === null) {
    return (
      <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">Checking admin status...</p>
        </CardContent>
      </Card>
    )
  }

  // Show error if not admin or not connected
  if (!connected || !isAdmin) {
    return (
      <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>
            Only admins can create
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
      <CardHeader>
        <CardTitle>Raffle Details</CardTitle>
        <CardDescription>Fill in the details for your new raffle</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <ImageUpload
            value={imageUrl}
            onChange={setImageUrl}
            label="NFT Image"
            disabled={loading}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ticket_price">Ticket Price *</Label>
              <Input id="ticket_price" name="ticket_price" type="number" step="0.000001" required className="text-base sm:text-sm" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency *</Label>
              <select
                id="currency"
                name="currency"
                defaultValue="SOL"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              >
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
                {isOwlEnabled() && <option value="OWL">OWL</option>}
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
              defaultValue="50"
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
                placeholder="e.g., 5.5 SOL or 1000"
              />
              <p className="text-xs text-muted-foreground">
                Optional floor price metadata (text or numeric)
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status *</Label>
            <select
              id="status"
              name="status"
              defaultValue="draft"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="draft">Draft</option>
              <option value="live">Live</option>
              <option value="ready_to_draw">Ready to Draw</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="theme_accent">Theme Accent *</Label>
            <select
              id="theme_accent"
              name="theme_accent"
              value={themeAccent}
              onChange={(e) => setThemeAccent(e.target.value as ThemeAccent)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="prime">Prime Time (Electric Green)</option>
              <option value="midnight">Midnight Drop (Cool Teal)</option>
              <option value="dawn">Dawn Run (Soft Lime)</option>
            </select>
          </div>

          <div className="space-y-4">
            <Label>Night Mode Presets (optional)</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {NIGHT_MODE_PRESETS.map(preset => (
                <Button
                  key={preset.name}
                  type="button"
                  variant={selectedPreset === preset.name ? 'default' : 'outline'}
                  onClick={() => handlePresetSelect(preset.name)}
                  className="flex flex-col h-auto py-3 min-h-[60px] touch-manipulation"
                >
                  <span className="font-semibold text-sm sm:text-base">{preset.label}</span>
                  <span className="text-xs opacity-80">{preset.description}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_time">Start Time *</Label>
              <div className="flex gap-2">
                <Input
                  id="start_time"
                  name="start_time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  className="text-base sm:text-sm flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const now = new Date()
                    const year = now.getFullYear()
                    const month = String(now.getMonth() + 1).padStart(2, '0')
                    const day = String(now.getDate()).padStart(2, '0')
                    const hours = String(now.getHours()).padStart(2, '0')
                    const minutes = String(now.getMinutes()).padStart(2, '0')
                    setStartTime(`${year}-${month}-${day}T${hours}:${minutes}`)
                  }}
                  title="Set to current time"
                  className="touch-manipulation min-h-[44px] px-3 sm:px-4"
                >
                  Now
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">End Time * (Max 7 days from start)</Label>
              <div className="flex gap-2">
                <Input
                  id="end_time"
                  name="end_time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  className="text-base sm:text-sm flex-1"
                  max={startTime ? (() => {
                    const maxDate = new Date(startTime)
                    maxDate.setDate(maxDate.getDate() + 7)
                    return maxDate.toISOString().slice(0, 16)
                  })() : undefined}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const base = startTime ? new Date(startTime) : new Date()
                    const maxDate = new Date(base)
                    maxDate.setDate(maxDate.getDate() + 7)
                    const year = maxDate.getFullYear()
                    const month = String(maxDate.getMonth() + 1).padStart(2, '0')
                    const day = String(maxDate.getDate()).padStart(2, '0')
                    const hours = String(maxDate.getHours()).padStart(2, '0')
                    const minutes = String(maxDate.getMinutes()).padStart(2, '0')
                    setEndTime(`${year}-${month}-${day}T${hours}:${minutes}`)
                  }}
                  title="Set to 7 days from start"
                  className="touch-manipulation min-h-[44px] px-3 sm:px-4"
                >
                  Max
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Raffles have a maximum duration of 7 days.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Button type="submit" disabled={loading} className="flex-1 touch-manipulation min-h-[44px] text-base sm:text-sm">
              {loading ? 'Creating...' : 'Create Raffle'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              className="touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
