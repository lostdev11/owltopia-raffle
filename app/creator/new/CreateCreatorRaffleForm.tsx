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
import { localDateTimeToUtc } from '@/lib/utils'

export function CreateCreatorRaffleForm() {
  const router = useRouter()
  const { publicKey, connected, signMessage } = useWallet()
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>('prime')
  const [startTime, setStartTime] = useState(() => new Date().toISOString().slice(0, 16))
  const [endTime, setEndTime] = useState('')
  const [loading, setLoading] = useState(false)
  const [isHolder, setIsHolder] = useState<boolean | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Check holder status when wallet connects
  useEffect(() => {
    const checkHolderStatus = async () => {
      if (!connected || !publicKey) {
        setIsHolder(false)
        return
      }

      try {
        const response = await fetch(`/api/creator/check-holder?wallet=${publicKey.toBase58()}`)
        if (response.ok) {
          const data = await response.json()
          setIsHolder(data.isHolder === true)
        } else {
          setIsHolder(false)
        }
      } catch (error) {
        console.error('Error checking holder status:', error)
        setIsHolder(false)
      }
    }

    checkHolderStatus()
  }, [connected, publicKey])

  const handlePresetSelect = (presetName: string) => {
    const preset = NIGHT_MODE_PRESETS.find(p => p.name === presetName)
    if (preset) {
      setSelectedPreset(presetName)
      setThemeAccent(preset.themeAccent)
      const presetEndTime = preset.getEndTime()
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
    setError(null)
    
    if (!connected || !publicKey) {
      setError('Please connect your wallet to create a raffle')
      return
    }

    if (!isHolder) {
      setError('Only Owltopia NFT holders can create raffles')
      return
    }

    if (!signMessage) {
      setError('Your wallet does not support message signing')
      return
    }

    // Validate 7-day maximum duration
    if (startTime && endTime) {
      const startDate = new Date(startTime)
      const endDate = new Date(endTime)
      const durationMs = endDate.getTime() - startDate.getTime()
      const durationDays = durationMs / (1000 * 60 * 60 * 24)
      
      if (durationDays > 7) {
        setError('Raffle duration cannot exceed 7 days')
        return
      }
    }

    setLoading(true)

    try {
      const formData = new FormData(e.currentTarget)
      const maxTicketsValue = formData.get('max_tickets') as string
      const minTicketsValue = formData.get('min_tickets') as string

      // Generate message for signing
      const timestamp = Date.now()
      const walletAddress = publicKey.toBase58()
      const message = `Sign this message to create a raffle\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\n\nThis signature will not cost any SOL.`

      // Sign message
      let signature: Uint8Array
      try {
        const encodedMessage = new TextEncoder().encode(message)
        signature = await signMessage(encodedMessage)
      } catch (signError) {
        setError('Failed to sign message. Please try again.')
        setLoading(false)
        return
      }

      // Convert signature to base64 for transmission
      const signatureBase64 = btoa(String.fromCharCode(...signature))

      const data = {
        walletAddress,
        signature: signatureBase64,
        message,
        timestamp,
        title: formData.get('title') as string,
        description: formData.get('description') as string,
        image_url: imageUrl || null,
        ticket_price: parseFloat(formData.get('ticket_price') as string),
        currency: formData.get('currency') as string,
        max_tickets: maxTicketsValue ? parseInt(maxTicketsValue) : null,
        min_tickets: minTicketsValue ? parseInt(minTicketsValue) : null,
        start_time: localDateTimeToUtc(startTime),
        end_time: localDateTimeToUtc(endTime),
        theme_accent: themeAccent,
      }

      const response = await fetch('/api/creator/raffles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        const raffle = await response.json()
        router.push(`/raffles/${raffle.slug}`)
      } else {
        const errorData = await response.json()
        setError(errorData.error || 'Error creating raffle')
      }
    } catch (error) {
      console.error('Error:', error)
      setError('Error creating raffle')
    } finally {
      setLoading(false)
    }
  }

  const borderStyle = getThemeAccentBorderStyle(themeAccent)

  // Show loading state while checking holder status
  if (isHolder === null) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Checking holder status...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Show error if not holder or not connected
  if (!connected || !isHolder) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              {!connected
                ? 'Please connect your wallet to create a raffle'
                : 'Only Owltopia NFT holders can create raffles'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
        <CardHeader>
          <CardTitle>Create Raffle</CardTitle>
          <CardDescription>Fill in the details for your new raffle</CardDescription>
          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-sm">
              {error}
            </div>
          )}
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
              label="Raffle Image"
              disabled={loading}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ticket_price">Ticket Price *</Label>
                <Input id="ticket_price" name="ticket_price" type="number" step="0.000001" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency *</Label>
                <select
                  id="currency"
                  name="currency"
                  defaultValue="USDC"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                >
                  <option value="USDC">USDC</option>
                  <option value="SOL">SOL</option>
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
                    className="flex flex-col h-auto py-3 min-h-[60px]"
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
                <Input
                  id="start_time"
                  name="start_time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">End Time * (Max 7 days from start)</Label>
                <Input
                  id="end_time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  max={startTime ? (() => {
                    const maxDate = new Date(startTime)
                    maxDate.setDate(maxDate.getDate() + 7)
                    return maxDate.toISOString().slice(0, 16)
                  })() : undefined}
                />
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded p-4">
              <p className="text-sm text-blue-500">
                <strong>Note:</strong> Creating a raffle requires a 1 USDC creation fee (tracked but not collected yet).
                You'll need to sign a message to verify your wallet.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Button type="submit" disabled={loading} className="flex-1">
                {loading ? 'Creating...' : 'Create Raffle'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
