'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

type Props = {
  busy: boolean
  onBusy: (busy: boolean) => void
  onError: (message: string | null) => void
}

export function AdminPacksResolveOpenPanel({ busy, onBusy, onError }: Props) {
  const [paymentSig, setPaymentSig] = useState('')
  const [manualPayoutSig, setManualPayoutSig] = useState('')
  const [lastOk, setLastOk] = useState<string | null>(null)

  async function runPayout() {
    onBusy(true)
    onError(null)
    setLastOk(null)
    try {
      const res = await fetch('/api/admin/packs/resolve-open', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentSignature: paymentSig.trim(), action: 'payout' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Resolve failed')
      setLastOk(`Paid stored prize — open ${json.result?.openId ?? ''}`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Resolve failed')
    } finally {
      onBusy(false)
    }
  }

  async function recordManual(resolution: 'prize_paid' | 'refund') {
    onBusy(true)
    onError(null)
    setLastOk(null)
    try {
      const res = await fetch('/api/admin/packs/resolve-open', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentSignature: paymentSig.trim(),
          action: 'record_manual',
          payoutSignature: manualPayoutSig.trim(),
          resolution,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Record failed')
      setLastOk(`Recorded ${resolution} — open ${json.result?.openId ?? ''}`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Record failed')
    } finally {
      onBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-4">
      <h3 className="text-sm font-semibold text-amber-100">Resolve open by payment signature</h3>
      <p className="mt-1 text-xs leading-relaxed text-white/55">
        Pays the committed prize without re-rolling, or records a manual payout/refund tx for{' '}
        <code className="text-amber-100/90">refund_needed</code> rows.
      </p>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="pack-resolve-payment-sig" className="text-xs text-white/70">
            Payment signature
          </Label>
          <Input
            id="pack-resolve-payment-sig"
            value={paymentSig}
            onChange={(e) => setPaymentSig(e.target.value)}
            placeholder="Buyer payment tx signature"
            className="mt-1 font-mono text-xs"
          />
        </div>
        <Button
          type="button"
          disabled={busy || !paymentSig.trim()}
          onClick={() => void runPayout()}
          className="w-full sm:w-auto"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Pay stored prize (vault)
        </Button>
        <div>
          <Label htmlFor="pack-resolve-manual-sig" className="text-xs text-white/70">
            Manual payout / refund signature
          </Label>
          <Input
            id="pack-resolve-manual-sig"
            value={manualPayoutSig}
            onChange={(e) => setManualPayoutSig(e.target.value)}
            placeholder="On-chain tx you sent manually"
            className="mt-1 font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || !paymentSig.trim() || !manualPayoutSig.trim()}
            onClick={() => void recordManual('prize_paid')}
          >
            Record manual prize tx
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !paymentSig.trim() || !manualPayoutSig.trim()}
            onClick={() => void recordManual('refund')}
          >
            Record manual refund
          </Button>
        </div>
        {lastOk ? <p className="text-xs text-[#00FF9C]/90">{lastOk}</p> : null}
      </div>
    </div>
  )
}
