'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ShieldAlert, Trash2 } from 'lucide-react'
import {
  listingFeeSolForStrikeCount,
  MODERATION_MAX_STRIKES_BEFORE_BAN,
} from '@/lib/raffles/creator-moderation-policy'

type BlacklistEntry = {
  wallet_address: string
  reason: string
  added_by: string
  notes: string | null
  strike_count: number
  banned_at: string | null
  created_at: string
  updated_at: string
}

export function AdminCreatorBlacklist() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/creator-blacklist', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load blacklist')
        setEntries([])
        return
      }
      setEntries(Array.isArray(data.entries) ? data.entries : [])
    } catch {
      setError('Could not load blacklist')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  const handleAdd = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/creator-blacklist', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: walletAddress.trim(),
          reason: reason.trim(),
          notes: notes.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not save entry')
        return
      }
      setWalletAddress('')
      setReason('')
      setNotes('')
      await loadEntries()
    } catch {
      setError('Could not save entry')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (wallet: string) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/creator-blacklist?wallet=${encodeURIComponent(wallet)}`,
        { method: 'DELETE', credentials: 'include' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not remove entry')
        return
      }
      await loadEntries()
    } catch {
      setError('Could not remove entry')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Flag a creator wallet for moderation. They can still create drafts, but listings require a
        listing deposit before go-live, show a buyer caution flag, and accrue strikes on each paid
        go-live (0.05 → 0.10 → 0.20 SOL, then blocked at {MODERATION_MAX_STRIKES_BEFORE_BAN}{' '}
        strikes).
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="creator-blacklist-wallet">Wallet address</Label>
          <Input
            id="creator-blacklist-wallet"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="Solana wallet"
            className="mt-1 font-mono text-sm"
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="creator-blacklist-reason">Reason (shown internally)</Label>
          <Input
            id="creator-blacklist-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. repeated spam listings"
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="creator-blacklist-notes">Notes (optional)</Label>
          <Input
            id="creator-blacklist-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Appeal context, links, etc."
            className="mt-1"
          />
        </div>
      </div>

      <Button
        type="button"
        onClick={() => void handleAdd()}
        disabled={saving || !walletAddress.trim() || !reason.trim()}
        className="touch-manipulation min-h-[44px]"
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
        Add to moderation list
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading moderation list…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No wallets on the moderation list.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {entries.map((entry) => {
            const nextFee = listingFeeSolForStrikeCount(entry.strike_count)
            return (
              <li
                key={entry.wallet_address}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-mono text-sm break-all">{entry.wallet_address}</p>
                  <p className="text-sm">{entry.reason}</p>
                  {entry.notes && <p className="text-xs text-muted-foreground">{entry.notes}</p>}
                  <p className="text-xs text-muted-foreground">
                    Strikes: {entry.strike_count}
                    {nextFee != null ? ` · Next listing deposit: ${nextFee} SOL` : ' · Blocked from new raffles'}
                    {entry.banned_at ? ` · Banned ${new Date(entry.banned_at).toLocaleString()}` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="touch-manipulation min-h-[44px] shrink-0 border-red-500/40 text-red-600 hover:bg-red-500/10"
                  disabled={saving}
                  onClick={() => void handleRemove(entry.wallet_address)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
