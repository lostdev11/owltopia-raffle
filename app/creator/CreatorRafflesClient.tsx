'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RaffleCard } from '@/components/RaffleCard'
import type { Raffle } from '@/lib/types'

interface CreatorRafflesClientProps {
  initialRaffles: Raffle[]
}

export function CreatorRafflesClient({ initialRaffles }: CreatorRafflesClientProps) {
  const { publicKey, connected } = useWallet()
  const router = useRouter()
  const [raffles, setRaffles] = useState<Raffle[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (connected && publicKey) {
      // Filter raffles by connected wallet
      const walletAddress = publicKey.toBase58()
      const myRaffles = initialRaffles.filter(
        r => r.created_by_wallet?.toLowerCase() === walletAddress.toLowerCase()
      )
      setRaffles(myRaffles)
    } else {
      setRaffles([])
    }
  }, [connected, publicKey, initialRaffles])

  if (!connected || !publicKey) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Creator Dashboard</CardTitle>
            <CardDescription>
              Connect your wallet to view your raffles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Please connect your wallet to see raffles you've created.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">My Raffles</h1>
          <p className="text-muted-foreground mt-2">
            Manage your raffles and track earnings
          </p>
        </div>
        <Button onClick={() => router.push('/creator/new')}>
          Create New Raffle
        </Button>
      </div>

      {raffles.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No raffles yet</CardTitle>
            <CardDescription>
              You haven't created any raffles yet
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/creator/new')}>
              Create Your First Raffle
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {raffles.map(raffle => (
            <RaffleCard
              key={raffle.id}
              raffle={raffle}
              entries={[]}
              size="medium"
            />
          ))}
        </div>
      )}

      {/* Earnings summary */}
      {raffles.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Earnings Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Total Sales</p>
                <p className="text-2xl font-bold">
                  ${raffles.reduce((sum, r) => sum + (r.gross_sales_usdc || 0), 0).toFixed(2)} USDC
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Your Earnings</p>
                <p className="text-2xl font-bold text-green-600">
                  ${raffles.reduce((sum, r) => sum + (r.creator_earnings_usdc || 0), 0).toFixed(2)} USDC
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Platform Fees</p>
                <p className="text-2xl font-bold">
                  ${raffles.reduce((sum, r) => sum + (r.platform_earnings_usdc || 0), 0).toFixed(2)} USDC
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
