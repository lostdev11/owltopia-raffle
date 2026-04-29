'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import type { OwlProposalRow, OwlProposalStatus } from '@/lib/db/owl-council'
import { Loader2, ArrowLeft, Landmark } from 'lucide-react'

/**
 * Moderation: list all proposals and change status. Community creates via /council/create.
 */
export default function AdminCouncilPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [rows, setRows] = useState<OwlProposalRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [statusBusy, setStatusBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoading(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  const fetchList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch('/api/admin/council/proposals', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.proposals)) {
        const sorted = [...data.proposals].sort((a: OwlProposalRow, b: OwlProposalRow) => {
          const ad = a.status === 'draft' ? 0 : 1
          const bd = b.status === 'draft' ? 0 : 1
          if (ad !== bd) return ad - bd
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        })
        setRows(sorted)
      } else {
        setRows([])
      }
    } catch {
      setRows([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void fetchList()
  }, [isAdmin, fetchList])

  const patchStatus = async (slug: string, status: OwlProposalStatus) => {
    setStatusBusy(slug)
    try {
      const res = await fetch(`/api/admin/council/proposals/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) await fetchList()
    } finally {
      setStatusBusy(null)
    }
  }

  if (!connected) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-lg text-center space-y-4">
        <p className="text-muted-foreground">Connect a wallet to continue.</p>
        <WalletConnectButton />
      </div>
    )
  }

  if (loading || isAdmin === null) {
    return (
      <div className="container mx-auto px-4 py-16 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-lg text-center space-y-2">
        <p className="text-destructive font-medium">Admin only</p>
        <p className="text-sm text-muted-foreground">
          Owl holders create proposals from{' '}
          <Link href="/council/create" className="text-theme-prime underline underline-offset-2">
            Create proposal
          </Link>
          . This page is for moderators only.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/admin">Back to Owl Vision</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-8 max-w-4xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="ghost" size="sm" className="w-fit touch-manipulation">
          <Link href="/admin" className="inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Owl Vision
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/council">Public Council</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/council/create">Create proposal (OWL holders)</Link>
          </Button>
        </div>
      </div>

      <div>
        <h1 className="font-display text-2xl sm:text-3xl tracking-wide flex items-center gap-2">
          <Landmark className="h-7 w-7 text-theme-prime" aria-hidden />
          Owl Council moderation
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          New submissions arrive as <strong className="text-foreground font-medium">draft</strong> (hidden from the public).
          Set status to <strong className="text-foreground font-medium">active</strong> when you want it on Owl Council.
          OWL holders submit at{' '}
          <Link href="/council/create" className="text-theme-prime underline underline-offset-2">
            /council/create
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All proposals</CardTitle>
          <CardDescription>
            Drafts are pending your approval — they do not appear on /council until set to active.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No proposals yet.</p>
          ) : (
            <ul className="space-y-4">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-border/60 p-3 sm:p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground font-mono">{r.slug}</p>
                    <p className="text-xs text-muted-foreground">Creator: {r.created_by.slice(0, 8)}…</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {r.status === 'draft' ? (
                        <span className="text-xs text-muted-foreground py-1.5">
                          Not public until you set status to active
                        </span>
                      ) : (
                        <Button asChild variant="outline" size="sm" className="touch-manipulation">
                          <Link href={`/council/${encodeURIComponent(r.slug)}`}>Public page</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <select
                      className="flex h-10 rounded-md border border-input bg-background px-2 py-2 text-sm min-w-[140px]"
                      value={r.status}
                      disabled={statusBusy === r.slug}
                      onChange={(e) =>
                        void patchStatus(r.slug, e.target.value as OwlProposalStatus)
                      }
                    >
                      <option value="draft">draft — pending approval</option>
                      <option value="active">active — visible on Council</option>
                      <option value="ended">ended</option>
                      <option value="archived">archived</option>
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
