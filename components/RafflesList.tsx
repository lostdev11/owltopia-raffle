'use client'

import { useState, useEffect } from 'react'
import { RaffleCard } from '@/components/RaffleCard'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import type { Raffle, Entry } from '@/lib/types'
import { LayoutGrid, Grid3x3, Square } from 'lucide-react'

type CardSize = 'small' | 'medium' | 'large'

interface RafflesListProps {
  rafflesWithEntries: Array<{ raffle: Raffle; entries: Entry[] }>
  title?: string
  showViewSizeControls?: boolean
  size?: CardSize
  onSizeChange?: (size: CardSize) => void
}

export function RafflesList({ 
  rafflesWithEntries, 
  title,
  showViewSizeControls = true,
  size: controlledSize,
  onSizeChange
}: RafflesListProps) {
  const [internalSize, setInternalSize] = useState<CardSize>('medium')
  const [filteredRaffles, setFilteredRaffles] = useState(rafflesWithEntries)
  const size = controlledSize ?? internalSize
  const setSize = onSizeChange ?? setInternalSize

  // Update filtered raffles when props change (e.g., after server refresh)
  useEffect(() => {
    setFilteredRaffles(rafflesWithEntries)
  }, [rafflesWithEntries])

  // Callback to remove a raffle from the list (client-side immediate update)
  const handleRaffleDeleted = (raffleId: string) => {
    console.log('handleRaffleDeleted called, removing raffle:', raffleId)
    setFilteredRaffles(prev => {
      const filtered = prev.filter(({ raffle }) => raffle.id !== raffleId)
      console.log('Filtered raffles count:', filtered.length, 'from', prev.length)
      return filtered
    })
  }

  const gridClasses = {
    small: 'flex flex-col gap-3',
    medium: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6',
    large: 'grid grid-cols-1 lg:grid-cols-2 gap-8',
  }

  if (filteredRaffles.length === 0) {
    return null
  }

  return (
    <div>
      {title && (
        <h2 className="text-2xl font-bold mb-6">{title}</h2>
      )}
      {showViewSizeControls && (
        <div className="flex items-center justify-end gap-2 mb-6">
          <span className="text-sm text-muted-foreground mr-2">View size:</span>
          <div className="flex gap-1 border rounded-md p-1">
            <Button
              variant={size === 'small' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSize('small')}
              className="h-8 px-3"
              title="Small"
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={size === 'medium' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSize('medium')}
              className="h-8 px-3"
              title="Medium"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={size === 'large' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSize('large')}
              className="h-8 px-3"
              title="Large"
            >
              <Square className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <div className={gridClasses[size]}>
        {filteredRaffles.map(({ raffle, entries }, index) => (
          <RaffleCard 
            key={raffle.id} 
            raffle={raffle} 
            entries={entries} 
            size={size}
            onDeleted={handleRaffleDeleted}
            priority={index < 6} // Prioritize first 6 images (above the fold)
          />
        ))}
      </div>
    </div>
  )
}
