'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Edit, BarChart3, Users, Trash2, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface DeletedEntry {
  id: string
  original_entry_id: string
  raffle_id: string
  wallet_address: string
  ticket_quantity: number
  transaction_signature: string | null
  status: string
  amount_paid: number
  currency: string
  created_at: string
  verified_at: string | null
  deleted_at: string
  deleted_by: string
}

interface RestoredEntry {
  id: string
  raffle_id: string
  wallet_address: string
  ticket_quantity: number
  transaction_signature: string | null
  status: string
  amount_paid: number
  currency: string
  created_at: string
  verified_at: string | null
  restored_at: string | null
  restored_by: string | null
  raffle?: {
    id: string
    slug: string
    title: string
  } | null
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [deletedEntries, setDeletedEntries] = useState<DeletedEntry[]>([])
  const [loadingDeleted, setLoadingDeleted] = useState(false)
  const [restoredEntries, setRestoredEntries] = useState<RestoredEntry[]>([])
  const [loadingRestored, setLoadingRestored] = useState(false)
  const [restoredByWallet, setRestoredByWallet] = useState<Array<{ wallet: string; count: number; entries: RestoredEntry[] }>>([])
  
  // Transaction verification state
  const [txSignature, setTxSignature] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!connected || !publicKey) {
        setIsAdmin(false)
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/admin/check?wallet=${publicKey.toBase58()}`)
        if (response.ok) {
          const data = await response.json()
          setIsAdmin(data.isAdmin)
        } else {
          setIsAdmin(false)
        }
      } catch (error) {
        console.error('Error checking admin status:', error)
        setIsAdmin(false)
      } finally {
        setLoading(false)
      }
    }

    checkAdminStatus()
  }, [connected, publicKey])

  useEffect(() => {
    const fetchDeletedEntries = async () => {
      if (!connected || !publicKey || !isAdmin) {
        return
      }

      setLoadingDeleted(true)
      try {
        const response = await fetch(
          `/api/admin/deleted-entries?wallet=${publicKey.toBase58()}`,
          {
            headers: {
              'x-wallet-address': publicKey.toBase58(),
            },
          }
        )
        if (response.ok) {
          const data = await response.json()
          setDeletedEntries(data.deletedEntries || [])
        } else {
          console.error('Failed to fetch deleted entries')
        }
      } catch (error) {
        console.error('Error fetching deleted entries:', error)
      } finally {
        setLoadingDeleted(false)
      }
    }

    if (isAdmin) {
      fetchDeletedEntries()
    }
  }, [connected, publicKey, isAdmin])

  const fetchRestoredEntries = async () => {
    if (!connected || !publicKey || !isAdmin) {
      return
    }

    setLoadingRestored(true)
    try {
      const response = await fetch(
        `/api/admin/restored-entries?wallet=${publicKey.toBase58()}`,
        {
          headers: {
            'authorization': `Bearer ${publicKey.toBase58()}`,
          },
        }
      )
      if (response.ok) {
        const data = await response.json()
        setRestoredEntries(data.restoredEntries || [])
        setRestoredByWallet(data.byWallet || [])
      } else {
        console.error('Failed to fetch restored entries')
      }
    } catch (error) {
      console.error('Error fetching restored entries:', error)
    } finally {
      setLoadingRestored(false)
    }
  }

  useEffect(() => {
    if (isAdmin) {
      fetchRestoredEntries()
    }
  }, [connected, publicKey, isAdmin])

  const handleVerifyTransaction = async () => {
    if (!txSignature.trim()) return

    setVerifying(true)
    setVerifyResult(null)
    setVerifyError(null)

    try {
      const response = await fetch('/api/admin/verify-by-tx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authorization': `Bearer ${publicKey?.toBase58() || ''}`,
        },
        body: JSON.stringify({
          transactionSignature: txSignature.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setVerifyError(data.error || data.message || 'Failed to verify transaction')
        if (data.details) {
          setVerifyError(`${data.error || 'Failed to verify transaction'}: ${data.details}`)
        }
      } else {
        setVerifyResult(data)
        // Clear the input on success
        setTxSignature('')
        
        // If entry was restored, refresh the restored entries list
        if (data.restored) {
          // Wait a moment for the database to update, then refresh
          setTimeout(() => {
            fetchRestoredEntries()
          }, 500)
        }
      }
    } catch (error) {
      console.error('Error verifying transaction:', error)
      setVerifyError('Network error. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">Checking admin status...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Admin Dashboard</CardTitle>
              <CardDescription>Please connect your wallet to access the admin dashboard</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <WalletConnectButton />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>
                Only admins can access this dashboard. Your wallet is not authorized.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push('/raffles')} variant="outline">
                Go to Raffles
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Manage raffles and oversee the Owl Raffle platform
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <Card className="hover:border-primary transition-colors cursor-pointer">
            <Link href="/admin/raffles/new">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  Create Raffle
                </CardTitle>
                <CardDescription>
                  Create a new raffle with custom settings and prizes
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card className="hover:border-primary transition-colors cursor-pointer">
            <Link href="/raffles">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  View All Raffles
                </CardTitle>
                <CardDescription>
                  Browse and manage all existing raffles
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Admin Access
              </CardTitle>
              <CardDescription>
                Connected wallet: {publicKey?.toBase58().slice(0, 8)}...
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        {/* Transaction Verification Tool */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Verify & Restore Transaction
            </CardTitle>
            <CardDescription>
              Enter a transaction signature to verify and restore a ticket entry
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label htmlFor="tx-signature">Transaction Signature</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="tx-signature"
                    type="text"
                    placeholder="Enter transaction signature (e.g., 3bKYi4WMqTTFTLsEpYA15ydGfSLdsQX9oyqgp7Qstb9B2tCTms7LSXAqJRP8YrdcwVbgaBk7FBW1ner2dRFArqdn)"
                    value={txSignature}
                    onChange={(e) => {
                      setTxSignature(e.target.value)
                      setVerifyResult(null)
                      setVerifyError(null)
                    }}
                    className="font-mono text-sm"
                    disabled={verifying}
                  />
                  <Button
                    onClick={handleVerifyTransaction}
                    disabled={!txSignature.trim() || verifying}
                  >
                    {verifying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Verify
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {verifyError && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-sm text-red-600 dark:text-red-400 font-semibold mb-1">Error</p>
                  <p className="text-sm text-red-500 dark:text-red-300">{verifyError}</p>
                </div>
              )}

              {verifyResult && (
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                  <p className="text-sm text-green-600 dark:text-green-400 font-semibold mb-2">
                    ✓ {verifyResult.message || 'Transaction verified successfully'}
                  </p>
                  {verifyResult.entry && (
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="font-semibold">Entry ID:</span>{' '}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">
                          {verifyResult.entry.id}
                        </code>
                      </div>
                      <div>
                        <span className="font-semibold">Wallet:</span>{' '}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">
                          {verifyResult.entry.wallet_address}
                        </code>
                      </div>
                      <div>
                        <span className="font-semibold">Tickets:</span> {verifyResult.entry.ticket_quantity}
                      </div>
                      <div>
                        <span className="font-semibold">Status:</span>{' '}
                        <span className="px-2 py-1 rounded text-xs bg-green-500/20 text-green-600 dark:text-green-400">
                          {verifyResult.entry.status}
                        </span>
                      </div>
                      {verifyResult.raffle && (
                        <div>
                          <span className="font-semibold">Raffle:</span> {verifyResult.raffle.title} ({verifyResult.raffle.slug})
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Restored Entries Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Restored Entries
            </CardTitle>
            <CardDescription>
              View all raffle entries that have been restored via transaction verification. 
              This helps track wallets with multiple failed entries.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRestored ? (
              <p className="text-center text-muted-foreground py-4">Loading restored entries...</p>
            ) : restoredEntries.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">No restored entries found.</p>
            ) : (
              <div className="space-y-6">
                {/* Summary by Wallet */}
                {restoredByWallet.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold mb-3">Wallets with Multiple Restored Entries</h3>
                    <div className="space-y-2">
                      {restoredByWallet
                        .filter(w => w.count > 1)
                        .map(({ wallet, count, entries }) => (
                          <div key={wallet} className="p-3 rounded-lg border bg-yellow-500/10 border-yellow-500/20">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-mono text-sm font-semibold">
                                {wallet.slice(0, 8)}...{wallet.slice(-6)}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {count} restored {count === 1 ? 'entry' : 'entries'}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground space-y-1">
                              {entries.map((entry) => (
                                <div key={entry.id} className="flex items-center gap-2">
                                  <span>• {entry.raffle?.title || 'Unknown Raffle'}</span>
                                  <span className="text-muted-foreground">
                                    ({entry.ticket_quantity} tickets, {entry.amount_paid} {entry.currency})
                                  </span>
                                  {entry.restored_at && (
                                    <span className="text-muted-foreground">
                                      • {new Date(entry.restored_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Full Table */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">All Restored Entries</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2 font-semibold">Entry ID</th>
                          <th className="text-left p-2 font-semibold">Raffle</th>
                          <th className="text-left p-2 font-semibold">Wallet</th>
                          <th className="text-left p-2 font-semibold">Tickets</th>
                          <th className="text-left p-2 font-semibold">Amount</th>
                          <th className="text-left p-2 font-semibold">Status</th>
                          <th className="text-left p-2 font-semibold">Created At</th>
                          <th className="text-left p-2 font-semibold">Restored At</th>
                          <th className="text-left p-2 font-semibold">Restored By</th>
                          <th className="text-left p-2 font-semibold">TX Signature</th>
                        </tr>
                      </thead>
                      <tbody>
                        {restoredEntries.map((entry) => (
                          <tr key={entry.id} className="border-b hover:bg-muted/50">
                            <td className="p-2 text-sm font-mono">
                              {entry.id.slice(0, 8)}...
                            </td>
                            <td className="p-2 text-sm">
                              {entry.raffle ? (
                                <div>
                                  <div className="font-medium">{entry.raffle.title}</div>
                                  <div className="text-xs text-muted-foreground">{entry.raffle.slug}</div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">Unknown</span>
                              )}
                            </td>
                            <td className="p-2 text-sm font-mono">
                              {entry.wallet_address.slice(0, 8)}...{entry.wallet_address.slice(-6)}
                            </td>
                            <td className="p-2 text-sm">{entry.ticket_quantity}</td>
                            <td className="p-2 text-sm">
                              {entry.amount_paid} {entry.currency}
                            </td>
                            <td className="p-2 text-sm">
                              <span
                                className={`px-2 py-1 rounded text-xs ${
                                  entry.status === 'confirmed'
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                    : entry.status === 'rejected'
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                }`}
                              >
                                {entry.status}
                              </span>
                            </td>
                            <td className="p-2 text-sm text-muted-foreground">
                              {new Date(entry.created_at).toLocaleString()}
                            </td>
                            <td className="p-2 text-sm text-muted-foreground">
                              {entry.restored_at ? (
                                <div>
                                  <div>{new Date(entry.restored_at).toLocaleString()}</div>
                                  <div className="text-xs text-muted-foreground">(tracked)</div>
                                </div>
                              ) : entry.verified_at ? (
                                <div>
                                  <div>{new Date(entry.verified_at).toLocaleString()}</div>
                                  <div className="text-xs text-muted-foreground">(likely restored)</div>
                                </div>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="p-2 text-sm font-mono">
                              {entry.restored_by ? (
                                <span>{entry.restored_by.slice(0, 8)}...</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="p-2 text-sm">
                              {entry.transaction_signature ? (
                                <a
                                  href={`https://solscan.io/tx/${entry.transaction_signature}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-mono text-xs"
                                >
                                  {entry.transaction_signature.slice(0, 8)}...
                                </a>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deleted Entries Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Deleted Entries
            </CardTitle>
            <CardDescription>
              View all raffle entries that have been deleted
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingDeleted ? (
              <p className="text-center text-muted-foreground py-4">Loading deleted entries...</p>
            ) : deletedEntries.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">No deleted entries found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2 font-semibold">Entry ID</th>
                      <th className="text-left p-2 font-semibold">Raffle ID</th>
                      <th className="text-left p-2 font-semibold">Wallet</th>
                      <th className="text-left p-2 font-semibold">Tickets</th>
                      <th className="text-left p-2 font-semibold">Amount</th>
                      <th className="text-left p-2 font-semibold">Status</th>
                      <th className="text-left p-2 font-semibold">Deleted At</th>
                      <th className="text-left p-2 font-semibold">Deleted By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedEntries.map((entry) => (
                      <tr key={entry.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 text-sm font-mono">
                          {entry.original_entry_id.slice(0, 8)}...
                        </td>
                        <td className="p-2 text-sm font-mono">
                          {entry.raffle_id.slice(0, 8)}...
                        </td>
                        <td className="p-2 text-sm font-mono">
                          {entry.wallet_address.slice(0, 8)}...{entry.wallet_address.slice(-6)}
                        </td>
                        <td className="p-2 text-sm">{entry.ticket_quantity}</td>
                        <td className="p-2 text-sm">
                          {entry.amount_paid} {entry.currency}
                        </td>
                        <td className="p-2 text-sm">
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              entry.status === 'confirmed'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : entry.status === 'rejected'
                                ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                            }`}
                          >
                            {entry.status}
                          </span>
                        </td>
                        <td className="p-2 text-sm text-muted-foreground">
                          {new Date(entry.deleted_at).toLocaleString()}
                        </td>
                        <td className="p-2 text-sm font-mono">
                          {entry.deleted_by.slice(0, 8)}...
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}