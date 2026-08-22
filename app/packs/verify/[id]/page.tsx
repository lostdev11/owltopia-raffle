'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react'

type VerifyPayload = {
  id: string
  status: string
  buyerWallet: string
  paymentSignature: string | null
  payoutSignature: string | null
  openAlgo: string
  openSeed: string | null
  openCommitHash: string | null
  category: string | null
  prizeLabel: string | null
  freeTicketCredits: number
  completedAt: string | null
  vrf: {
    provider: string
    status: string | null
    account: string | null
    requestTx: string | null
    fulfillTx: string | null
    error: string | null
  } | null
  verify: {
    commitMatches: boolean | null
    recomputedCategory: string | null
    recomputedNftMint: string | null
    nftSnapshotMatches: boolean | null
    expectedCommitHash: string
    randomnessSource: string
  } | null
}

function solscanTx(sig: string | null | undefined): string | null {
  if (!sig) return null
  return `https://solscan.io/tx/${encodeURIComponent(sig)}`
}

export default function PackVerifyPage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : ''
  const [data, setData] = useState<VerifyPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    void (async () => {
      try {
        const res = await fetch(`/api/packs/${id}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Not found')
        setData(json)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      }
    })()
  }, [id])

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link
        href="/packs"
        className="inline-flex items-center gap-1 text-sm text-emerald-400/80 hover:text-emerald-300"
      >
        <ArrowLeft className="h-4 w-4" /> Back to packs
      </Link>
      <h1 className="mt-4 font-serif text-3xl text-emerald-50">Verify pack open</h1>
      {error && <p className="mt-4 text-red-300">{error}</p>}
      {!data && !error && <p className="mt-4 text-emerald-100/50">Loading…</p>}
      {data && (
        <div className="mt-6 space-y-4 rounded-xl border border-white/10 bg-black/30 p-5 text-sm text-emerald-100/80">
          <Row label="Status" value={data.status} />
          <Row label="Prize" value={data.prizeLabel || '—'} />
          <Row label="Category" value={data.category || '—'} />
          <Row label="Buyer" value={data.buyerWallet} mono />
          <Row label="Algo" value={data.openAlgo} />
          <Row label="Commit" value={data.openCommitHash || '—'} mono />
          <Row label="Seed" value={data.openSeed || '(hidden until complete)'} mono />
          <Row label="Payment tx" value={data.paymentSignature || '—'} mono />
          <Row label="Payout tx" value={data.payoutSignature || '—'} mono />
          {data.vrf && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3">
              <p className="text-xs uppercase tracking-wide text-emerald-100/40">
                Switchboard VRF
              </p>
              <Row label="Status" value={data.vrf.status || '—'} />
              <Row label="Account" value={data.vrf.account || '—'} mono />
              {data.vrf.requestTx ? (
                <p className="text-xs">
                  Commit:{' '}
                  <a
                    className="text-emerald-400 underline"
                    href={solscanTx(data.vrf.requestTx) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {data.vrf.requestTx.slice(0, 12)}…
                  </a>
                </p>
              ) : null}
              {data.vrf.fulfillTx ? (
                <p className="text-xs">
                  Reveal:{' '}
                  <a
                    className="text-emerald-400 underline"
                    href={solscanTx(data.vrf.fulfillTx) ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {data.vrf.fulfillTx.slice(0, 12)}…
                  </a>
                </p>
              ) : null}
              {data.vrf.error ? (
                <p className="text-xs text-red-300">{data.vrf.error}</p>
              ) : null}
            </div>
          )}
          {data.verify && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-white/10 bg-black/40 p-3">
              {data.verify.commitMatches ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              )}
              <div>
                <p className="font-medium text-emerald-50">
                  Commit {data.verify.commitMatches ? 'matches' : 'mismatch'}
                </p>
                <p className="mt-1 text-xs text-emerald-100/50">
                  Randomness: {data.verify.randomnessSource}
                </p>
                <p className="mt-1 text-xs text-emerald-100/50">
                  Recomputed category: {data.verify.recomputedCategory ?? '—'}
                </p>
                {data.verify.recomputedNftMint ? (
                  <p className="mt-1 text-xs text-emerald-100/50">
                    Recomputed NFT mint: {data.verify.recomputedNftMint}
                    {data.verify.nftSnapshotMatches == null
                      ? ''
                      : data.verify.nftSnapshotMatches
                        ? ' (matches)'
                        : ' (mismatch)'}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-emerald-100/40">{label}</p>
      <p className={`mt-0.5 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  )
}
