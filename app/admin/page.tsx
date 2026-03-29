'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, BarChart3, Users, Trash2, CheckCircle2, Loader2, RotateCcw, Eye, ChevronDown, ChevronUp, Megaphone, DollarSign, Coins, Ticket, TrendingUp, Radar, Share2 } from 'lucide-react'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin } from '@/lib/admin-check-cache'
import { PLATFORM_NAME } from '@/lib/site-config'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'
import type { CreatorHealthRow } from '@/lib/db/creator-health'

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

/** From GET /api/admin/live-raffles — active raffles you can post to Discord */
interface LiveRaffleDiscordRow {
  id: string
  title: string
  slug: string
  endTime: string
  status: string | null
}

interface RafflePendingSummary {
  raffleId: string
  raffle: { id: string; slug: string; title: string }
  pendingEntries: Array<{
    id: string
    wallet_address: string
    ticket_quantity: number
    transaction_signature: string | null
    amount_paid: number
    currency: string
    created_at: string
  }>
  withTx: Array<{ id: string; transaction_signature: string | null }>
  withoutTx: Array<{ id: string }>
  currentScore: number
  potentialScore: number
  scoreImprovement: number
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { publicKey, connected, signMessage: walletSignMessage } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const visibilityTick = useVisibilityTick()
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const cachedRole = typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [adminRole, setAdminRole] = useState<'full' | 'raffle_creator' | null>(() => cachedRole)
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [adminCheckError, setAdminCheckError] = useState<string | null>(null)
  const [sessionReady, setSessionReady] = useState<boolean | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
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
  const [verifyErrorMessage, setVerifyErrorMessage] = useState<string | null>(null)
  const [verifyErrorSuggestion, setVerifyErrorSuggestion] = useState<string | null>(null)

  // Entries to confirm (Owl Vision) state
  const [entriesToConfirm, setEntriesToConfirm] = useState<{
    byRaffle: RafflePendingSummary[]
    summary: { totalPending: number; withTx: number; withoutTx: number; raffleCount: number }
  } | null>(null)
  const [loadingEntriesToConfirm, setLoadingEntriesToConfirm] = useState(false)
  const [verifyingRaffleId, setVerifyingRaffleId] = useState<string | null>(null)
  const [expandedConfirmRaffles, setExpandedConfirmRaffles] = useState<Set<string>>(new Set())
  const [removingEntryId, setRemovingEntryId] = useState<string | null>(null)
  const [bulkReverifyRunning, setBulkReverifyRunning] = useState(false)
  const [bulkReverifyResult, setBulkReverifyResult] = useState<{
    message?: string
    verified?: number
    processed?: number
    skippedTemporary?: number
    skippedFailed?: number
    errors?: string[]
  } | null>(null)

  // Projected revenue (confirmed entries; includes 7d/30d and threshold breakdown)
  const [revenue, setRevenue] = useState<import('@/app/api/admin/projected-revenue/route').ProjectedRevenueResponse | null>(null)
  const [revShareSchedule, setRevShareSchedule] = useState<{ next_date: string | null; total_sol: number | null; total_usdc: number | null } | null>(null)
  const [revShareScheduleSaving, setRevShareScheduleSaving] = useState(false)
  const [revShareScheduleEdit, setRevShareScheduleEdit] = useState({ next_date: '', total_sol: '', total_usdc: '' })
  const [loadingRevenue, setLoadingRevenue] = useState(false)
  const [autoRefreshTick, setAutoRefreshTick] = useState(0)

  const [creatorHealth, setCreatorHealth] = useState<CreatorHealthRow[]>([])
  const [loadingCreatorHealth, setLoadingCreatorHealth] = useState(false)

