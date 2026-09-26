'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionHeader } from '@/components/council/SectionHeader'

type FailedJob = {
  job_id: string
  wallet_address?: string
  total_claimed: number
  pending_nest_count: number
  last_error: string | null
  updated_at: string
}

export function AdminClaimAllJobsSection({ enabled }: { enabled: boolean }) {
  const [jobs, setJobs] = useState<FailedJob[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    fetch('/api/admin/nesting/claim-all-jobs?limit=15', { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        setJobs(Array.isArray(json.jobs) ? json.jobs : [])
        setQuery(typeof json.query === 'string' ? json.query : null)
      })
      .catch(() => {
        if (!cancelled) setJobs([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <section className="space-y-4" id="claim-all-jobs-admin">
      <SectionHeader
        title="Background Claim all jobs"
        description="Failed server-side Claim-all runs (fee reserved, batches did not finish). Support can inspect staking_claim_all_jobs in Supabase."
      />
      <Card className="rounded-xl border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Recent failures</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {loading ? <p className="text-muted-foreground">Loading…</p> : null}
          {!loading && jobs.length === 0 ? (
            <p className="text-muted-foreground">No failed Claim-all jobs in the last fetch.</p>
          ) : null}
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.job_id} className="rounded-lg border border-border/50 px-3 py-2">
                <p className="font-mono text-xs break-all">{j.job_id}</p>
                <p className="text-muted-foreground text-xs mt-1">
                  Pending nests: {j.pending_nest_count} · Claimed: {j.total_claimed} · Updated{' '}
                  {new Date(j.updated_at).toLocaleString()}
                </p>
                {j.last_error ? (
                  <p className="text-destructive text-xs mt-1 break-words">{j.last_error}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {query ? (
            <p className="text-xs text-muted-foreground font-mono break-all">SQL: {query}</p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}
