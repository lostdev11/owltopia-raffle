'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { PackOpenVideo } from '@/components/packs/PackOpenVideo'
import { executePackPurchase, type PackOpenClientResult } from '@/lib/client/execute-pack-purchase'
import { fireGreenConfetti } from '@/lib/confetti'
import { Gift, Loader2, Package, Sparkles, Ticket } from 'lucide-react'

type RipPhase = 'idle' | 'paying' | 'video' | 'reveal'

type PacksConfig = {
  product: {
    name: string
    priceSol: number
    rtpBps: number
    categoryWeightsBps: { owl: number; sol: number; nft: number }
  }
  odds: {
    owlTiers: { amount: number; weight: number }[]
    solTiers: { amountSol: number; weight: number }[]
    nftBands: { min: number; max: number; weight: number }[]
    owlToTicketRatio: number
  }
  vault: {
    address: string | null
    paused: boolean
    pauseReason: string | null
    availableNfts: number
  }
  ev: { targetEvSol: number; estimatedEvSol: number; estimatedRtpBps: number }
  recentOpens: {
    id: string
    wallet: string
    category: string | null
    prizeLabel: string | null
    freeTicketCredits: number
    completedAt: string | null
  }[]
}

function shortWallet(w: string) {
  return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

function RedeemCreditsForm({ onDone }: { onDone: () => void }) {
  const [raffleId, setRaffleId] = useState('')
  const [tickets, setTickets] = useState('1')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function redeem() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/packs/credits/redeem', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raffleId: raffleId.trim(),
          tickets: Number(tickets),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Redeem failed')
      setMsg(`Redeemed ${data.tickets} ticket(s)`)
      onDone()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Redeem failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
      <input
        className="w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-emerald-50"
        placeholder="Raffle UUID"
        value={raffleId}
        onChange={(e) => setRaffleId(e.target.value)}
      />
      <div className="flex gap-2">
        <input
          className="w-16 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-emerald-50"
          value={tickets}
          onChange={(e) => setTickets(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !raffleId.trim()}
          onClick={() => void redeem()}
          className="flex-1 rounded bg-emerald-600/80 px-2 py-1.5 text-xs font-medium text-emerald-50 hover:bg-emerald-500 disabled:opacity-40"
        >
          Redeem
        </button>
      </div>
      {msg && <p className="text-[11px] text-emerald-100/70">{msg}</p>}
    </div>
  )
}

export function PacksClient() {
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()
  const sendTransaction = useSendTransactionForWallet()
  const [config, setConfig] = useState<PacksConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ripping, setRipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PackOpenClientResult | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [phase, setPhase] = useState<RipPhase>('idle')
  const pendingResultRef = useRef<PackOpenClientResult | null>(null)
  const videoDoneRef = useRef(false)
  const videoStartedRef = useRef(false)
  const openErrorRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/packs')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setConfig(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load packs')
    }
  }, [])

  const loadCredits = useCallback(async () => {
    if (!publicKey) {
      setCredits(null)
      return
    }
    try {
      const res = await fetch(`/api/packs/credits?wallet=${publicKey.toBase58()}`)
      const data = await res.json()
      if (res.ok) setCredits(data.freeTicketCredits ?? 0)
    } catch {
      // ignore
    }
  }, [publicKey])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadCredits()
  }, [loadCredits])

  const tryReveal = useCallback(() => {
    if (openErrorRef.current) {
      setError(openErrorRef.current)
      setPhase('idle')
      setRipping(false)
      pendingResultRef.current = null
      videoDoneRef.current = false
      openErrorRef.current = null
      return
    }
    if (!videoDoneRef.current || !pendingResultRef.current) return
    const won = pendingResultRef.current
    pendingResultRef.current = null
    videoDoneRef.current = false
    setResult(won)
    setPhase('reveal')
    setRipping(false)
    fireGreenConfetti()
    void load()
    void loadCredits()
  }, [load, loadCredits])

  function onVideoFinished() {
    videoDoneRef.current = true
    tryReveal()
  }

  async function onRip() {
    if (!publicKey || !sendTransaction) return
    setError(null)
    setResult(null)
    pendingResultRef.current = null
    videoDoneRef.current = false
    openErrorRef.current = null
    setRipping(true)
    setPhase('paying')
    try {
      const out = await executePackPurchase({
        publicKey,
        connection,
        sendTransaction,
        onPaymentConfirmed: () => {
          // Payment landed — play opening video while prize resolves server-side
          setPhase('video')
        },
      })
      if (!out.ok) {
        openErrorRef.current = out.error
        // If video already started, wait for it (or skip) before surfacing error
        if (videoDoneRef.current || phase === 'paying') {
          setError(out.error)
          setPhase('idle')
          setRipping(false)
        } else {
          tryReveal()
        }
        return
      }
      pendingResultRef.current = out.result
      tryReveal()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Rip failed'
      openErrorRef.current = msg
      if (videoDoneRef.current) {
        setError(msg)
        setPhase('idle')
        setRipping(false)
      } else {
        tryReveal()
      }
    }
  }

  const paused = config?.vault.paused ?? true
  const price = config?.product.priceSol ?? 0.1

  return (
    <div className="relative min-h-[70vh] overflow-hidden">
      <PackOpenVideo active={phase === 'video'} onFinished={onVideoFinished} />
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(16,185,129,0.18), transparent 55%), radial-gradient(ellipse 60% 40% at 90% 20%, rgba(251,191,36,0.08), transparent 50%), linear-gradient(180deg, #0a0f0c 0%, #0d1512 40%, #0a0f0c 100%)',
        }}
      />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <p className="font-[family-name:var(--font-geist-sans)] text-xs uppercase tracking-[0.28em] text-emerald-400/80">
          Owltopia utility
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight text-emerald-50 sm:text-5xl">
          Owl Packs
        </h1>
        <p className="mt-3 max-w-xl text-base text-emerald-100/70">
          Rip a pack for {price} SOL. Every pack wins — $OWL, SOL, or an NFT from the vault.
        </p>

        <div className="mt-8 flex flex-col items-stretch gap-6 sm:flex-row sm:items-start">
          <div className="relative flex-1 overflow-hidden rounded-2xl border border-emerald-500/20 bg-emerald-950/40 p-6 shadow-[0_0_60px_-20px_rgba(16,185,129,0.45)]">
            <div
              className={`mx-auto flex h-40 w-40 items-center justify-center rounded-xl border border-amber-500/30 bg-gradient-to-br from-emerald-900/80 to-stone-900 transition-transform duration-700 ${
                phase === 'paying' || phase === 'video' ? 'animate-pulse scale-105' : ''
              } ${phase === 'reveal' ? 'scale-100' : ''}`}
            >
              {phase === 'reveal' && result ? (
                <Sparkles className="h-16 w-16 text-amber-300 animate-in fade-in zoom-in duration-500" />
              ) : (
                <Package
                  className={`h-16 w-16 text-emerald-300/90 ${ripping ? 'animate-bounce' : ''}`}
                />
              )}
            </div>

            {phase === 'reveal' && result ? (
              <div className="mt-6 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
                <p className="text-lg font-medium text-amber-200">{result.revealMessage}</p>
                <p className="mt-1 text-sm text-emerald-100/70">{result.prizeLabel}</p>
                {result.category === 'owl' && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-300">
                    <Ticket className="h-4 w-4" />
                    {result.freeTicketCredits} free raffle tickets credited
                  </p>
                )}
                <Link
                  href={`/packs/verify/${result.openId}`}
                  className="mt-3 inline-block text-xs text-emerald-400/80 underline-offset-2 hover:underline"
                >
                  Verify this open
                </Link>
              </div>
            ) : null}

            <div className="mt-6 flex flex-col items-center gap-3">
              {!connected ? (
                <WalletConnectButton />
              ) : (
                <Button
                  size="lg"
                  disabled={ripping || paused || !config?.vault.address}
                  onClick={() => void onRip()}
                  className="min-w-[200px] bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                >
                  {ripping ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {phase === 'paying'
                        ? 'Confirm payment…'
                        : phase === 'video'
                          ? 'Opening pack…'
                          : 'Ripping…'}
                    </>
                  ) : (
                    <>Rip pack · {price} SOL</>
                  )}
                </Button>
              )}
              {paused && (
                <p className="text-center text-sm text-amber-200/90">
                  Packs paused{config?.vault.pauseReason ? `: ${config.vault.pauseReason}` : ''}
                </p>
              )}
              {error && <p className="text-center text-sm text-red-300">{error}</p>}
              {loadError && <p className="text-center text-sm text-red-300">{loadError}</p>}
            </div>
          </div>

          <aside className="w-full space-y-4 sm:w-64">
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <h2 className="text-sm font-medium text-emerald-100">Your free tickets</h2>
              <p className="mt-1 text-2xl font-semibold text-amber-200">
                {credits == null ? '—' : credits}
              </p>
              <p className="mt-1 text-xs text-emerald-100/50">
                OWL wins credit free raffle tickets (sign in to redeem on an active raffle).
              </p>
              {connected && credits != null && credits > 0 && (
                <RedeemCreditsForm
                  onDone={() => {
                    void loadCredits()
                  }}
                />
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-emerald-100/80">
              <p className="font-medium text-emerald-100">Odds</p>
              <ul className="mt-2 space-y-1 text-xs">
                <li>60% $OWL (5–100)</li>
                <li>20% SOL (0.05–0.5)</li>
                <li>20% NFT (0.05–0.5 SOL value)</li>
              </ul>
              <p className="mt-3 text-xs text-emerald-100/50">
                Target RTP ~{((config?.product.rtpBps ?? 8000) / 100).toFixed(0)}%. Every pack wins;
                expected value is below pack price.
              </p>
              {config && (
                <p className="mt-2 text-xs text-emerald-100/40">
                  NFTs in vault: {config.vault.availableNfts}
                </p>
              )}
            </div>
          </aside>
        </div>

        <section className="mt-12">
          <h2 className="flex items-center gap-2 text-lg font-medium text-emerald-50">
            <Gift className="h-5 w-5 text-emerald-400" />
            Recent opens
          </h2>
          <ul className="mt-4 divide-y divide-white/5 rounded-xl border border-white/10 bg-black/20">
            {(config?.recentOpens ?? []).length === 0 && (
              <li className="px-4 py-6 text-sm text-emerald-100/50">No opens yet.</li>
            )}
            {(config?.recentOpens ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <span className="text-emerald-100/60">{shortWallet(o.wallet)}</span>
                  <span className="mx-2 text-emerald-100/30">·</span>
                  <span className="text-emerald-100">{o.prizeLabel}</span>
                </div>
                <Link
                  href={`/packs/verify/${o.id}`}
                  className="shrink-0 text-xs text-emerald-400/70 hover:text-emerald-300"
                >
                  Verify
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 rounded-xl border border-white/10 bg-black/20 p-5 text-xs text-emerald-100/60">
          <h3 className="text-sm font-medium text-emerald-100/90">Prize tiers</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-emerald-300/80">$OWL</p>
              <ul className="mt-1 space-y-0.5">
                {(config?.odds.owlTiers ?? []).map((t) => (
                  <li key={t.amount}>
                    {t.amount} OWL (w{t.weight})
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-emerald-300/80">SOL</p>
              <ul className="mt-1 space-y-0.5">
                {(config?.odds.solTiers ?? []).map((t) => (
                  <li key={t.amountSol}>
                    {t.amountSol} SOL (w{t.weight})
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-emerald-300/80">NFT bands</p>
              <ul className="mt-1 space-y-0.5">
                {(config?.odds.nftBands ?? []).map((b) => (
                  <li key={`${b.min}-${b.max}`}>
                    {b.min}–{b.max} SOL (w{b.weight})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
