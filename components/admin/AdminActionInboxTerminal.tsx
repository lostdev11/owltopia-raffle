'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Loader2, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AdminActionInboxItem, AdminActionInboxSeverity } from '@/lib/admin/action-inbox'
import {
  markAdminActionInboxItemRead,
  markAllAdminActionInboxItemsRead,
  readAdminActionInboxReadMap,
} from '@/lib/admin/action-inbox-read'

const SEVERITY_PREFIX: Record<AdminActionInboxSeverity, string> = {
  critical: '[!!]',
  warning: '[!]',
  info: '[i]',
}

function formatOccurredAt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString()
}

type Props = {
  wallet: string
  sessionReady: boolean
  adminRole: 'full' | null
  refreshTick: number
}

export function AdminActionInboxTerminal({ wallet, sessionReady, adminRole, refreshTick }: Props) {
  const [items, setItems] = useState<AdminActionInboxItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [readMap, setReadMap] = useState<Record<string, string>>({})
  const [bootLine, setBootLine] = useState(0)

  const enabled = sessionReady && adminRole === 'full' && !!wallet.trim()

  const loadInbox = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/action-inbox', { credentials: 'include', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not load action inbox')
        setItems([])
        return
      }
      const next = Array.isArray(data?.items) ? (data.items as AdminActionInboxItem[]) : []
      setItems(next)
      setReadMap(readAdminActionInboxReadMap(wallet))
    } catch {
      setError('Network error loading action inbox')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [enabled, wallet])

  useEffect(() => {
    if (!enabled) {
      setItems([])
      setError(null)
      return
    }
    void loadInbox()
  }, [enabled, loadInbox, refreshTick])

  useEffect(() => {
    if (!enabled || !expanded) return
    setBootLine(0)
    const id = window.setInterval(() => {
      setBootLine((n) => (n >= 3 ? n : n + 1))
    }, 120)
    return () => window.clearInterval(id)
  }, [enabled, expanded, loading, items.length])

  const unreadItems = useMemo(
    () => items.filter((item) => readMap[item.id] !== item.fingerprint),
    [items, readMap]
  )

  useEffect(() => {
    if (!enabled || loading) return
    if (unreadItems.length > 0) setExpanded(true)
  }, [enabled, loading, unreadItems.length])

  if (!enabled) return null

  const markRead = (item: AdminActionInboxItem) => {
    const next = markAdminActionInboxItemRead(wallet, item)
    setReadMap(next)
  }

  const markAllRead = () => {
    const next = markAllAdminActionInboxItemsRead(wallet, items)
    setReadMap(next)
  }

  return (
    <section
      className="mb-8 overflow-hidden rounded-lg border border-emerald-500/30 bg-zinc-950 text-emerald-100 shadow-lg"
      aria-label="Owl Vision action inbox"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 bg-zinc-900/90 px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 font-mono text-xs sm:text-sm">
          <Terminal className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <span className="truncate text-emerald-300">OWL_VISION // ACTION_INBOX</span>
          <span className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-400/90">
            {loading ? '…' : unreadItems.length} unread
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 touch-manipulation font-mono text-xs text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
            disabled={loading || items.length === 0 || unreadItems.length === 0}
            onClick={markAllRead}
          >
            Mark all read
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 touch-manipulation text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse action inbox' : 'Expand action inbox'}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="max-h-[min(70vh,480px)] overflow-y-auto px-3 py-3 font-mono text-xs leading-relaxed sm:px-4 sm:text-sm">
          {bootLine >= 1 && (
            <p className="text-emerald-500/70">
              {'>'} session authenticated · wallet {wallet.slice(0, 4)}…{wallet.slice(-4)}
            </p>
          )}
          {bootLine >= 2 && (
            <p className="text-emerald-500/70">
              {'>'} scanning unresolved platform actions…
            </p>
          )}

          {loading && (
            <p className="mt-2 flex items-center gap-2 text-emerald-300/80">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              loading queues
            </p>
          )}

          {error && !loading && <p className="mt-2 text-rose-400">{`[err] ${error}`}</p>}

          {!loading && !error && bootLine >= 3 && unreadItems.length === 0 && (
            <p className="mt-2 text-emerald-400">[OK] No unread actions — you are caught up.</p>
          )}

          {!loading && !error && unreadItems.length > 0 && (
            <ul className="mt-3 space-y-3">
              {unreadItems.map((item) => {
                const when = formatOccurredAt(item.occurredAt)
                return (
                  <li
                    key={item.id}
                    className="rounded border border-emerald-500/15 bg-zinc-900/60 p-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-emerald-200">
                          <span className="text-amber-300">{SEVERITY_PREFIX[item.severity]}</span>{' '}
                          <Link
                            href={item.href}
                            className="font-semibold underline decoration-emerald-500/40 underline-offset-2 hover:text-white"
                          >
                            {item.title}
                          </Link>
                        </p>
                        <p className="mt-1 text-emerald-300/80">{item.detail}</p>
                        {when && <p className="mt-1 text-[11px] text-emerald-500/60">{when}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11 touch-manipulation border-emerald-500/30 bg-transparent font-mono text-xs text-emerald-200 hover:bg-emerald-500/10"
                          asChild
                        >
                          <Link href={item.href}>Open</Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 touch-manipulation font-mono text-xs text-emerald-400 hover:bg-emerald-500/10"
                          onClick={() => markRead(item)}
                        >
                          Mark read
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {!loading && items.length > 0 && unreadItems.length < items.length && (
            <p className="mt-3 text-[11px] text-emerald-500/50">
              {items.length - unreadItems.length} item{items.length - unreadItems.length === 1 ? '' : 's'} marked read
              (hidden until state changes).
            </p>
          )}
        </div>
      )}

      {!expanded && (
        <div className="px-3 py-2 font-mono text-xs text-emerald-400/90 sm:px-4 sm:text-sm">
          {loading
            ? 'Scanning…'
            : unreadItems.length > 0
              ? `${unreadItems.length} unread action${unreadItems.length === 1 ? '' : 's'} — tap to expand`
              : '[OK] All caught up'}
        </div>
      )}
    </section>
  )
}