  const [liveDiscordRaffles, setLiveDiscordRaffles] = useState<LiveRaffleDiscordRow[] | null>(null)
  const [loadingLiveDiscord, setLoadingLiveDiscord] = useState(false)
  const [liveDiscordLoadError, setLiveDiscordLoadError] = useState<string | null>(null)
  const [pushingDiscordRaffleId, setPushingDiscordRaffleId] = useState<string | null>(null)
  const [liveDiscordMessage, setLiveDiscordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Keep dashboard data live while open and force a refresh each new day.
  useEffect(() => {
    const intervalMs = 60 * 1000
    const intervalId = setInterval(() => {
      setAutoRefreshTick((t) => t + 1)
    }, intervalMs)

    const now = new Date()
    const nextMidnight = new Date(now)
    nextMidnight.setHours(24, 0, 0, 0)
    const msUntilMidnight = Math.max(1_000, nextMidnight.getTime() - now.getTime())

    const midnightTimeoutId = setTimeout(() => {
      setAutoRefreshTick((t) => t + 1)
    }, msUntilMidnight)

    return () => {
      clearInterval(intervalId)
      clearTimeout(midnightTimeoutId)
    }
  }, [])

  const runAdminCheck = useCallback(async () => {
    if (!publicKey) return
    const addr = publicKey.toBase58()
    setAdminCheckError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = (data?.error as string) || 'Could not verify admin status.'
        setAdminCheckError(msg)
        setIsAdmin(false)
        setCachedAdmin(addr, false)
        return
      }
      const admin = data?.isAdmin === true
      const role = admin && data?.role ? data.role : null
      setCachedAdmin(addr, admin, role)
      setIsAdmin(admin)
      setAdminRole(role)
    } catch (e) {
      setAdminCheckError('Network error. Please check your connection and try again.')
      setIsAdmin(false)
    } finally {
      setLoading(false)
    }
  }, [publicKey])

  // Re-run when connection changes or user returns to tab so Owl Vision connects right away.
  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setAdminRole(null)
      setLoading(false)
      setAdminCheckError(null)
      setSessionReady(null)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setAdminRole(getCachedAdminRole(addr))
      setLoading(false)
      setAdminCheckError(null)
      return
    }
    runAdminCheck()
  }, [connected, publicKey, runAdminCheck, visibilityTick])

  // Junior admin (raffle_creator) must not see Owl Vision dashboard; redirect to create raffle
  useEffect(() => {
    if (isAdmin && sessionReady === true && adminRole === 'raffle_creator') {
      router.replace('/admin/raffles/new')
    }
  }, [isAdmin, sessionReady, adminRole, router])

  // Re-check session when connection/admin change or user returns to tab.
  useEffect(() => {
    if (!connected || !publicKey || !isAdmin) {
      setSessionReady(null)
      return
    }
    let cancelled = false
    fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (cancelled) return
        setSessionReady(res.ok)
      })
      .catch(() => {
        if (!cancelled) setSessionReady(false)
      })
    return () => { cancelled = true }
  }, [connected, publicKey, isAdmin, visibilityTick])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !walletSignMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const nonceRes = await fetch(
        `/api/auth/nonce?wallet=${encodeURIComponent(publicKey.toBase58())}`,
        { credentials: 'include' }
      )
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to get sign-in nonce')
      }
      const { message } = await nonceRes.json()
      const messageBytes = new TextEncoder().encode(message)
      const signature = await walletSignMessage(messageBytes)
      const signatureBase64 = typeof signature === 'string'
        ? btoa(signature)
        : btoa(String.fromCharCode(...new Uint8Array(signature)))
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          message,
          signature: signatureBase64,
        }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data?.error || 'Sign-in verification failed')
      }
      setSessionReady(true)
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, walletSignMessage])

  useEffect(() => {
    const fetchDeletedEntries = async () => {
      if (!connected || !publicKey || !isAdmin || !sessionReady) {
        return
      }

      setLoadingDeleted(true)
      try {
        const response = await fetch(
          `/api/admin/deleted-entries?wallet=${publicKey.toBase58()}`,
          { credentials: 'include', cache: 'no-store' }
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

    if (isAdmin && sessionReady) {
      fetchDeletedEntries()
    }
  }, [connected, publicKey, isAdmin, sessionReady, visibilityTick, autoRefreshTick])

  const fetchRestoredEntries = async () => {
    if (!connected || !publicKey || !isAdmin || !sessionReady) {
      return
    }

    setLoadingRestored(true)
    try {
      const response = await fetch(
        `/api/admin/restored-entries?wallet=${publicKey.toBase58()}`,
        { credentials: 'include', cache: 'no-store' }
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
    if (isAdmin && sessionReady) {
      fetchRestoredEntries()
    }
  }, [connected, publicKey, isAdmin, sessionReady, visibilityTick, autoRefreshTick])

  const fetchEntriesToConfirm = async () => {
    if (!connected || !publicKey || !isAdmin || !sessionReady) return

    setLoadingEntriesToConfirm(true)
    try {
      const response = await fetch(
        `/api/admin/entries-to-confirm?wallet=${publicKey.toBase58()}`,
        { credentials: 'include', cache: 'no-store' }
      )
      if (response.ok) {
        const data = await response.json()
        setEntriesToConfirm({
          byRaffle: data.byRaffle || [],
          summary: data.summary || {
            totalPending: 0,
            withTx: 0,
            withoutTx: 0,
            raffleCount: 0,
          },
        })
      }
    } catch (error) {
      console.error('Error fetching entries to confirm:', error)
    } finally {
      setLoadingEntriesToConfirm(false)
    }
  }

  useEffect(() => {
    if (isAdmin && sessionReady) {
      fetchEntriesToConfirm()
    }
  }, [connected, publicKey, isAdmin, sessionReady, visibilityTick, autoRefreshTick])

  useEffect(() => {
    const fetchRevenue = async () => {
      if (!connected || !publicKey || !isAdmin || !sessionReady) return
      setLoadingRevenue(true)
      try {
        const res = await fetch(
          `/api/admin/projected-revenue?wallet=${publicKey.toBase58()}`,
          { credentials: 'include', cache: 'no-store' }
        )
        if (res.ok) {
          const data = await res.json()
          setRevenue(data)
        }
      } catch (e) {
        console.error('Error fetching projected revenue:', e)
      } finally {
        setLoadingRevenue(false)
      }
    }
    if (isAdmin && sessionReady) fetchRevenue()
  }, [connected, publicKey, isAdmin, sessionReady, visibilityTick, autoRefreshTick])

  useEffect(() => {
    if (!connected || !publicKey || !isAdmin || !sessionReady || adminRole !== 'full') return
    let cancelled = false
    setLoadingCreatorHealth(true)
    fetch('/api/admin/creator-health', { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load creator health')
        return res.json() as Promise<{ creators: CreatorHealthRow[] }>
      })
      .then((data) => {
        if (!cancelled) setCreatorHealth(data.creators || [])
      })
      .catch((e) => console.error('Error fetching creator health:', e))
      .finally(() => {
        if (!cancelled) setLoadingCreatorHealth(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, isAdmin, sessionReady, adminRole, visibilityTick, autoRefreshTick])

  const fetchLiveRafflesForDiscord = useCallback(async () => {
    if (!connected || !publicKey || !isAdmin || !sessionReady || adminRole !== 'full') return
    setLoadingLiveDiscord(true)
    setLiveDiscordLoadError(null)
    try {
      const res = await fetch('/api/admin/live-raffles', { credentials: 'include', cache: 'no-store' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || 'Failed to load live raffles')
      }
      const data = (await res.json()) as { raffles?: LiveRaffleDiscordRow[] }
      setLiveDiscordRaffles(data.raffles ?? [])
    } catch (e) {
      console.error('fetchLiveRafflesForDiscord:', e)
      setLiveDiscordRaffles(null)
      setLiveDiscordLoadError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoadingLiveDiscord(false)
    }
  }, [connected, publicKey, isAdmin, sessionReady, adminRole])

  useEffect(() => {
    if (!connected || !publicKey || !isAdmin || !sessionReady || adminRole !== 'full') return
    void fetchLiveRafflesForDiscord()
  }, [connected, publicKey, isAdmin, sessionReady, adminRole, visibilityTick, autoRefreshTick, fetchLiveRafflesForDiscord])

  const handlePushLiveToDiscord = async (r: LiveRaffleDiscordRow) => {
    setPushingDiscordRaffleId(r.id)
    setLiveDiscordMessage(null)
    try {
      const res = await fetch('/api/admin/live-raffles/discord', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raffleId: r.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLiveDiscordMessage({
          type: 'error',
          text: (data as { error?: string }).error || 'Could not post to Discord',
        })
        return
      }
      setLiveDiscordMessage({ type: 'success', text: `Posted “${r.title}” to Discord.` })
    } catch (e) {
      console.error('handlePushLiveToDiscord:', e)
      setLiveDiscordMessage({ type: 'error', text: 'Network error. Try again.' })
    } finally {
      setPushingDiscordRaffleId(null)
    }
  }

  useEffect(() => {
    if (!connected || !publicKey || !isAdmin || !sessionReady) return
    const fetchRevShareSchedule = async () => {
      try {
        const res = await fetch(`/api/admin/rev-share-schedule?wallet=${publicKey.toBase58()}`, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (res.ok) {
          const data = await res.json()
          setRevShareSchedule(data)
          setRevShareScheduleEdit({
            next_date: data.next_date ?? '',
            total_sol: data.total_sol != null ? String(data.total_sol) : '',
            total_usdc: data.total_usdc != null ? String(data.total_usdc) : '',
          })
        }
      } catch (e) {
        console.error('Error fetching rev share schedule:', e)
      }
    }
    fetchRevShareSchedule()
  }, [connected, publicKey, isAdmin, sessionReady, visibilityTick, autoRefreshTick])

  const saveRevShareSchedule = async () => {
    if (!publicKey) return
    setRevShareScheduleSaving(true)
    try {
      const res = await fetch('/api/admin/rev-share-schedule', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          next_date: revShareScheduleEdit.next_date.trim() || null,
          total_sol: revShareScheduleEdit.total_sol === '' ? null : parseFloat(revShareScheduleEdit.total_sol),
          total_usdc: revShareScheduleEdit.total_usdc === '' ? null : parseFloat(revShareScheduleEdit.total_usdc),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setRevShareSchedule(data)
      }
    } catch (e) {
      console.error('Error saving rev share schedule:', e)
    } finally {
      setRevShareScheduleSaving(false)
    }
  }

  const handleBulkReverifyPending = async (currency?: 'USDC' | 'SOL' | 'OWL') => {
    if (!publicKey) return
    const label = currency ? `${currency} only` : 'all currencies'
    if (
      !confirm(
        `Re-verify up to 60 pending entries (${label}) that already have a transaction signature? Finds stuck tickets including completed raffles. Safe to run again until the queue is empty.`
      )
    ) {
      return
    }
    setBulkReverifyRunning(true)
    setBulkReverifyResult(null)
    try {
      const response = await fetch('/api/admin/reverify-pending-entries', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 60, ...(currency ? { currency } : {}) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setBulkReverifyResult({
          message: typeof data.error === 'string' ? data.error : 'Request failed',
          errors: [],
        })
      } else {
        setBulkReverifyResult(data)
        fetchEntriesToConfirm()
      }
    } catch {
      setBulkReverifyResult({ message: 'Network error', errors: [] })
    } finally {
      setBulkReverifyRunning(false)
    }
  }

  const handleBatchVerifyRaffle = async (raffleId: string) => {
    if (!publicKey) return

    setVerifyingRaffleId(raffleId)
    try {
      const response = await fetch('/api/admin/verify-entries', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raffleId,
          adminWallet: publicKey.toBase58(),
        }),
      })
      const data = await response.json()

      if (response.ok && data.success) {
        fetchEntriesToConfirm()
      }
    } catch (error) {
      console.error('Error batch verifying:', error)
    } finally {
      setVerifyingRaffleId(null)
    }
  }

  const handleRemovePendingEntry = async (entryId: string) => {
    if (!confirm('Remove this pending entry? It will be deleted and cannot be recovered.')) return
    setRemovingEntryId(entryId)
    try {
      const response = await fetch(`/api/entries/${entryId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (response.ok) {
        fetchEntriesToConfirm()
      } else {
        const data = await response.json().catch(() => ({}))
        alert(data.error || 'Failed to remove entry')
      }
    } catch (error) {
      console.error('Error removing entry:', error)
      alert('Failed to remove entry')
    } finally {
      setRemovingEntryId(null)
    }
  }

  const handleVerifyTransaction = async () => {
    if (!txSignature.trim()) return

    setVerifying(true)
    setVerifyResult(null)
    setVerifyError(null)
    setVerifyErrorMessage(null)
    setVerifyErrorSuggestion(null)

    try {
      const response = await fetch('/api/admin/verify-by-tx', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionSignature: txSignature.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setVerifyError(data.error || data.message || 'Failed to verify transaction')
        setVerifyErrorMessage(data.message ?? null)
        setVerifyErrorSuggestion(data.suggestion ?? null)
      } else {
        setVerifyResult(data)
        // Clear the input on success
        setTxSignature('')
        
        // If entry was restored, refresh the restored entries and entries-to-confirm lists
        if (data.restored) {
          setTimeout(() => {
            fetchRestoredEntries()
            fetchEntriesToConfirm()
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
              <CardTitle>Owl Vision</CardTitle>
              <CardDescription>Please connect your wallet to access Owl Vision</CardDescription>
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
    const walletAddr = publicKey?.toBase58() ?? ''
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>{adminCheckError ? 'Something went wrong' : 'Access Denied'}</CardTitle>
              <CardDescription>
                {adminCheckError
                  ? adminCheckError
                  : 'Only admins can access Owl Vision. Your wallet is not in the admins list.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {adminCheckError && (
                <Button onClick={() => runAdminCheck()} disabled={loading}>
                  Try again
                </Button>
              )}
              {walletAddr && (
                <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                  <p className="font-medium text-muted-foreground mb-1">Connected wallet</p>
                  <p className="font-mono break-all">{walletAddr}</p>
                  <p className="mt-2 text-muted-foreground text-xs">
                    If you should have access, contact the site owner.
                  </p>
                </div>
              )}
              <Button onClick={() => router.push('/raffles')} variant="outline">
                Go to Raffles
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (sessionReady === false) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Sign in to Owl Vision</CardTitle>
              <CardDescription>
                Prove ownership of your admin wallet by signing a one-time message. No transaction or fee is required.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {signInError && (
                <p className="text-sm text-destructive">{signInError}</p>
              )}
              <Button
                onClick={handleSignIn}
                disabled={signingIn || !walletSignMessage}
              >
                {signingIn ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Signing…
                  </>
                ) : (
                  'Sign in with wallet'
                )}
              </Button>
              {!walletSignMessage && (
                <p className="text-sm text-muted-foreground">
                  Your connected wallet does not support message signing. Try another wallet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (sessionReady !== true) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying session…
              </p>
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
          <h1 className="text-4xl font-bold mb-2">Owl Vision</h1>
          <p className="text-muted-foreground">
            Manage raffles and oversee the {PLATFORM_NAME} platform
          </p>
        </div>

        {/* Projected Revenue - confirmed entries only */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Projected Revenue
            </CardTitle>
            <CardDescription>
              Revenue is the total amount from tickets sold (confirmed entries). Any amount over the threshold (from raffle prizes/floors) is profit. Thresholds update automatically from your raffles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRevenue ? (
              <p className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </p>
            ) : revenue ? (
              <div className="space-y-6">
                {/* All-time totals */}
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3">All time</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                        <DollarSign className="h-4 w-4" />
                        USDC
                      </div>
                      <p className="text-2xl font-bold tabular-nums">
                        {revenue.allTime.usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                        <Coins className="h-4 w-4" />
                        SOL
                      </div>
                      <p className="text-2xl font-bold tabular-nums">
                        {revenue.allTime.sol.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                        <Ticket className="h-4 w-4" />
                        Tickets sold
                      </div>
                      <p className="text-2xl font-bold tabular-nums">
                        {revenue.allTime.ticketsSold.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-4">
                      <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                        <Users className="h-4 w-4" />
                        Confirmed entries
                      </div>
                      <p className="text-2xl font-bold tabular-nums">
                        {revenue.allTime.confirmedEntries.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 7-day and 30-day averages */}
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    7-day and 30-day
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="rounded-lg border p-4 space-y-3">
                      <p className="text-sm font-medium">Last 7 days</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">USDC</span>
                          <p className="font-semibold tabular-nums">{revenue.last7Days.usdc.toFixed(2)}</p>
                          <p className="text-xs text-muted-foreground">avg {revenue.avgPerDay7.usdc.toFixed(2)}/day</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">SOL</span>
                          <p className="font-semibold tabular-nums">{revenue.last7Days.sol.toFixed(4)}</p>
                          <p className="text-xs text-muted-foreground">avg {revenue.avgPerDay7.sol.toFixed(4)}/day</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">OWL</span>
                          <p className="font-semibold tabular-nums">{revenue.last7Days.owl.toFixed(4)}</p>
                          <p className="text-xs text-muted-foreground">avg {revenue.avgPerDay7.owl.toFixed(4)}/day</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tickets</span>
                          <p className="font-semibold tabular-nums">{revenue.last7Days.ticketsSold}</p>
                          <p className="text-xs text-muted-foreground">avg {(revenue.avgPerDay7.ticketsSold).toFixed(1)}/day</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border p-4 space-y-3">
                      <p className="text-sm font-medium">Last 30 days</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">USDC</span>
                          <p className="font-semibold tabular-nums">{revenue.last30Days.usdc.toFixed(2)}</p>
                          <p className="text-xs text-muted-foreground">avg {revenue.avgPerDay30.usdc.toFixed(2)}/day</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">SOL</span>
                          <p className="font-semibold tabular-nums">{revenue.last30Days.sol.toFixed(4)}</p>
                          <p className="text-xs text-muted-foreground">avg {revenue.avgPerDay30.sol.toFixed(4)}/day</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">OWL</span>
                          <p className="font-semibold tabular-nums">{revenue.last30Days.owl.toFixed(4)}</p>
                          <p className="text-xs text-muted-foreground">avg {revenue.avgPerDay30.owl.toFixed(4)}/day</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tickets</span>
                          <p className="font-semibold tabular-nums">{revenue.last30Days.ticketsSold}</p>
                          <p className="text-xs text-muted-foreground">avg {(revenue.avgPerDay30.ticketsSold).toFixed(1)}/day</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Revenue (tickets sold) and profit (amount over threshold) by currency */}
                {revenue.thresholds && revenue.byCurrency && (revenue.thresholds.usdc != null || revenue.thresholds.sol != null || revenue.thresholds.owl != null) && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">Revenue (tickets sold) &amp; profit</h3>
                    <p className="text-xs text-muted-foreground mb-3">Revenue is total from tickets sold. Profit is the amount over the threshold.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {revenue.byCurrency.usdc != null && revenue.thresholds.usdc != null && (
                        <div className="rounded-lg border p-4 space-y-2 bg-muted/20">
                          <p className="text-sm font-medium text-muted-foreground">USDC</p>
                          <p className="text-sm">Revenue (tickets sold): <span className="font-semibold tabular-nums">{revenue.allTime.usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
                          <p className="text-sm">Threshold: <span className="font-semibold tabular-nums">{revenue.thresholds.usdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
                          <p className="text-sm text-emerald-600 dark:text-emerald-400">Profit (over threshold): <span className="font-semibold tabular-nums">{revenue.byCurrency.usdc.profit.toFixed(2)}</span></p>
                        </div>
                      )}
                      {revenue.byCurrency.sol != null && revenue.thresholds.sol != null && (
                        <div className="rounded-lg border p-4 space-y-2 bg-muted/20">
                          <p className="text-sm font-medium text-muted-foreground">SOL</p>
                          <p className="text-sm">Revenue (tickets sold): <span className="font-semibold tabular-nums">{revenue.allTime.sol.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span></p>
                          <p className="text-sm">Threshold: <span className="font-semibold tabular-nums">{revenue.thresholds.sol.toLocaleString(undefined, { minimumFractionDigits: 4 })}</span></p>
                          <p className="text-sm text-emerald-600 dark:text-emerald-400">Profit (over threshold): <span className="font-semibold tabular-nums">{revenue.byCurrency.sol.profit.toFixed(4)}</span></p>
                        </div>
                      )}
                      {revenue.byCurrency.owl != null && revenue.thresholds.owl != null && (
                        <div className="rounded-lg border p-4 space-y-2 bg-muted/20">
                          <p className="text-sm font-medium text-muted-foreground">OWL</p>
                          <p className="text-sm">Revenue (tickets sold): <span className="font-semibold tabular-nums">{revenue.allTime.owl.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span></p>
                          <p className="text-sm">Threshold: <span className="font-semibold tabular-nums">{revenue.thresholds.owl.toLocaleString(undefined, { minimumFractionDigits: 4 })}</span></p>
                          <p className="text-sm text-emerald-600 dark:text-emerald-400">Profit (over threshold): <span className="font-semibold tabular-nums">{revenue.byCurrency.owl.profit.toFixed(4)}</span></p>
                        </div>
                      )}
                    </div>

                    {/* Rev Share: 50% of site fee revenue goes to holders */}
                    <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
                      <h3 className="text-sm font-semibold text-muted-foreground mb-2">Rev Share (50% to holders)</h3>
                      <p className="text-xs text-muted-foreground mb-3">Calculated from site fee revenue: 6% on non-holder creator tickets and 3% on holder creator tickets.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="font-medium text-muted-foreground mb-1">Site fee revenue</p>
                          <p className="tabular-nums">
                            <span><span className="font-semibold">{(revenue.platformFees?.sol != null ? revenue.platformFees.sol.toFixed(4) : '0.0000')}</span> SOL</span>
                            {' · '}
                            <span><span className="font-semibold">{(revenue.platformFees?.usdc != null ? revenue.platformFees.usdc.toFixed(2) : '0.00')}</span> USDC</span>
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-muted-foreground mb-1">Holders share (50%)</p>
                          <p className="tabular-nums">
                            <span><span className="font-semibold">{(revenue.platformFees?.sol != null ? (revenue.platformFees.sol * 0.5).toFixed(4) : '0.0000')}</span> SOL</span>
                            {' · '}
                            <span><span className="font-semibold">{(revenue.platformFees?.usdc != null ? (revenue.platformFees.usdc * 0.5).toFixed(2) : '0.00')}</span> USDC</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">No revenue data</p>
            )}
          </CardContent>
        </Card>

        {/* Next Rev Share — founder-editable date and total SOL/USDC for homepage */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Next Rev Share (homepage)
            </CardTitle>
            <CardDescription>
              Set the date and total amounts for the next rev share. Shown on the main page. Not auto-calculated — add and edit as needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
              <div>
                <Label htmlFor="rev-next-date">Next rev share date</Label>
                <Input
                  id="rev-next-date"
                  type="text"
                  placeholder="e.g. 28 Feb"
                  value={revShareScheduleEdit.next_date}
                  onChange={(e) => setRevShareScheduleEdit((p) => ({ ...p, next_date: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="rev-total-sol">Total SOL to be shared</Label>
                <Input
                  id="rev-total-sol"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="e.g. 2"
                  value={revShareScheduleEdit.total_sol}
                  onChange={(e) => setRevShareScheduleEdit((p) => ({ ...p, total_sol: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="rev-total-usdc">Total USDC to be shared (optional)</Label>
                <Input
                  id="rev-total-usdc"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="e.g. 100"
                  value={revShareScheduleEdit.total_usdc}
                  onChange={(e) => setRevShareScheduleEdit((p) => ({ ...p, total_usdc: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>
            <Button
              onClick={saveRevShareSchedule}
              disabled={revShareScheduleSaving}
              className="mt-4"
            >
              {revShareScheduleSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </CardContent>
        </Card>

        {adminRole === 'full' && (
          <Card className="mb-8 border-amber-500/20 bg-amber-500/[0.03]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Radar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                Creator Radar
              </CardTitle>
              <CardDescription>
                Per-creator signals to spot raffles that may struggle to sell out or clash with platform rules: min-ticket extensions (deadline extended once when the ticket minimum was not met at end), edits after entries, cancellation requests, blocked purchases, weak sell-through on completed raffles, and pending ticket rows that still need verification.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCreatorHealth ? (
                <p className="text-muted-foreground flex items-center gap-2 touch-manipulation min-h-[44px]">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Loading creator metrics…
                </p>
              ) : creatorHealth.length === 0 ? (
                <p className="text-sm text-muted-foreground">No creator data yet.</p>
              ) : (
                <div className="overflow-x-auto -mx-1 px-1 touch-pan-x" style={{ WebkitOverflowScrolling: 'touch' }}>
                  <table className="w-full text-sm border-collapse min-w-[720px]">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Creator</th>
                        <th className="py-2 pr-2 font-medium tabular-nums">Health</th>
                        <th className="py-2 pr-2 font-medium tabular-nums" title="Total raffles">Raffles</th>
                        <th className="py-2 pr-2 font-medium tabular-nums" title="Completed">
                          Done
                        </th>
                        <th className="py-2 pr-2 font-medium tabular-nums" title="Min-ticket extensions (threshold not met at end; one deadline extension before refunds)">
                          Ext
                        </th>
                        <th className="py-2 pr-2 font-medium tabular-nums" title="Edited after entries">
                          Edit+
                        </th>
                        <th className="py-2 pr-2 font-medium tabular-nums" title="Cancellation requested">
                          Canc req
                        </th>
                        <th className="py-2 pr-2 font-medium tabular-nums" title="Purchases blocked by admin">
                          Block
                        </th>
                        <th className="py-2 pr-2 font-medium tabular-nums" title="Cancelled raffles">
                          Xl
                        </th>
                        <th className="py-2 pr-2 font-medium tabular-nums" title="Completed but sold under half of max tickets">
                          Weak
                        </th>
                        <th className="py-2 font-medium tabular-nums" title="Pending entries (unverified tickets)">
                          Pend
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {creatorHealth.map((row) => {
                        const h = row.healthScore
                        const healthClass =
                          h >= 70
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : h >= 40
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-red-600 dark:text-red-400'
                        return (
                          <tr key={row.wallet} className="border-b border-border/60">
                            <td className="py-2.5 pr-3 align-top">
                              <a
                                href={`https://solscan.io/account/${encodeURIComponent(row.wallet)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs break-all text-primary underline-offset-2 hover:underline touch-manipulation min-h-[44px] inline-flex items-center"
                              >
                                {row.wallet.length > 12
                                  ? `${row.wallet.slice(0, 6)}…${row.wallet.slice(-6)}`
                                  : row.wallet}
                              </a>
                            </td>
                            <td className={`py-2.5 pr-2 tabular-nums font-semibold ${healthClass}`}>{row.healthScore}</td>
                            <td className="py-2.5 pr-2 tabular-nums text-muted-foreground">{row.rafflesTotal}</td>
                            <td className="py-2.5 pr-2 tabular-nums text-muted-foreground">{row.completed}</td>
                            <td className="py-2.5 pr-2 tabular-nums">{row.minTicketExtensions > 0 ? row.minTicketExtensions : '—'}</td>
                            <td className="py-2.5 pr-2 tabular-nums">{row.editedAfterEntries > 0 ? row.editedAfterEntries : '—'}</td>
                            <td className="py-2.5 pr-2 tabular-nums">{row.cancellationRequested > 0 ? row.cancellationRequested : '—'}</td>
                            <td className="py-2.5 pr-2 tabular-nums">{row.purchasesBlocked > 0 ? row.purchasesBlocked : '—'}</td>
                            <td className="py-2.5 pr-2 tabular-nums">{row.cancelled > 0 ? row.cancelled : '—'}</td>
                            <td className="py-2.5 pr-2 tabular-nums">{row.weakSellthrough > 0 ? row.weakSellthrough : '—'}</td>
                            <td className="py-2.5 tabular-nums">{row.pendingEntries > 0 ? row.pendingEntries : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!loadingCreatorHealth && creatorHealth.length > 0 && (
                <p className="text-xs text-muted-foreground mt-4">
                  <strong className="text-foreground">Health</strong> is a 0–100 heuristic (higher is better): it down-weights extensions, post-entry edits, moderation flags, cancellations, weak sell-through, and pending verifications. Use it for triage, not as proof of bad behavior.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {adminRole === 'full' && (
          <Card className="mb-8 border-violet-500/20 bg-violet-500/[0.03]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                Share live raffles to Discord
              </CardTitle>
              <CardDescription>
                Lists raffles that are still active (end time in the future). Post to Discord sends an embed with a direct
                link to that raffle page. Set <span className="font-mono text-xs">DISCORD_WEBHOOK_LIVE_RAFFLES</span> in
                env (or use <span className="font-mono text-xs">DISCORD_WEBHOOK_URL</span> as fallback). Winner draws
                stay on each raffle’s admin edit page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => void fetchLiveRafflesForDiscord()}
                disabled={loadingLiveDiscord}
                className="touch-manipulation min-h-[44px]"
              >
                {loadingLiveDiscord ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" />
                    Refreshing…
                  </>
                ) : (
                  'Refresh list'
                )}
              </Button>
              {liveDiscordLoadError && liveDiscordRaffles === null && (
                <p className="text-sm text-destructive">{liveDiscordLoadError}</p>
              )}
              {liveDiscordMessage && (
                <p
                  className={
                    liveDiscordMessage.type === 'success'
                      ? 'text-sm text-emerald-600 dark:text-emerald-400'
                      : 'text-sm text-destructive'
                  }
                >
                  {liveDiscordMessage.text}
                </p>
              )}
              {!liveDiscordLoadError &&
                (loadingLiveDiscord || liveDiscordRaffles === null ? (
                  <p className="text-muted-foreground flex items-center gap-2 min-h-[44px]">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Loading…
                  </p>
                ) : liveDiscordRaffles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active raffles to share right now.</p>
                ) : (
                  <div className="overflow-x-auto -mx-1 px-1 touch-pan-x" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <table className="w-full text-sm border-collapse min-w-[600px]">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Raffle</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 pr-3 font-medium">Ends</th>
                          <th className="py-2 font-medium min-w-[220px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveDiscordRaffles.map((r) => (
                          <tr key={r.id} className="border-b border-border/60">
                            <td className="py-2.5 pr-3 align-top">
                              <div className="font-medium text-foreground">{r.title}</div>
                              <div className="text-xs text-muted-foreground font-mono mt-0.5 break-all">{r.slug}</div>
                            </td>
                            <td className="py-2.5 pr-3 align-top text-muted-foreground whitespace-nowrap">
                              {r.status ?? '—'}
                            </td>
                            <td className="py-2.5 pr-3 align-top text-muted-foreground whitespace-nowrap">
                              {(() => {
                                const d = new Date(r.endTime)
                                return Number.isNaN(d.getTime()) ? r.endTime : d.toLocaleString()
                              })()}
                            </td>
                            <td className="py-2.5 align-top">
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => void handlePushLiveToDiscord(r)}
                                  disabled={pushingDiscordRaffleId === r.id || loadingLiveDiscord}
                                  className="touch-manipulation min-h-[44px]"
                                >
                                  {pushingDiscordRaffleId === r.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                  ) : (
                                    'Post to Discord'
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  asChild
                                  className="touch-manipulation min-h-[44px]"
                                >
                                  <Link href={`/raffles/${encodeURIComponent(r.slug)}`}>View</Link>
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  asChild
                                  className="touch-manipulation min-h-[44px]"
                                >
                                  <Link href={`/admin/raffles/${r.id}`}>Edit</Link>
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}

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
            <Link href="/admin/raffles">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Manage All Raffles
                </CardTitle>
                <CardDescription>
                  View and manage all raffles, including past raffles. Delete raffles from here.
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card className="hover:border-primary transition-colors cursor-pointer">
            <Link href="/admin/announcements">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5" />
                  Announcements
                </CardTitle>
                <CardDescription>
                  Manage announcements on the landing page, raffles page, and Announcements tab. Mark as new to show a notification icon for users.
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          {adminRole === 'full' && (
            <Card className="hover:border-primary transition-colors cursor-pointer">
              <Link href="/admin/users">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Users
                  </CardTitle>
                  <CardDescription>
                    Track creators and entrants: raffles created, creator revenue, entries, and total spent per wallet.
                  </CardDescription>
                </CardHeader>
              </Link>
            </Card>
          )}

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

          <Card className="hover:border-primary transition-colors cursor-pointer">
            <Link href="/admin/raffles/deleted">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5" />
                  Deleted Raffles
                </CardTitle>
                <CardDescription>
                  View creator-deleted raffles history and open the public page for review.
                </CardDescription>
              </CardHeader>
            </Link>
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
                      setVerifyErrorMessage(null)
                      setVerifyErrorSuggestion(null)
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
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 space-y-2">
                  <p className="text-sm text-red-600 dark:text-red-400 font-semibold">Error</p>
                  <p className="text-sm text-red-500 dark:text-red-300">{verifyError}</p>
                  {verifyErrorMessage && verifyErrorMessage !== verifyError && (
                    <p className="text-sm text-muted-foreground">{verifyErrorMessage}</p>
                  )}
                  {verifyErrorSuggestion && (
                    <p className="text-sm text-muted-foreground pt-1 border-t border-red-500/20">
                      <span className="font-medium">Suggestion:</span> {verifyErrorSuggestion}
                    </p>
                  )}
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

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Bulk re-verify stuck tickets
            </CardTitle>
            <CardDescription>
              One click: re-run verification for pending entries that already have a tx signature (any raffle
              status, including old USDC / pre-escrow). Uses up to 60 rows per run — repeat until no more confirm.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-11 touch-manipulation"
                disabled={bulkReverifyRunning}
                onClick={() => handleBulkReverifyPending()}
              >
                {bulkReverifyRunning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running…
                  </>
                ) : (
                  'Re-verify pending (all, up to 60)'
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 touch-manipulation"
                disabled={bulkReverifyRunning}
                onClick={() => handleBulkReverifyPending('USDC')}
              >
                USDC only (up to 60)
              </Button>
            </div>
            {bulkReverifyResult && (
              <div
                className={`rounded-lg border p-3 text-sm space-y-2 ${
                  bulkReverifyResult.verified && bulkReverifyResult.verified > 0
                    ? 'bg-green-500/10 border-green-500/20'
                    : 'bg-muted/50 border-border'
                }`}
              >
                {bulkReverifyResult.message && <p className="font-medium">{bulkReverifyResult.message}</p>}
                {bulkReverifyResult.processed != null && (
                  <p className="text-muted-foreground">
                    Processed {bulkReverifyResult.processed} · Confirmed {bulkReverifyResult.verified ?? 0} · Skipped
                    (temporary) {bulkReverifyResult.skippedTemporary ?? 0} · Skipped (failed){' '}
                    {bulkReverifyResult.skippedFailed ?? 0}
                  </p>
                )}
                {bulkReverifyResult.errors && bulkReverifyResult.errors.length > 0 && (
                  <details
                    className="text-xs"
                    open={
                      (bulkReverifyResult.skippedFailed ?? 0) > 0 ||
                      ((bulkReverifyResult.verified ?? 0) === 0 &&
                        (bulkReverifyResult.errors?.length ?? 0) > 0)
                    }
                  >
                    <summary className="cursor-pointer text-muted-foreground py-1">Error details</summary>
                    <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto font-mono break-all">
                      {bulkReverifyResult.errors.slice(0, 40).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                      {bulkReverifyResult.errors.length > 40 && (
                        <li>… {bulkReverifyResult.errors.length - 40} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Entries to Confirm - Owl Vision Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Entries to Confirm
            </CardTitle>
            <CardDescription>
              Pending entries that improve Owl Vision scores when verified
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingEntriesToConfirm ? (
              <p className="text-center text-muted-foreground py-4">Loading...</p>
            ) : !entriesToConfirm || entriesToConfirm.summary.totalPending === 0 ? (
              <p className="text-center text-muted-foreground py-4">All entries confirmed</p>
            ) : (
              <div className="space-y-4">
                {entriesToConfirm.byRaffle.map((row) => {
                  const isExpanded = expandedConfirmRaffles.has(row.raffleId)
                  const toggleExpand = () => {
                    setExpandedConfirmRaffles((prev) => {
                      const next = new Set(prev)
                      if (next.has(row.raffleId)) next.delete(row.raffleId)
                      else next.add(row.raffleId)
                      return next
                    })
                  }
                  return (
                    <div
                      key={row.raffleId}
                      className="rounded-lg border overflow-hidden"
                    >
                      <div
                        className="flex items-center justify-between gap-4 p-3 cursor-pointer hover:bg-muted/50"
                        onClick={toggleExpand}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleExpand()
                          }
                        }}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? `Collapse ${row.raffle.title}` : `Expand ${row.raffle.title}`}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <Link
                            href={`/admin/raffles/${row.raffleId}`}
                            className="font-medium hover:underline text-sm truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.raffle.title}
                          </Link>
                        </div>
                        <span className="text-sm text-muted-foreground shrink-0">
                          {row.pendingEntries.length} pending
                        </span>
                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                          {row.withTx.length > 0 ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleBatchVerifyRaffle(row.raffleId)}
                              disabled={verifyingRaffleId === row.raffleId}
                            >
                              {verifyingRaffleId === row.raffleId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
                                  Verify
                                </>
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Use TX tool above
                            </span>
                          )}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t bg-muted/30 px-3 py-2 text-xs space-y-1">
                          {row.pendingEntries.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1"
                            >
                              <span className="font-mono text-muted-foreground break-all" title={entry.wallet_address}>
                                {entry.wallet_address}
                              </span>
                              <span className="text-muted-foreground">
                                {entry.ticket_quantity} tickets · {entry.amount_paid} {entry.currency}
                              </span>
                              {entry.transaction_signature ? (
                                <a
                                  href={`https://solscan.io/tx/${entry.transaction_signature}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-mono"
                                >
                                  Solscan ↗
                                </a>
                              ) : (
                                <span className="text-amber-600 dark:text-amber-400">
                                  No TX — use TX tool above
                                </span>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleRemovePendingEntry(entry.id)
                                }}
                                disabled={removingEntryId === entry.id}
                              >
                                {removingEntryId === entry.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                                    Remove
                                  </>
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
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