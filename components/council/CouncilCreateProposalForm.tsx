'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CouncilProposalGuidance } from '@/components/council/CouncilProposalGuidance'
import { Loader2, ArrowLeft } from 'lucide-react'
import {
  getCouncilProposalWindowError,
  getMaxCouncilProposalEndDate,
  MAX_COUNCIL_PROPOSAL_DURATION_DAYS,
  MIN_OWL_TO_CREATE_PROPOSAL,
} from '@/lib/council/owl-proposal-rules'

const HEADER = 'X-Connected-Wallet'

/** `datetime-local` string (local) from a Date. */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function CouncilCreateProposalForm() {
  const router = useRouter()
  const { publicKey, connected, signMessage } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''

  const [form, setForm] = useState({
    title: '',
    summary: '',
    description: '',
    start_local: '',
    end_local: '',
  })
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const endDatetimeLocalMax = useMemo(() => {
    if (!form.start_local) return undefined
    const max = getMaxCouncilProposalEndDate(form.start_local)
    return max ? toDatetimeLocalValue(max) : undefined
  }, [form.start_local])

  const signInThenSubmit = async (): Promise<boolean> => {
    if (!publicKey || !signMessage) return false
    const walletAddr = publicKey.toBase58()
    const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
      credentials: 'include',
    })
    if (!nonceRes.ok) return false
    const { message } = (await nonceRes.json()) as { message: string }
    const messageBytes = new TextEncoder().encode(message)
    const signature = await signMessage(messageBytes)
    const signatureBase64 =
      typeof signature === 'string'
        ? btoa(signature)
        : btoa(String.fromCharCode(...new Uint8Array(signature)))

    const verifyRes = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        wallet: walletAddr,
        message,
        signature: signatureBase64,
      }),
    })
    return verifyRes.ok
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    if (!wallet) {
      setCreateError('Connect your wallet first.')
      return
    }
    if (!form.start_local || !form.end_local) {
      setCreateError('Start and end times are required.')
      return
    }

    const startIso = new Date(form.start_local).toISOString()
    const endIso = new Date(form.end_local).toISOString()
    const windowErr = getCouncilProposalWindowError(startIso, endIso)
    if (windowErr) {
      setCreateError(windowErr)
      return
    }

    setCreating(true)
    try {
      let okSession = true
      const sessionProbe = await fetch('/api/me/dashboard', {
        credentials: 'include',
        headers: { [HEADER]: wallet },
        cache: 'no-store',
      })
      if (sessionProbe.status === 401) {
        okSession = await signInThenSubmit()
      }
      if (!okSession) {
        setCreateError('Sign in with your wallet to create a proposal.')
        return
      }

      const res = await fetch('/api/council/proposals', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          [HEADER]: wallet,
        },
        body: JSON.stringify({
          title: form.title.trim(),
          summary: form.summary.trim(),
          description: form.description.trim(),
          start_time: startIso,
          end_time: endIso,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(typeof data.error === 'string' ? data.error : 'Could not create proposal')
        return
      }
      router.push('/council?submitted=pending')
      router.refresh()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="container mx-auto px-3 sm:px-4 py-8 max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="touch-manipulation">
        <Link href="/council" className="inline-flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Owl Council
        </Link>
      </Button>

      <Card className="border-green-500/25">
        <CardHeader>
          <CardTitle className="text-lg">Create a proposal</CardTitle>
          <CardDescription>
            For OWL holders with at least {MIN_OWL_TO_CREATE_PROPOSAL} OWL. The voting window (start → end) can be at
            most {MAX_COUNCIL_PROPOSAL_DURATION_DAYS} days. Submissions stay private until moderators in Owl Vision
            review and activate them — then they appear on Owl Council for voting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!connected ? (
            <p className="text-sm text-muted-foreground">Connect your wallet to continue.</p>
          ) : (
            <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
              <CouncilProposalGuidance />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="prop-title">Title</Label>
                  <Input
                    id="prop-title"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    required
                    minLength={1}
                    maxLength={300}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="prop-summary">Summary</Label>
                  <Input
                    id="prop-summary"
                    value={form.summary}
                    onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="prop-desc">Description (markdown)</Label>
                  <textarea
                    id="prop-desc"
                    className="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Be specific: what changes, for whom, by when? Markdown ok — open “Suggested outline” above to paste a starter template."
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prop-start">Start (local)</Label>
                  <Input
                    id="prop-start"
                    type="datetime-local"
                    value={form.start_local}
                    onChange={(e) => {
                      const start_local = e.target.value
                      setForm((f) => {
                        let end_local = f.end_local
                        if (start_local && end_local) {
                          const maxD = getMaxCouncilProposalEndDate(start_local)
                          if (maxD && new Date(end_local).getTime() > maxD.getTime()) {
                            end_local = toDatetimeLocalValue(maxD)
                          }
                        }
                        return { ...f, start_local, end_local }
                      })
                      setCreateError(null)
                    }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prop-end">End (local)</Label>
                  <Input
                    id="prop-end"
                    type="datetime-local"
                    value={form.end_local}
                    min={form.start_local || undefined}
                    max={endDatetimeLocalMax}
                    onChange={(e) => {
                      let end_local = e.target.value
                      if (form.start_local && end_local) {
                        const maxD = getMaxCouncilProposalEndDate(form.start_local)
                        if (maxD && new Date(end_local).getTime() > maxD.getTime()) {
                          end_local = toDatetimeLocalValue(maxD)
                        }
                      }
                      setForm((f) => ({ ...f, end_local }))
                      setCreateError(null)
                    }}
                    required
                  />
                  {form.start_local ? (
                    <p className="text-xs text-muted-foreground">
                      Must be after start, and no later than {MAX_COUNCIL_PROPOSAL_DURATION_DAYS} full days after the
                      start time you chose above.
                    </p>
                  ) : null}
                </div>
              </div>
              {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
              <Button type="submit" disabled={creating} className="min-h-[44px] touch-manipulation">
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
                Submit proposal
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
