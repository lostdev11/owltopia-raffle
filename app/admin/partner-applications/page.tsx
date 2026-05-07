'use client'

import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { ArrowLeft, Inbox, Loader2 } from 'lucide-react'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletConnectButton } from '@/components/WalletConnectButton'

const STATUS_OPTIONS = ['new', 'contacted', 'active', 'closed'] as const
type ApplicationStatus = (typeof STATUS_OPTIONS)[number]

type PartnerApplication = {
  id: number
  project_name: string
  contact_name: string | null
  contact_handle: string
  wallet_address: string
  interested_tier: string
  details: string | null
  status: ApplicationStatus | string
  created_at: string
}

export default function AdminPartnerApplicationsPage() {
  const { connected, publicKey } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loadingAdmin, setLoadingAdmin] = useState(() => !cachedTrue)
  const [loadingList, setLoadingList] = useState(false)
  const [rows, setRows] = useState<PartnerApplication[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoadingAdmin(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoadingAdmin(false)
      return
    }
    setLoadingAdmin(true)
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
      })
      .catch(() => setIsAdmin(false))
      .finally(() => setLoadingAdmin(false))
  }, [connected, publicKey])

  useEffect(() => {
    if (!isAdmin) return
    setLoadingList(true)
    setError(null)
    fetch('/api/admin/partner-applications', { credentials: 'include' })
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) {
          setError(typeof json?.error === 'string' ? json.error : 'Could not load applications.')
          return
        }
        setRows(Array.isArray(json?.applications) ? json.applications : [])
      })
      .catch(() => setError('Could not load applications.'))
      .finally(() => setLoadingList(false))
  }, [isAdmin])

  const updateStatus = async (id: number, status: ApplicationStatus) => {
    setSavingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/partner-applications/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        application?: PartnerApplication
      }
      if (!res.ok || !json.application) {
        setError(typeof json.error === 'string' ? json.error : 'Could not update status.')
        return
      }
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, status: json.application!.status } : row)))
    } catch {
      setError('Could not update status.')
    } finally {
      setSavingId(null)
    }
  }

  if (!connected) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-12 text-center">
        <p className="mb-6 text-muted-foreground">Connect a full-admin wallet to review partner applications.</p>
        <WalletConnectButton />
      </div>
    )
  }

  if (loadingAdmin || isAdmin === null) {
    return (
      <div className="container mx-auto flex justify-center px-4 py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-12 text-center">
        <p className="mb-6 text-muted-foreground">Full Owl Vision access is required.</p>
        <Button asChild variant="outline" className="min-h-[44px] touch-manipulation">
          <Link href="/admin">Back to Owl Vision</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-6 min-h-[44px] touch-manipulation">
        <Link href="/admin">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Owl Vision
        </Link>
      </Button>

      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold sm:text-3xl">
        <Inbox className="h-7 w-7 shrink-0 text-violet-400" />
        Partner applications
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        New applications submitted from the public partner page. Add approved wallets in{' '}
        <Link href="/admin/partner-creators" className="text-primary underline-offset-4 hover:underline">
          Partner program creators
        </Link>
        .
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Incoming applications</CardTitle>
          <CardDescription>Newest first</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications yet.</p>
          ) : (
            <ul className="space-y-5 divide-y divide-border/60">
              {rows.map((row) => (
                <li key={row.id} className="space-y-2 pt-5 first:pt-0">
                  <p className="text-sm text-muted-foreground">
                    #{row.id} · {new Date(row.created_at).toLocaleString()} · status: {row.status}
                  </p>
                  <p className="text-base font-medium">{row.project_name}</p>
                  <p className="text-sm text-muted-foreground">
                    Contact: {row.contact_name || '—'} ({row.contact_handle})
                  </p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{row.wallet_address}</p>
                  <p className="text-sm">Tier: {row.interested_tier}</p>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map((status) => (
                      <Button
                        key={status}
                        type="button"
                        size="sm"
                        variant={row.status === status ? 'default' : 'outline'}
                        className="min-h-[40px] touch-manipulation"
                        disabled={savingId === row.id}
                        onClick={() => void updateStatus(row.id, status)}
                      >
                        {status}
                      </Button>
                    ))}
                    {row.status === 'active' ? (
                      <Button asChild size="sm" className="min-h-[40px] touch-manipulation">
                        <Link href="/admin/partner-creators">Allowlist wallet</Link>
                      </Button>
                    ) : null}
                  </div>
                  {row.details ? <p className="text-sm text-muted-foreground">{row.details}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
