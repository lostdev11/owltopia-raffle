'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type FloorResponse = {
  found?: boolean
  floorSol?: number | null
  floorDisplay?: string | null
  sourceLabel?: string | null
  collection?: { name?: string | null } | null
}

type Status = 'idle' | 'loading' | 'found' | 'missing' | 'error'

export function NftMarketFloorHint({
  mint,
  collectionMint,
  currency,
  floorValue,
  autoApply = false,
  onApplyFloor,
}: {
  mint: string | null | undefined
  collectionMint?: string | null
  currency: string
  floorValue: string
  /** When true (create flow), fill the floor field once per mint if currency is SOL. */
  autoApply?: boolean
  onApplyFloor: (floorDisplay: string) => void
}) {
  const mintTrim = mint?.trim() || null
  const collectionTrim = collectionMint?.trim() || null
  const [status, setStatus] = useState<Status>(mintTrim || collectionTrim ? 'loading' : 'idle')
  const [floorDisplay, setFloorDisplay] = useState<string | null>(null)
  const [sourceLabel, setSourceLabel] = useState<string | null>(null)
  const [collectionName, setCollectionName] = useState<string | null>(null)
  const appliedForMintRef = useRef<string | null>(null)
  const floorValueRef = useRef(floorValue)
  const onApplyFloorRef = useRef(onApplyFloor)
  const currencyRef = useRef(currency)
  floorValueRef.current = floorValue
  onApplyFloorRef.current = onApplyFloor
  currencyRef.current = currency

  useEffect(() => {
    if (!mintTrim && !collectionTrim) {
      setStatus('idle')
      setFloorDisplay(null)
      setSourceLabel(null)
      setCollectionName(null)
      return
    }

    let cancelled = false
    const ac = new AbortController()
    setStatus('loading')
    setFloorDisplay(null)
    setSourceLabel(null)
    setCollectionName(null)

    const params = new URLSearchParams()
    if (mintTrim) params.set('mint', mintTrim)
    if (collectionTrim) params.set('collection', collectionTrim)

    void (async () => {
      try {
        const res = await fetch(`/api/nft-marketplace/floor?${params.toString()}`, {
          signal: ac.signal,
        })
        if (!res.ok) {
          if (!cancelled) setStatus('error')
          return
        }
        const json = (await res.json()) as FloorResponse
        if (cancelled) return
        if (json.found && json.floorDisplay) {
          setFloorDisplay(json.floorDisplay)
          setSourceLabel(json.sourceLabel ?? null)
          setCollectionName(json.collection?.name?.trim() || null)
          setStatus('found')
          const applyKey = mintTrim || collectionTrim || ''
          const currencyIsSol = currencyRef.current.trim().toUpperCase() === 'SOL'
          if (
            autoApply &&
            currencyIsSol &&
            appliedForMintRef.current !== applyKey &&
            !floorValueRef.current.trim()
          ) {
            appliedForMintRef.current = applyKey
            onApplyFloorRef.current(json.floorDisplay)
          }
        } else {
          setStatus('missing')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
    }
    // Intentionally omit onApplyFloor / currency — auto-apply is once per mint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintTrim, collectionTrim, autoApply])

  if (status === 'idle') return null

  const currencyIsSol = currency.trim().toUpperCase() === 'SOL'
  const currentMatches = Boolean(floorDisplay && floorValue.trim() === floorDisplay)
  const showUseButton = status === 'found' && Boolean(floorDisplay) && currencyIsSol && !currentMatches

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground leading-relaxed" role="status" aria-live="polite">
        {status === 'loading'
          ? 'Looking up collection floor on Tensor, Magic Eden, and Orbis…'
          : null}
        {status === 'found' && floorDisplay && currencyIsSol
          ? `Market floor ${floorDisplay} SOL${sourceLabel ? ` (${sourceLabel})` : ''}${
              collectionName ? ` · ${collectionName}` : ''
            }. You can edit this — it sets the draw goal.`
          : null}
        {status === 'found' && floorDisplay && !currencyIsSol
          ? `Market floor is ${floorDisplay} SOL${sourceLabel ? ` on ${sourceLabel}` : ''}. Enter prize value in ${currency}.`
          : null}
        {status === 'missing'
          ? 'No collection floor found. Enter the prize value manually.'
          : null}
        {status === 'error'
          ? 'Could not load market floor. Enter the prize value manually.'
          : null}
      </p>
      {showUseButton ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] touch-manipulation"
          onClick={() => {
            if (floorDisplay) onApplyFloor(floorDisplay)
          }}
        >
          Use market floor ({floorDisplay} SOL)
        </Button>
      ) : null}
    </div>
  )
}
