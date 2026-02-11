'use client'

import { useEffect, useState } from 'react'
import { MarkdownContent } from '@/components/MarkdownContent'

export interface AnnouncementItem {
  id: string
  title: string
  body: string | null
  show_on_hero: boolean
  show_on_raffles: boolean
  mark_as_new?: boolean
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

type Placement = 'hero' | 'raffles'

interface AnnouncementsBlockProps {
  placement: Placement
  /** Optional class for the container */
  className?: string
  /** 'hero' = compact card style under logo; 'raffles' = banner above Active Raffles */
  variant?: 'hero' | 'raffles'
  /** When provided (e.g. from parent fetch), skip loading and use this list. Used for placement=raffles to avoid double fetch. */
  preloadedList?: AnnouncementItem[] | null
}

export function AnnouncementsBlock({ placement, className = '', variant, preloadedList }: AnnouncementsBlockProps) {
  const [list, setList] = useState<AnnouncementItem[]>(preloadedList ?? [])
  const [loading, setLoading] = useState(preloadedList === undefined)
  const effectiveVariant = variant ?? placement

  useEffect(() => {
    if (preloadedList !== undefined && preloadedList !== null) {
      setList(preloadedList)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/announcements?placement=${placement}`)
      .then((res) => (cancelled ? undefined : res.json()))
      .then((data) => {
        if (cancelled) return
        if (data && typeof data === 'object' && Array.isArray(data.announcements)) {
          setList(data.announcements)
        } else {
          setList(Array.isArray(data) ? data : [])
        }
      })
      .catch(() => {
        if (!cancelled) setList([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [placement, preloadedList])

  if (loading || list.length === 0) return null

  if (effectiveVariant === 'hero') {
    return (
      <div className={`w-full max-w-sm space-y-3 ${className}`}>
        {list.map((a) => (
          <div
            key={a.id}
            className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center opacity-0 animate-enter-fade-in"
            style={{ animationDelay: '0.2s', animationFillMode: 'forwards' as const }}
          >
            <div className="font-medium text-foreground">
              <MarkdownContent content={a.title} compact />
            </div>
            {a.body && (
              <div className="mt-1 text-sm text-muted-foreground">
                <MarkdownContent content={a.body} compact />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`w-full space-y-2 ${className}`}>
      {list.map((a) => (
        <div
          key={a.id}
          className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
        >
          <div className="font-medium text-foreground">
            <MarkdownContent content={a.title} compact />
          </div>
          {a.body && (
            <div className="mt-1 text-sm text-muted-foreground">
              <MarkdownContent content={a.body} compact />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
