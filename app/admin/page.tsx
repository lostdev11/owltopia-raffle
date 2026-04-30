'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { OwlVisionDisclosure } from '@/components/OwlVisionDisclosure'
import { Plus, BarChart3, Users, Trash2, CheckCircle2, Loader2, RotateCcw, Megaphone, DollarSign, Coins, Ticket, TrendingUp, Radar, Share2, ListTodo, Gift, Radio, Banknote, Construction, HeartHandshake, Landmark } from 'lucide-react'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin } from '@/lib/admin-check-cache'
import { PLATFORM_NAME } from '@/lib/site-config'
import { useVisibilityTick } from '@/lib/hooks/useVisibilityTick'
import type { CreatorHealthRow } from '@/lib/db/creator-health'
import { DEV_TASK_MAX_SCREENSHOTS_TOTAL, type DevTask } from '@/lib/db/dev-tasks-model'
import { DEV_TASK_SCREENSHOT_MAX_BYTES, DEV_TASK_SCREENSHOT_MAX_FILES } from '@/lib/dev-task-screenshot-limits'

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

interface LiveRaffleXTemplate {
  id: string
  label: string
  text: string
  intentUrl: string
}

interface PendingCancellationRow {
  id: string
  slug: string
  title: string
  status: string | null
  cancellation_requested_at: string | null
  cancellation_fee_paid_at: string | null
}

function isoToLocalDatetimeValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { publicKey, connected, signMessage: walletSignMessage } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const visibilityTick = useVisibilityTick()
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const cachedRole = typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [adminRole, setAdminRole] = useState<'full' | null>(() => cachedRole)
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

  const [bulkReverifyRunning, setBulkReverifyRunning] = useState(false)
  const [bulkReverifyResult, setBulkReverifyResult] = useState<{
    message?: string
    verified?: number
    processed?: number
    skippedTemporary?: number
    skippedFailed?: number
    errors?: string[]
  } | null>(null)

  const [pendingManualRefundRaffles, setPendingManualRefundRaffles] = useState<
    Array<{
      raffleId: string
      slug: string
      title: string
      status: string | null
      currency: string | null
      unrefundedEntryCount: number
    }>
  >([])
  const [loadingPendingManualRefunds, setLoadingPendingManualRefunds] = useState(false)
  const [pendingCancellationRaffles, setPendingCancellationRaffles] = useState<PendingCancellationRow[]>([])
  const [loadingPendingCancellations, setLoadingPendingCancellations] = useState(false)

  // Projected revenue (confirmed entries; includes 7d/30d and threshold breakdown)
  const [revenue, setRevenue] = useState<import('@/app/api/admin/projected-revenue/route').ProjectedRevenueResponse | null>(null)
  const [revShareSchedule, setRevShareSchedule] = useState<{ next_date: string | null; total_sol: number | null; total_usdc: number | null } | null>(null)
  const [revShareScheduleSaving, setRevShareScheduleSaving] = useState(false)
  const [revShareScheduleEdit, setRevShareScheduleEdit] = useState({ next_date: '', total_sol: '', total_usdc: '' })
  const [loadingRevenue, setLoadingRevenue] = useState(false)
  const [autoRefreshTick, setAutoRefreshTick] = useState(0)

  const [creatorHealth, setCreatorHealth] = useState<CreatorHealthRow[]>([])
  const [loadingCreatorHealth, setLoadingCreatorHealth] = useState(false)

  const [siteMaint, setSiteMaint] = useState<{
    starts_at: string | null
    ends_at: string | null
    message: string | null
    updated_at: string
    updated_by_wallet: string | null
    publicActive: boolean
    scheduled: boolean
  } | null>(null)
  const [loadingSiteMaint, setLoadingSiteMaint] = useState(false)
  const [savingSiteMaint, setSavingSiteMaint] = useState(false)
  const [siteMaintStarts, setSiteMaintStarts] = useState('')
  const [siteMaintEnds, setSiteMaintEnds] = useState('')
  const [siteMaintMessage, setSiteMaintMessage] = useState('')
  const [siteMaintError, setSiteMaintError] = useState<string | null>(null)

  const [liveDiscordRaffles, setLiveDiscordRaffles] = useState<LiveRaffleDiscordRow[] | null>(null)
  const [loadingLiveDiscord, setLoadingLiveDiscord] = useState(false)
  const [liveDiscordLoadError, setLiveDiscordLoadError] = useState<string | null>(null)
  const [pushingDiscordRaffleId, setPushingDiscordRaffleId] = useState<string | null>(null)
  const [liveDiscordMessage, setLiveDiscordMessage] = useState<{
    type: 'success' | 'error'
    text: string
    raffleTitle?: string
    xTemplates?: LiveRaffleXTemplate[]
  } | null>(null)

  const [devTasks, setDevTasks] = useState<DevTask[]>([])
  const [loadingDevTasks, setLoadingDevTasks] = useState(false)
  const [devTaskTitle, setDevTaskTitle] = useState('')
  const [devTaskBody, setDevTaskBody] = useState('')
  const [devTaskSaving, setDevTaskSaving] = useState(false)
  const [devTaskError, setDevTaskError] = useState<string | null>(null)
  const [devTaskPhotoError, setDevTaskPhotoError] = useState<string | null>(null)
  const [devTaskActionId, setDevTaskActionId] = useState<string | null>(null)
  const [devTaskFiles, setDevTaskFiles] = useState<Array<{ file: File; url: string }>>([])
  const devTaskAppendInputRef = useRef<HTMLInputElement | null>(null)
  const devTaskAppendTaskIdRef = useRef<string | null>(null)

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

  const fetchPendingManualRefunds = async () => {
    if (!connected || !publicKey || !isAdmin || !sessionReady) return

    setLoadingPendingManualRefunds(true)
    try {
      const response = await fetch('/api/admin/pending-manual-refunds', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        setPendingManualRefundRaffles(Array.isArray(data.raffles) ? data.raffles : [])
      } else {
        setPendingManualRefundRaffles([])
      }
    } catch (error) {
      console.error('Error fetching pending manual refunds:', error)
      setPendingManualRefundRaffles([])
    } finally {
      setLoadingPendingManualRefunds(false)
    }
  }

  useEffect(() => {
    if (isAdmin && sessionReady) {
      fetchPendingManualRefunds()
    }
  }, [connected, publicKey, isAdmin, sessionReady, visibilityTick, autoRefreshTick])

  const fetchPendingCancellations = async () => {
    if (!connected || !publicKey || !isAdmin || !sessionReady) return
    setLoadingPendingCancellations(true)
    try {
      const response = await fetch('/api/raffles', {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) {
        setPendingCancellationRaffles([])
        return
      }
      const data = await response.json().catch(() => [])
      const rows = Array.isArray(data) ? data : []
      const next = rows
        .filter((row) => {
          if (!row || typeof row !== 'object') return false
          const status = String((row as { status?: unknown }).status ?? '').toLowerCase()
          const requestedAt = (row as { cancellation_requested_at?: unknown }).cancellation_requested_at
          return !!requestedAt && status !== 'cancelled'
        })
        .map((row) => {
          const item = row as Record<string, unknown>
          return {
            id: String(item.id ?? ''),
            slug: String(item.slug ?? ''),
            title: String(item.title ?? 'Untitled raffle'),
            status: item.status == null ? null : String(item.status),
            cancellation_requested_at:
              item.cancellation_requested_at == null ? null : String(item.cancellation_requested_at),
            cancellation_fee_paid_at:
              item.cancellation_fee_paid_at == null ? null : String(item.cancellation_fee_paid_at),
          } satisfies PendingCancellationRow
        })
        .filter((row) => row.id && row.slug)
        .sort((a, b) => {
          const aTs = a.cancellation_requested_at ? new Date(a.cancellation_requested_at).getTime() : 0
          const bTs = b.cancellation_requested_at ? new Date(b.cancellation_requested_at).getTime() : 0
          return bTs - aTs
        })
      setPendingCancellationRaffles(next)
    } catch (error) {
      console.error('Error fetching pending cancellations:', error)
      setPendingCancellationRaffles([])
    } finally {
      setLoadingPendingCancellations(false)
    }
  }

  useEffect(() => {
    if (isAdmin && sessionReady) {
      void fetchPendingCancellations()
    }
  }, [connected, publicKey, isAdmin, sessionReady, visibilityTick, autoRefreshTick])

  const fetchDevTasks = async () => {
    if (!connected || !publicKey || !isAdmin || !sessionReady) return
    setLoadingDevTasks(true)
    try {
      const res = await fetch('/api/admin/dev-tasks', { credentials: 'include', cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setDevTasks(Array.isArray(data) ? (data as DevTask[]) : [])
      }
    } catch (error) {
      console.error('Error fetching dev tasks:', error)
    } finally {
      setLoadingDevTasks(false)
    }
  }

  useEffect(() => {
    if (isAdmin && sessionReady) {
      void fetchDevTasks()
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
      const rawTemplates = Array.isArray((data as { xTemplates?: unknown }).xTemplates)
        ? ((data as { xTemplates: unknown[] }).xTemplates as LiveRaffleXTemplate[])
        : []
      const xTemplates = rawTemplates.filter((item) => {
        if (!item || typeof item !== 'object') return false
        const candidate = item as Partial<LiveRaffleXTemplate>
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.label === 'string' &&
          typeof candidate.text === 'string' &&
          typeof candidate.intentUrl === 'string'
        )
      })
      setLiveDiscordMessage({
        type: 'success',
        text: `Posted "${r.title}" to Discord.`,
        raffleTitle: r.title,
        xTemplates,
      })
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

  useEffect(() => {
    if (!connected || !publicKey || !isAdmin || !sessionReady || adminRole !== 'full') return
    let cancelled = false
    const run = async () => {
      setLoadingSiteMaint(true)
      setSiteMaintError(null)
      try {
        const res = await fetch('/api/admin/site-maintenance', { credentials: 'include', cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setSiteMaintError(typeof data.error === 'string' ? data.error : 'Could not load maintenance status')
          setSiteMaint(null)
          return
        }
        setSiteMaint({
          starts_at: data.starts_at ?? null,
          ends_at: data.ends_at ?? null,
          message: data.message ?? null,
          updated_at: data.updated_at ?? '',
          updated_by_wallet: data.updated_by_wallet ?? null,
          publicActive: Boolean(data.publicActive),
          scheduled: Boolean(data.scheduled),
        })
        setSiteMaintStarts(isoToLocalDatetimeValue(data.starts_at))
        setSiteMaintEnds(isoToLocalDatetimeValue(data.ends_at))
        setSiteMaintMessage(typeof data.message === 'string' ? data.message : '')
      } catch {
        if (!cancelled) setSiteMaintError('Network error loading maintenance status')
      } finally {
        if (!cancelled) setLoadingSiteMaint(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, isAdmin, sessionReady, adminRole, visibilityTick, autoRefreshTick])

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

  const applyQuickMaintMinutes = (minutes: number) => {
    const start = new Date()
    const end = new Date(start.getTime() + minutes * 60_000)
    setSiteMaintStarts(isoToLocalDatetimeValue(start.toISOString()))
    setSiteMaintEnds(isoToLocalDatetimeValue(end.toISOString()))
  }

  const patchSiteMaint = async (body: Record<string, unknown>) => {
    setSavingSiteMaint(true)
    setSiteMaintError(null)
    try {
      const res = await fetch('/api/admin/site-maintenance', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSiteMaintError(typeof data.error === 'string' ? data.error : 'Request failed')
        return
      }
      setSiteMaint({
        starts_at: data.starts_at ?? null,
        ends_at: data.ends_at ?? null,
        message: data.message ?? null,
        updated_at: data.updated_at ?? '',
        updated_by_wallet: data.updated_by_wallet ?? null,
        publicActive: Boolean(data.publicActive),
        scheduled: Boolean(data.scheduled),
      })
      setSiteMaintStarts(isoToLocalDatetimeValue(data.starts_at))
      setSiteMaintEnds(isoToLocalDatetimeValue(data.ends_at))
      setSiteMaintMessage(typeof data.message === 'string' ? data.message : '')
    } catch {
      setSiteMaintError('Network error. Try again.')
    } finally {
      setSavingSiteMaint(false)
    }
  }

  const saveSiteMaintWindow = async () => {
    if (!siteMaintStarts || !siteMaintEnds) {
      setSiteMaintError('Choose a start and end time.')
      return
    }
    const startMs = new Date(siteMaintStarts).getTime()
    const endMs = new Date(siteMaintEnds).getTime()
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      setSiteMaintError('Invalid start or end time.')
      return
    }
    await patchSiteMaint({
      starts_at: new Date(siteMaintStarts).toISOString(),
      ends_at: new Date(siteMaintEnds).toISOString(),
      message: siteMaintMessage.trim() || null,
    })
  }

  const clearDevTaskPendingFiles = () => {
    setDevTaskFiles((prev) => {
      prev.forEach((x) => URL.revokeObjectURL(x.url))
      return []
    })
  }

  const removeDevTaskFileAt = (index: number) => {
    setDevTaskFiles((prev) => {
      const next = [...prev]
      const [removed] = next.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.url)
      return next
    })
  }

  const onDevTaskScreenshotsSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDevTaskPhotoError(null)
    const list = e.target.files
    e.target.value = ''
    if (!list?.length) return
    setDevTaskFiles((prev) => {
      const next = [...prev]
      for (let i = 0; i < list.length; i++) {
        if (next.length >= DEV_TASK_SCREENSHOT_MAX_FILES) break
        const file = list[i]
        if (file.size < 1) continue
        if (file.size > DEV_TASK_SCREENSHOT_MAX_BYTES) {
          setDevTaskPhotoError(
            `Skipped "${file.name}" — larger than ${DEV_TASK_SCREENSHOT_MAX_BYTES / (1024 * 1024)}MB.`
          )
          continue
        }
        // Do not filter by MIME/filename here: mobile often sends empty type or odd names; the API validates.
        next.push({ file, url: URL.createObjectURL(file) })
      }
      return next
    })
  }

  const handleAddDevTask = async () => {
    const title = devTaskTitle.trim()
    if (!title) {
      setDevTaskError('Add a short title (for example from a Discord ticket).')
      return
    }
    setDevTaskError(null)
    setDevTaskPhotoError(null)
    setDevTaskSaving(true)
    try {
      if (devTaskFiles.length > 0) {
        const fd = new FormData()
        fd.set('title', title)
        const b = devTaskBody.trim()
        if (b) fd.set('body', b)
        for (const { file } of devTaskFiles) {
          fd.append('screenshots', file)
        }
        const res = await fetch('/api/admin/dev-tasks', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setDevTaskError(typeof data.error === 'string' ? data.error : 'Could not add task')
          return
        }
        clearDevTaskPendingFiles()
        setDevTaskTitle('')
        setDevTaskBody('')
        await fetchDevTasks()
        return
      }

      const res = await fetch('/api/admin/dev-tasks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body: devTaskBody.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDevTaskError(typeof data.error === 'string' ? data.error : 'Could not add task')
        return
      }
      setDevTaskTitle('')
      setDevTaskBody('')
      await fetchDevTasks()
    } catch {
      setDevTaskError('Network error. Check your connection and try again.')
    } finally {
      setDevTaskSaving(false)
    }
  }

  const openDevTaskAppendPicker = (taskId: string) => {
    devTaskAppendTaskIdRef.current = taskId
    setDevTaskPhotoError(null)
    requestAnimationFrame(() => {
      devTaskAppendInputRef.current?.click()
    })
  }

  const onDevTaskAppendSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const taskId = devTaskAppendTaskIdRef.current
    devTaskAppendTaskIdRef.current = null
    const list = e.target.files
    e.target.value = ''
    if (!taskId || !list?.length) return

    setDevTaskActionId(taskId)
    setDevTaskPhotoError(null)
    try {
      const fd = new FormData()
      for (let i = 0; i < list.length; i++) {
        fd.append('screenshots', list[i])
      }
      const res = await fetch(`/api/admin/dev-tasks/${taskId}/screenshots`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDevTaskPhotoError(typeof data.error === 'string' ? data.error : 'Could not upload photos')
        return
      }
      await fetchDevTasks()
    } catch {
      setDevTaskPhotoError('Network error while uploading photos.')
    } finally {
      setDevTaskActionId(null)
    }
  }

  const handleDevTaskStatus = async (id: string, status: 'open' | 'done') => {
    setDevTaskActionId(id)
    try {
      const res = await fetch(`/api/admin/dev-tasks/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) await fetchDevTasks()
    } catch (e) {
      console.error('handleDevTaskStatus:', e)
    } finally {
      setDevTaskActionId(null)
    }
  }

  const handleDeleteDevTask = async (id: string) => {
    if (!confirm('Remove this dev task permanently?')) return
    setDevTaskActionId(id)
    try {
      const res = await fetch(`/api/admin/dev-tasks/${id}`, { method: 'DELETE', credentials: 'include' })
      if (res.ok) await fetchDevTasks()
    } catch (e) {
      console.error('handleDeleteDevTask:', e)
    } finally {
      setDevTaskActionId(null)
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
      }
    } catch {
      setBulkReverifyResult({ message: 'Network error', errors: [] })
    } finally {
      setBulkReverifyRunning(false)
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
        
        // If entry was restored, refresh the restored entries list
        if (data.restored) {
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

        {adminRole === 'full' && (
          <OwlVisionDisclosure
            className="mb-8"
            variant="amber"
            title={
              <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Construction className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                Public maintenance window
              </span>
            }
          >
            <CardDescription className="mb-4">
              While the window is active, a scrolling banner appears at the top of the site warning that things may
              not work as expected. Set start and end in your local time; the optional message is included in the
              banner after the default notice.
            </CardDescription>
            <div className="space-y-4">
              {siteMaintError && <p className="text-sm text-destructive">{siteMaintError}</p>}
              {loadingSiteMaint ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading maintenance status…
                </p>
              ) : siteMaint ? (
                <>
                  <div className="rounded-lg border bg-background/60 p-3 text-sm space-y-1">
                    <p className="font-medium">
                      {siteMaint.publicActive
                        ? 'Banner is showing (maintenance window active).'
                        : siteMaint.scheduled
                          ? 'A window is scheduled (banner not shown until start time).'
                          : 'No active or scheduled window.'}
                    </p>
                    {siteMaint.starts_at && (
                      <p className="text-muted-foreground">
                        Start: {new Date(siteMaint.starts_at).toLocaleString()}
                      </p>
                    )}
                    {siteMaint.ends_at && (
                      <p className="text-muted-foreground">
                        End: {new Date(siteMaint.ends_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 touch-manipulation"
                      disabled={savingSiteMaint}
                      onClick={() => applyQuickMaintMinutes(15)}
                    >
                      From now · 15 min
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 touch-manipulation"
                      disabled={savingSiteMaint}
                      onClick={() => applyQuickMaintMinutes(60)}
                    >
                      From now · 1 hr
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 touch-manipulation"
                      disabled={savingSiteMaint}
                      onClick={() => applyQuickMaintMinutes(120)}
                    >
                      From now · 2 hr
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="site-maint-start">Start (local)</Label>
                      <Input
                        id="site-maint-start"
                        type="datetime-local"
                        className="mt-1.5 min-h-11 touch-manipulation"
                        value={siteMaintStarts}
                        onChange={(e) => setSiteMaintStarts(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="site-maint-end">End (local)</Label>
                      <Input
                        id="site-maint-end"
                        type="datetime-local"
                        className="mt-1.5 min-h-11 touch-manipulation"
                        value={siteMaintEnds}
                        onChange={(e) => setSiteMaintEnds(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="site-maint-msg">Optional message (appended in the scrolling banner)</Label>
                    <textarea
                      id="site-maint-msg"
                      rows={3}
                      className="mt-1.5 w-full min-h-[5.5rem] rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
                      value={siteMaintMessage}
                      onChange={(e) => setSiteMaintMessage(e.target.value)}
                      placeholder="e.g. Updating payment verification — back shortly."
                    />
                  </div>
                  <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                    <Button
                      type="button"
                      className="min-h-11 touch-manipulation"
                      disabled={savingSiteMaint}
                      onClick={() => void saveSiteMaintWindow()}
                    >
                      {savingSiteMaint ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Saving…
                        </>
                      ) : (
                        'Save window'
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 touch-manipulation"
                      disabled={savingSiteMaint || (!siteMaint.starts_at && !siteMaint.ends_at)}
                      onClick={() => void patchSiteMaint({ end_early: true })}
                    >
                      End early (set end to now)
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11 touch-manipulation text-destructive hover:text-destructive"
                      disabled={savingSiteMaint}
                      onClick={() => void patchSiteMaint({ clear: true })}
                    >
                      Clear window
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Could not load maintenance settings.</p>
              )}
            </div>
          </OwlVisionDisclosure>
        )}

        <OwlVisionDisclosure
          className="mb-8"
          variant="default"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <BarChart3 className="h-5 w-5 shrink-0" />
              Requested cancellations
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {loadingPendingCancellations ? '...' : pendingCancellationRaffles.length}
              </span>
            </span>
          }
        >
          <CardDescription className="mb-4">
            Track creator cancellation requests and jump directly to the raffle queue in Manage Raffles.
          </CardDescription>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button asChild className="min-h-11 touch-manipulation">
                <Link href="/admin/raffles#pending-cancellation">Open cancellation queue</Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 touch-manipulation"
                disabled={loadingPendingCancellations}
                onClick={() => void fetchPendingCancellations()}
              >
                {loadingPendingCancellations ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Refreshing...
                  </>
                ) : (
                  'Refresh'
                )}
              </Button>
            </div>
            {loadingPendingCancellations ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading cancellation requests...
              </p>
            ) : pendingCancellationRaffles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending cancellation requests right now.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Raffle</th>
                      <th className="px-3 py-2 font-medium">Requested</th>
                      <th className="px-3 py-2 font-medium">Fee</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingCancellationRaffles.slice(0, 8).map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{row.title}</div>
                          <div className="text-xs text-muted-foreground">/{row.slug}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.cancellation_requested_at
                            ? new Date(row.cancellation_requested_at).toLocaleString()
                            : '-'}
                        </td>
                        <td className="px-3 py-2">
                          {row.cancellation_fee_paid_at ? (
                            <span className="text-emerald-600 dark:text-emerald-400">Paid</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">Pending</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{row.status || '-'}</td>
                        <td className="px-3 py-2 text-right">
                          <Button asChild size="sm" variant="outline" className="touch-manipulation min-h-[44px]">
                            <Link href={`/admin/raffles/${row.id}`}>Review</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </OwlVisionDisclosure>

        {/* Dev tasks — backlog from Discord / support for platform fixes */}
        <OwlVisionDisclosure
          className="mb-8"
          variant="green"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <ListTodo className="h-5 w-5 shrink-0 text-green-500" />
              Dev tasks
            </span>
          }
        >
          <CardDescription className="mb-4">
            When users report issues in Discord, add a task here so nothing is lost. Open tasks are listed first; mark done when shipped or fixed. Attach screenshots from your phone gallery or desktop files (up to{' '}
            {DEV_TASK_SCREENSHOT_MAX_FILES} per upload, {DEV_TASK_MAX_SCREENSHOTS_TOTAL} per task).
            {devTasks.length > 0 && (
              <span className="block mt-1 text-foreground/80">
                {devTasks.filter((t) => t.status === 'open').length} open
                {devTasks.filter((t) => t.status === 'done').length > 0
                  ? ` · ${devTasks.filter((t) => t.status === 'done').length} done`
                  : ''}
              </span>
            )}
          </CardDescription>
          <div className="space-y-6">
            <div className="space-y-3 rounded-lg border bg-background/60 p-4">
              <p className="text-sm font-medium">Add task</p>
              <div>
                <Label htmlFor="dev-task-title">Title</Label>
                <Input
                  id="dev-task-title"
                  className="mt-1.5 min-h-11 touch-manipulation"
                  value={devTaskTitle}
                  onChange={(e) => setDevTaskTitle(e.target.value)}
                  placeholder="Short summary (e.g. Discord ticket, user report)"
                  maxLength={500}
                />
              </div>
              <div>
                <Label htmlFor="dev-task-body">Details (optional)</Label>
                <textarea
                  id="dev-task-body"
                  className="mt-1.5 flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation"
                  value={devTaskBody}
                  onChange={(e) => setDevTaskBody(e.target.value)}
                  placeholder="Steps to reproduce, links, wallet addresses, screenshots note…"
                  maxLength={8000}
                />
              </div>
              <div>
                <Label htmlFor="dev-task-screenshots">Screenshots (optional)</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-1.5">
                  On mobile, opens your photo library or camera roll; on desktop, any image files. Max {DEV_TASK_SCREENSHOT_MAX_FILES} images and{' '}
                  {DEV_TASK_SCREENSHOT_MAX_BYTES / (1024 * 1024)}MB each for this upload.
                </p>
                <input
                  id="dev-task-screenshots"
                  type="file"
                  accept="image/*"
                  multiple
                  className="min-h-11 w-full max-w-full cursor-pointer rounded-md border border-input bg-background px-2 py-2 text-sm file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm touch-manipulation"
                  onChange={onDevTaskScreenshotsSelected}
                />
                {devTaskFiles.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {devTaskFiles.map((item, i) => (
                      <div key={item.url} className="relative overflow-hidden rounded-md border bg-muted/20">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local object URLs from file picker */}
                        <img src={item.url} alt="" className="h-28 w-full object-cover" />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="absolute right-1 top-1 h-9 min-h-9 w-9 min-w-9 p-0 touch-manipulation"
                          onClick={() => removeDevTaskFileAt(i)}
                          aria-label={`Remove image ${i + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {(devTaskError || devTaskPhotoError) && (
                <p className="text-sm text-destructive">{devTaskError || devTaskPhotoError}</p>
              )}
              <Button
                type="button"
                className="min-h-11 w-full sm:w-auto touch-manipulation"
                onClick={() => void handleAddDevTask()}
                disabled={devTaskSaving || !devTaskTitle.trim()}
              >
                {devTaskSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-2">Add dev task</span>
              </Button>
            </div>

            {loadingDevTasks ? (
              <p className="text-muted-foreground flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading tasks…
              </p>
            ) : devTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No dev tasks yet.</p>
            ) : (
              <ul className="space-y-3">
                {devTasks.map((task) => {
                  const shortCreator =
                    task.created_by.length > 12
                      ? `${task.created_by.slice(0, 6)}…${task.created_by.slice(-4)}`
                      : task.created_by
                  const busy = devTaskActionId === task.id
                  return (
                    <li
                      key={task.id}
                      className={`rounded-lg border p-4 space-y-2 ${
                        task.status === 'done' ? 'opacity-75 bg-muted/20' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className={`font-medium text-sm sm:text-base ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                            {task.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Added {new Date(task.created_at).toLocaleString()} · {shortCreator}
                            {task.status === 'done' && task.completed_at && (
                              <> · Done {new Date(task.completed_at).toLocaleString()}</>
                            )}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:justify-end">
                          {(task.screenshot_urls?.length ?? 0) < DEV_TASK_MAX_SCREENSHOTS_TOTAL && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="min-h-11 flex-1 sm:flex-none touch-manipulation"
                              disabled={busy}
                              onClick={() => openDevTaskAppendPicker(task.id)}
                            >
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add photos'}
                            </Button>
                          )}
                          {task.status === 'open' ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="min-h-11 flex-1 sm:flex-none touch-manipulation"
                              disabled={busy}
                              onClick={() => void handleDevTaskStatus(task.id, 'done')}
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <CheckCircle2 className="h-4 w-4 mr-1.5 shrink-0" />
                                  Mark done
                                </>
                              )}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="min-h-11 flex-1 sm:flex-none touch-manipulation"
                              disabled={busy}
                              onClick={() => void handleDevTaskStatus(task.id, 'open')}
                            >
                              Reopen
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-11 flex-1 sm:flex-none text-destructive hover:text-destructive hover:bg-destructive/10 touch-manipulation"
                            disabled={busy}
                            onClick={() => void handleDeleteDevTask(task.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-1.5 shrink-0" />
                            Delete
                          </Button>
                        </div>
                      </div>
                      {task.body && (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words border-t border-border/50 pt-2">
                          {task.body}
                        </p>
                      )}
                      {(task.screenshot_urls?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-2 border-t border-border/50 pt-2">
                          {(task.screenshot_urls ?? []).map((url, imgIdx) => (
                            <a
                              key={`${task.id}-${imgIdx}`}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block max-w-full rounded-md border bg-muted/10 p-0.5 touch-manipulation"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URLs */}
                              <img
                                src={url}
                                alt={`Screenshot ${imgIdx + 1} for ${task.title}`}
                                className="max-h-44 max-w-[min(100%,220px)] rounded object-contain sm:max-h-52"
                                loading="lazy"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <input
              ref={devTaskAppendInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => void onDevTaskAppendSelected(e)}
            />
          </div>
        </OwlVisionDisclosure>

        {/* Projected Revenue - confirmed entries only */}
        <OwlVisionDisclosure
          className="mb-8"
          variant="default"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <DollarSign className="h-5 w-5 shrink-0" />
              Projected Revenue
            </span>
          }
        >
          <CardDescription className="mb-4">
            Revenue is the total amount from tickets sold (confirmed entries). Any amount over the threshold (from raffle prizes/floors) is profit. Thresholds update automatically from your raffles.
          </CardDescription>
          <div>
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
          </div>
        </OwlVisionDisclosure>

        {/* Next Rev Share — founder-editable date and total SOL/USDC for homepage */}
        <OwlVisionDisclosure
          className="mb-8"
          variant="default"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Coins className="h-5 w-5 shrink-0" />
              Next Rev Share (homepage)
            </span>
          }
        >
          <CardDescription className="mb-4">
            Set the date and total amounts for the next rev share. Shown on the main page. Not auto-calculated — add and edit as needed.
          </CardDescription>
          <div>
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
          </div>
        </OwlVisionDisclosure>

        {adminRole === 'full' && (
          <OwlVisionDisclosure
            className="mb-8"
            variant="amber-soft"
            title={
              <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Radar className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                Creator Radar
              </span>
            }
          >
            <CardDescription className="mb-4">
              Per-creator signals to spot raffles that may struggle to sell out or clash with platform rules: min-ticket extensions (deadline extended once when the ticket minimum was not met at end), edits after entries, cancellation requests, blocked purchases, weak sell-through on completed raffles, and pending ticket rows that still need verification.
            </CardDescription>
            <div>
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
            </div>
          </OwlVisionDisclosure>
        )}

        {adminRole === 'full' && (
          <OwlVisionDisclosure
            className="mb-8"
            variant="violet"
            title={
              <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Share2 className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
                Share live raffles to Discord
              </span>
            }
          >
            <CardDescription className="mb-4">
              Lists raffles that are still active (end time in the future). Post to Discord sends an embed with a direct
              link to that raffle page. Set <span className="font-mono text-xs">DISCORD_WEBHOOK_LIVE_RAFFLES</span> in
              env (or use <span className="font-mono text-xs">DISCORD_WEBHOOK_URL</span> as fallback). Winner draws
              stay on each raffle’s admin edit page.
            </CardDescription>
            <div className="space-y-4">
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
                <div className="space-y-2">
                  <p
                    className={
                      liveDiscordMessage.type === 'success'
                        ? 'text-sm text-emerald-600 dark:text-emerald-400'
                        : 'text-sm text-destructive'
                    }
                  >
                    {liveDiscordMessage.text}
                  </p>
                  {liveDiscordMessage.type === 'success' &&
                    Array.isArray(liveDiscordMessage.xTemplates) &&
                    liveDiscordMessage.xTemplates.length > 0 && (
                      <div className="rounded-md border border-violet-500/30 bg-violet-500/[0.05] p-3 space-y-2">
                        <p className="text-xs text-muted-foreground">
                          One-click X templates for &quot;{liveDiscordMessage.raffleTitle ?? 'this raffle'}&quot;:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {liveDiscordMessage.xTemplates.map((template) => (
                            <Button
                              key={template.id}
                              type="button"
                              variant="outline"
                              size="sm"
                              asChild
                              className="touch-manipulation min-h-[44px]"
                            >
                              <a href={template.intentUrl} target="_blank" rel="noopener noreferrer">
                                Post to X: {template.label}
                              </a>
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
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
            </div>
          </OwlVisionDisclosure>
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
            <>
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <Link href="/admin/community-giveaways">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Community pool giveaways
                    </CardTitle>
                    <CardDescription>
                      Primary NFT giveaway flow: open or holder-gated pools, optional entry deadline, OWL boost for 3×
                      draw weight before start, admin draw, winner claims from the dashboard.
                    </CardDescription>
                  </CardHeader>
                </Link>
              </Card>
              <Card className="hover:border-border transition-colors cursor-pointer border-dashed">
                <Link href="/admin/legacy-nft-giveaways">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Gift className="h-5 w-5" />
                      Legacy one-off NFT giveaways
                    </CardTitle>
                    <CardDescription>
                      Eligible-wallet claim links and Discord partner webhooks only. Prefer community pool giveaways above.
                    </CardDescription>
                  </CardHeader>
                </Link>
              </Card>
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <Link href="/admin/discord-giveaway-partners">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Radio className="h-5 w-5" />
                      Discord giveaway partners
                    </CardTitle>
                    <CardDescription>
                      Paid communities: channel webhook + API secret, optional pings on NFT giveaway verify/claim, or
                      they POST custom embeds to your API.
                    </CardDescription>
                  </CardHeader>
                </Link>
              </Card>
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <Link href="/admin/partner-creators">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HeartHandshake className="h-5 w-5" />
                      Partner program creators
                    </CardTitle>
                    <CardDescription>
                      Allowlist creator wallets for the 2% partner fee tier and partner raffles spotlight — add, edit,
                      activate, or remove without running SQL.
                    </CardDescription>
                  </CardHeader>
                </Link>
              </Card>
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <Link href="/admin/council">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Landmark className="h-5 w-5" />
                      Owl Council
                    </CardTitle>
                    <CardDescription>
                      Moderate proposal status. OWL holders create proposals from the site; votes are OWL-weighted.
                    </CardDescription>
                  </CardHeader>
                </Link>
              </Card>
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
            </>
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
        <OwlVisionDisclosure
          className="mb-8"
          variant="default"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              Verify & Restore Transaction
            </span>
          }
        >
          <CardDescription className="mb-4">
            Enter a transaction signature to verify and restore a ticket entry
          </CardDescription>
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
        </OwlVisionDisclosure>

        <OwlVisionDisclosure
          className="mb-8"
          variant="default"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              Bulk re-verify stuck tickets
            </span>
          }
        >
          <CardDescription className="mb-4">
            One click: re-run verification for pending entries that already have a tx signature (any raffle
            status, including old USDC / pre-escrow). Uses up to 60 rows per run — repeat until no more confirm.
          </CardDescription>
          <div className="space-y-4">
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
          </div>
        </OwlVisionDisclosure>

        <OwlVisionDisclosure
          className="mb-8"
          variant="teal"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Banknote className="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
              Manual ticket refunds
            </span>
          }
        >
          <CardDescription className="mb-4">
            After you send refunds from treasury or funds escrow, open a raffle below, select ticket rows, and paste
            the payout transaction signature so buyers see refunded/sent on their dashboards. Same tool as on each
            raffle&apos;s Owl Vision tab.
          </CardDescription>
          <div>
            {loadingPendingManualRefunds ? (
              <p className="text-center text-muted-foreground py-4">Loading…</p>
            ) : pendingManualRefundRaffles.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                No cancelled or refund-pending raffles with unmarked ticket refunds. (Live raffles with sales are not
                listed here.)
              </p>
            ) : (
              <ul className="space-y-2">
                {pendingManualRefundRaffles.map((r) => (
                  <li
                    key={r.raffleId}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border/80 bg-background/60 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate" title={r.title}>
                        {r.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.unrefundedEntryCount} ticket row{r.unrefundedEntryCount === 1 ? '' : 's'} pending mark ·{' '}
                        <span className="font-mono">{r.status ?? '—'}</span>
                        {r.currency ? ` · ${r.currency}` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="default"
                      className="shrink-0 min-h-11 touch-manipulation bg-teal-600 hover:bg-teal-700"
                      asChild
                    >
                      <Link href={`/admin/raffles/${r.raffleId}#manual-refunds`}>Record refunds</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </OwlVisionDisclosure>

        {/* Restored Entries Section */}
        <OwlVisionDisclosure
          className="mb-8"
          variant="default"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <RotateCcw className="h-5 w-5 shrink-0" />
              Restored Entries
            </span>
          }
        >
          <CardDescription className="mb-4">
            View all raffle entries that have been restored via transaction verification.
            This helps track wallets with multiple failed entries.
          </CardDescription>
          <div>
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
          </div>
        </OwlVisionDisclosure>

        {/* Deleted Entries Section */}
        <OwlVisionDisclosure
          className="mb-8"
          variant="default"
          title={
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Trash2 className="h-5 w-5 shrink-0" />
              Deleted Entries
            </span>
          }
        >
          <CardDescription className="mb-4">View all raffle entries that have been deleted</CardDescription>
          <div>
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
          </div>
        </OwlVisionDisclosure>
      </div>
    </div>
  )
}