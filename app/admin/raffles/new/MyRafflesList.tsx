'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ListTodo, Loader2, Pencil, RotateCcw } from 'lucide-react'
import type { Raffle } from '@/lib/types'
import { isPendingNftRaffleAtTime } from '@/lib/raffles/visibility'

interface MyRafflesListProps {
  deletedOnly?: boolean
}

export function MyRafflesList({ deletedOnly = false }: MyRafflesListProps) {
  const { publicKey } = useWallet()
  const [raffles, setRaffles] = useState<Raffle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRaffles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const headers: HeadersInit = {}
      if (publicKey) headers['X-Connected-Wallet'] = publicKey.toBase58()
      const res = await fetch('/api/admin/my-raffles', {
        credentials: 'include',
        ...(Object.keys(headers).length ? { headers } : {}),
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setRaffles([])
          return
        }
        setError('Could not load your raffles')
        return
      }
      const data = await res.json()
      setRaffles(Array.isArray(data) ? data : [])
    } catch {
      setError('Could not load your raffles')
    } finally {
      setLoading(false)
    }
  }, [publicKey])

  useEffect(() => {
    fetchRaffles()
  }, [fetchRaffles])

  const nowMs = Date.now()
  const pausedPendingRaffles = raffles.filter((raffle) => isPendingNftRaffleAtTime(raffle, nowMs))
  const pausedPendingIds = new Set(pausedPendingRaffles.map((raffle) => raffle.id))
  const deletedRaffles = raffles.filter((raffle) => (raffle.status ?? '').toLowerCase() === 'cancelled')
  const deletedIds = new Set(deletedRaffles.map((raffle) => raffle.id))
  const otherRaffles = raffles.filter(
    (raffle) => !pausedPendingIds.has(raffle.id) && !deletedIds.has(raffle.id)
  )

  if (loading) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            {deletedOnly ? 'Deleted raffles' : 'My raffles'}
          </CardTitle>
          <CardDescription>
            {deletedOnly
              ? 'Raffles you deleted from your active list.'
              : 'Raffles you created. Open to edit or delete.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            {deletedOnly ? 'Deleted raffles' : 'My raffles'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    )
  }

  if (raffles.length === 0 && !deletedOnly) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ListTodo className="h-5 w-5" />
                My raffles
              </CardTitle>
              <CardDescription>Raffles you created will appear here. You can open any to edit or delete it.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchRaffles} disabled={loading}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No raffles yet. Create one below.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mb-8">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListTodo className="h-5 w-5" />
              {deletedOnly ? 'Deleted raffles' : 'My raffles'}
            </CardTitle>
            <CardDescription>
              {deletedOnly
                ? 'Raffles you deleted from your active list.'
                : 'Raffles you created. Open to edit or delete.'}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchRaffles} disabled={loading} title="Refresh list">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!deletedOnly && pausedPendingRaffles.length > 0 && (
          <div className="space-y-2">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                Paused / Pending Escrow Verification
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                These NFT raffles are paused because escrow verification is still pending (for example, deposit
                signature was not completed or escrow verification failed). They stay paused until admin verifies escrow.
              </p>
            </div>
            <ul className="space-y-2">
              {pausedPendingRaffles.map((raffle) => (
                <li
                  key={raffle.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{raffle.title}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      /{raffle.slug}
                      <span className="ml-2 inline-flex items-center rounded-md bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                        paused
                      </span>
                    </p>
                  </div>
                  <Link href={`/admin/raffles/${raffle.id}`}>
                    <Button variant="outline" size="sm">
                      <Pencil className="h-4 w-4 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Resolve / Edit</span>
                      <span className="sm:hidden">Resolve</span>
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!deletedOnly && otherRaffles.length > 0 && (
          <ul className="space-y-2">
            {otherRaffles.map((raffle) => (
            <li
              key={raffle.id}
              className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{raffle.title}</p>
                <p className="text-sm text-muted-foreground truncate">
                  /{raffle.slug}
                  {raffle.status && (
                    <span className="ml-2 inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs">
                      {raffle.status}
                    </span>
                  )}
                </p>
              </div>
              {(raffle.status ?? '').toLowerCase() === 'draft' ? (
                <Link href={`/admin/raffles/${raffle.id}`}>
                  <Button variant="outline" size="sm">
                    <Pencil className="h-4 w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Edit / Delete</span>
                    <span className="sm:hidden">Edit</span>
                  </Button>
                </Link>
              ) : (
                <Link href={`/raffles/${raffle.slug}`}>
                  <Button variant="ghost" size="sm">
                    View
                  </Button>
                </Link>
              )}
            </li>
            ))}
          </ul>
        )}
        {(deletedOnly || deletedRaffles.length > 0) && (
          <div className="space-y-2">
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                Deleted Raffles
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                These raffles were deleted from your active list and are kept here for history.
              </p>
            </div>
            <ul className="space-y-2">
              {deletedRaffles.map((raffle) => (
                <li
                  key={raffle.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{raffle.title}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      /{raffle.slug}
                      <span className="ml-2 inline-flex items-center rounded-md bg-red-500/20 px-2 py-0.5 text-xs text-red-700 dark:text-red-300">
                        deleted
                      </span>
                    </p>
                  </div>
                  <Link href={`/raffles/${raffle.slug}`}>
                    <Button variant="ghost" size="sm">
                      View
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
            {deletedOnly && deletedRaffles.length === 0 && (
              <p className="text-sm text-muted-foreground">No deleted raffles yet.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
