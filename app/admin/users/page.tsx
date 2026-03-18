'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Users, Loader2, ArrowLeft } from 'lucide-react'
import { getCachedAdmin, getCachedAdminRole } from '@/lib/admin-check-cache'

type UserRow = {
  wallet: string
  rafflesCreated: number
  creatorRevenue: number
  creatorRevenueByCurrency: Record<string, number>
  entriesCount: number
  totalSpent: number
  totalSpentByCurrency: Record<string, number>
}

function formatCurrency(byCurrency: Record<string, number>): string {
  const parts = Object.entries(byCurrency)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .map(([cur, amt]) => `${amt.toFixed(cur === 'USDC' ? 2 : 4)} ${cur}`)
  return parts.length ? parts.join(' + ') : '—'
}

export default function AdminUsersPage() {
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFullAdmin, setIsFullAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsFullAdmin(false)
      setLoading(false)
      return
    }
    const addr = publicKey.toBase58()
    const cached = getCachedAdmin(addr)
    const role = getCachedAdminRole(addr)
    if (cached === false) {
      setIsFullAdmin(false)
      setLoading(false)
      return
    }
    if (cached === true && role === 'full') {
      setIsFullAdmin(true)
      setLoading(true)
      setError(null)
      fetch('/api/admin/users', { credentials: 'include' })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load users')
          return res.json()
        })
        .then(setUsers)
        .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
        .finally(() => setLoading(false))
      return
    }
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`)
      .then((r) => r.json())
      .then((data: { isAdmin?: boolean; role?: string }) => {
        if (data?.isAdmin && data?.role === 'full') {
          setIsFullAdmin(true)
          setLoading(true)
          fetch('/api/admin/users', { credentials: 'include' })
            .then((res) => res.ok ? res.json() : Promise.reject(new Error('Failed to load')))
            .then(setUsers)
            .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
            .finally(() => setLoading(false))
        } else {
          setIsFullAdmin(false)
          setLoading(false)
        }
      })
      .catch(() => {
        setIsFullAdmin(false)
        setLoading(false)
      })
  }, [connected, publicKey])

  if (!connected) {
    return (
      <main className="container mx-auto px-4 py-8">
        <p className="mb-4">Connect your wallet to access admin.</p>
        <WalletConnectButton />
      </main>
    )
  }

  if (isFullAdmin === false) {
    return (
      <main className="container mx-auto px-4 py-8">
        <p className="mb-4">Full admin access required to view users.</p>
        <Link href="/admin">
          <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Owl Vision</Button>
        </Link>
      </main>
    )
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin">
          <Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" /> Owl Vision</Button>
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-8 w-8" />
          Users
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Per user (wallet address or username): raffles created, creator revenue from completed raffles, entries, and total spent from confirmed entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading users…
            </div>
          )}
          {error && (
            <p className="text-destructive py-4">{error}</p>
          )}
          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">User (wallet / name)</th>
                    <th className="text-right py-2 font-medium">Raffles</th>
                    <th className="text-right py-2 font-medium">Creator revenue</th>
                    <th className="text-right py-2 font-medium">Entries</th>
                    <th className="text-right py-2 font-medium">Total spent</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.wallet} className="border-b border-border/50">
                      <td className="py-2 font-mono text-xs truncate max-w-[180px]" title={u.wallet}>
                        {u.wallet}
                      </td>
                      <td className="py-2 text-right">{u.rafflesCreated}</td>
                      <td className="py-2 text-right whitespace-nowrap">{formatCurrency(u.creatorRevenueByCurrency)}</td>
                      <td className="py-2 text-right">{u.entriesCount}</td>
                      <td className="py-2 text-right whitespace-nowrap">{formatCurrency(u.totalSpentByCurrency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && !error && users.length === 0 && (
            <p className="text-muted-foreground py-4">No user data yet.</p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
