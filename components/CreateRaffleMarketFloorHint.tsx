'use client'

import { useEffect, useState } from 'react'
import { formatMarketFloorSol } from '@/lib/nft-floor-price-fetch'
import { cn } from '@/lib/utils'

type FloorLookup = {
  found: boolean
  floorSol: number | null
  floorSolDisplay: string | null
  source: string
  collectionSymbol: string | null
  collectionName: string | null
  reason?: string
}

/**
 * Create-form helper: fetch marketplace floor for the selected mint and offer to apply it
 * as the listed floor (still editable; never auto-locks economics).
 */
export function CreateRaffleMarketFloorHint({
  mintAddress,
  onApplyFloorSol,
  className,
}: {
  mintAddress: string | null | undefined
  onApplyFloorSol: (floorSol: number, display: string) => void
  className?: string
}) {
  const mint = typeof mintAddress === 'string' ? mintAddress.trim() : ''
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'miss' | 'error'>('idle')
  const [lookup, setLookup] = useState<FloorLookup | null>(null)

  useEffect(() => {
    if (!mint) {
      setState('idle')
      setLookup(null)
      return
    }
    let cancelled = false
    const ac = new AbortController()
    setState('loading')
    setLookup(null)
    void (async () => {
      try {
        const res = await fetch(`/api/nft-marketplace/floor?mint=${encodeURIComponent(mint)}`, {
          signal: ac.signal,
        })
        if (!res.ok) {
          if (!cancelled) setState('error')
          return
        }
        const json = (await res.json()) as FloorLookup
        if (cancelled) return
        setLookup(json)
        setState(json.found && json.floorSol != null ? 'ready' : 'miss')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [mint])

  if (!mint) return null

  return (
    <div className={cn('rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs space-y-1.5', className)}>
      <p className="font-medium text-foreground">Live market floor</p>
      {state === 'loading' && <p className="text-muted-foreground">Checking Magic Eden…</p>}
      {state === 'error' && (
        <p className="text-muted-foreground">Could not load market floor. Enter prize value manually.</p>
      )}
      {state === 'miss' && (
        <p className="text-muted-foreground">
          {lookup?.reason || 'No marketplace floor found for this mint.'} Enter prize value manually.
        </p>
      )}
      {state === 'ready' && lookup?.floorSol != null && (
        <>
          <p className="text-muted-foreground leading-relaxed">
            {lookup.collectionName || lookup.collectionSymbol || 'Collection'} floor:{' '}
            <span className="text-foreground font-semibold">
              {lookup.floorSolDisplay ?? formatMarketFloorSol(lookup.floorSol)} SOL
            </span>
            {lookup.source === 'magic_eden' ? ' (Magic Eden)' : null}. Suggested starting point only — your listed
            floor still sets the draw goal.
          </p>
          <button
            type="button"
            className="text-sm font-medium text-primary underline-offset-2 hover:underline touch-manipulation min-h-[36px]"
            onClick={() => {
              const display = lookup.floorSolDisplay ?? formatMarketFloorSol(lookup.floorSol!)
              onApplyFloorSol(lookup.floorSol!, display)
            }}
          >
            Use as listed floor
          </button>
        </>
      )}
    </div>
  )
}
