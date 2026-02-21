'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ListTodo, Loader2, Pencil, RotateCcw } from 'lucide-react'
import type { Raffle } from '@/lib/types'

export function MyRafflesList() {
  const [raffles, setRaffles] = useState<Raffle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRaffles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/my-raffles', { credentials: 'include' })
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
  }, [])

  useEffect(() => {
    fetchRaffles()
  }, [fetchRaffles])

  if (loading) {
    return (
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            My raffles
          </CardTitle>
          <CardDescription>Raffles you created. Open to edit or delete.</CardDescription>
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
            My raffles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    )
  }

  if (raffles.length === 0) {
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
              My raffles
            </CardTitle>
            <CardDescription>Raffles you created. Open to edit or delete.</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchRaffles} disabled={loading} title="Refresh list">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {raffles.map((raffle) => (
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
              <Link href={`/admin/raffles/${raffle.id}`}>
                <Button variant="outline" size="sm">
                  <Pencil className="h-4 w-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Edit / Delete</span>
                  <span className="sm:hidden">Edit</span>
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
