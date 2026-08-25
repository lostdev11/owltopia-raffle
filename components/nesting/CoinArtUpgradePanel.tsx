'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { Loader2, Sparkles, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HubCardCoverImage } from '@/components/owl-center/HubCardCoverImage'
import { NestingClaimSuccessDialog } from '@/components/nesting/NestingClaimSuccessDialog'
import { cn } from '@/lib/utils'
import { sendCoinArtUpgradeFeeTransaction } from '@/lib/coin-upgrade/client/upgrade-fee-tx'
import { formatCoinArtUpgradePlatformFeeBatchLabel } from '@/lib/coin-upgrade/config'

type PanelConfig = {
  enabled: boolean
  catalog_ready: boolean
  preview: boolean
  sellable: boolean
  fee_sol: number
  fee_lamports: number
  fee_split: {
    wallet_a: string
    wallet_b: string
    percent_a: number
    percent_b: number
  } | null
  platform_fee_usd: number
  platform_fee_label: string
  platform_fee_lamports: number | null
  platform_fee_treasury: string | null
  reward_multiplier: number
  max_per_request: number
}

type PanelCoin = {
  mint: string
  name: string | null
  image: string | null
  new_image: string | null
  nested: boolean
  upgrade_status: 'none' | 'processing' | 'upgraded' | 'art_unavailable'
}

type PendingUpgradePayment = {
  signature: string
  asset_ids: string[]
}

type UpgradeResultDialog = {
  title?: string
  message: string
  hint?: string
  tone: 'success' | 'info'
}

/** Survives a lost POST response (mobile blip) so a paid fee is always re-linked, never re-paid. */
const PENDING_STORAGE_KEY = 'owl_coin_art_upgrade_pending_v1'

function readPendingPayment(): PendingUpgradePayment | null {
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingUpgradePayment
    if (typeof parsed?.signature === 'string' && Array.isArray(parsed?.asset_ids)) return parsed
  } catch {
    // ignore
  }
  return null
}

function writePendingPayment(value: PendingUpgradePayment | null) {
  try {
    if (value) window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(value))
    else window.localStorage.removeItem(PENDING_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function formatSol(sol: number): string {
  return sol >= 0.01 ? sol.toFixed(2).replace(/\.?0+$/, '') : sol.toFixed(4)
}

/** Client fallback when the wallet is connected but not SIWS-signed yet. */
const COMING_SOON_FALLBACK_CONFIG: PanelConfig = {
  enabled: false,
  catalog_ready: false,
  preview: true,
  sellable: false,
  fee_sol: 0.1,
  fee_lamports: 100_000_000,
  fee_split: null,
  platform_fee_usd: 0.5,
  platform_fee_label: '50¢ platform fee per coin',
  platform_fee_lamports: null,
  platform_fee_treasury: null,
  reward_multiplier: 2,
  max_per_request: 10,
}

const PREVIEW_PLACEHOLDER_COUNT = 8

function platformFeeBatchLabel(usd: number, units: number): string | null {
  if (usd <= 0 || units <= 0) return null
  return formatCoinArtUpgradePlatformFeeBatchLabel(units, usd)
}

/**
 * Optional Owltopia Coin art upgrade (community vote): pay the per-coin fee,
 * the server repoints the Core URI to the new art in place — nested coins
 * included, no unlock needed — and the coin earns boosted OWL while nested.
 *
 * Before go-live (`!sellable`): always shows a Coming soon section (with empty
 * placeholder tiles until the catalog is seeded). Live mode requires sellable
 * config + wallet coins.
 */
export function CoinArtUpgradePanel() {
  const { connection } = useConnection()
  const { publicKey, sendTransaction, connected } = useWallet()

  const [config, setConfig] = useState<PanelConfig | null>(null)
  const [coins, setCoins] = useState<PanelCoin[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error'; text: string } | null>(null)
  const [resultDialog, setResultDialog] = useState<UpgradeResultDialog | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/coin-upgrade', { credentials: 'include', cache: 'no-store' })
      if (res.status === 401) {
        // Connected but not signed in — still show Coming soon so holders see the section.
        setConfig(COMING_SOON_FALLBACK_CONFIG)
        setCoins([])
        setHidden(false)
        return null
      }
      const json = (await res.json().catch(() => null)) as
        | { config?: PanelConfig; coins?: PanelCoin[]; error?: string }
        | null
      if (!res.ok || !json?.config) {
        setConfig(COMING_SOON_FALLBACK_CONFIG)
        setCoins([])
        setHidden(false)
        return null
      }
      setConfig(json.config)
      setCoins(json.coins ?? [])
      setHidden(false)
      return json
    } catch {
      setConfig(COMING_SOON_FALLBACK_CONFIG)
      setCoins([])
      setHidden(false)
      return null
    } finally {
      setLoaded(true)
    }
  }, [])

  const submitUpgrade = useCallback(
    async (assetIds: string[], paymentSignature: string | null) => {
      const res = await fetch('/api/me/coin-upgrade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_ids: assetIds,
          ...(paymentSignature ? { payment_signature: paymentSignature } : {}),
        }),
      })
      const json = (await res.json().catch(() => null)) as
        | {
            upgraded?: Array<{ asset_id: string }>
            pending?: Array<{ asset_id: string; error: string }>
            error?: string
          }
        | null
      if (!res.ok) {
        throw new Error(json?.error || 'Coin art upgrade failed.')
      }
      return { upgraded: json?.upgraded ?? [], pending: json?.pending ?? [] }
    },
    []
  )

  useEffect(() => {
    if (!connected) {
      setConfig(COMING_SOON_FALLBACK_CONFIG)
      setCoins([])
      setHidden(false)
      setLoaded(true)
      return
    }
    void load().then((json) => {
      if (!json?.config?.sellable) return
      // Recover a paid fee whose POST response was lost: any stored coin still
      // showing as un-upgraded means the payment was never linked server-side.
      const pending = readPendingPayment()
      if (!pending) return
      const byMint = new Map((json.coins ?? []).map((c) => [c.mint, c]))
      const stillUnlinked = pending.asset_ids.filter((id) => byMint.get(id)?.upgrade_status === 'none')
      if (stillUnlinked.length === 0) {
        const allDone = pending.asset_ids.every((id) => byMint.get(id)?.upgrade_status === 'upgraded')
        if (allDone) writePendingPayment(null)
        return
      }
      void submitUpgrade(pending.asset_ids, pending.signature)
        .then(() => {
          writePendingPayment(null)
          setResultDialog({
            title: 'Upgrade successful',
            message: 'Recovered your earlier upgrade payment — your coin art is updated.',
            hint: 'Wallets and marketplaces may take a few minutes to show the new art.',
            tone: 'success',
          })
          void load()
        })
        .catch(() => {
          // Leave the stored payment for the next visit / support.
        })
    })
  }, [connected, load, submitUpgrade])

  const upgradable = useMemo(() => coins.filter((c) => c.upgrade_status === 'none'), [coins])
  const processing = useMemo(() => coins.filter((c) => c.upgrade_status === 'processing'), [coins])
  const upgradedCount = useMemo(
    () => coins.filter((c) => c.upgrade_status === 'upgraded').length,
    [coins]
  )

  const toggleSelect = useCallback(
    (mint: string) => {
      if (!config?.sellable) return
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(mint)) next.delete(mint)
        else if (next.size < config.max_per_request) next.add(mint)
        return next
      })
    },
    [config]
  )

  const handleUpgradeSelected = useCallback(async () => {
    if (!config?.sellable || !publicKey || selected.size === 0 || busy) return
    if (!config.fee_split) {
      setNotice({ tone: 'error', text: 'Upgrade fee split is not configured yet. Try again later.' })
      return
    }
    if (config.platform_fee_usd > 0) {
      if (!config.platform_fee_treasury || !config.platform_fee_lamports || config.platform_fee_lamports <= 0) {
        setNotice({
          tone: 'error',
          text: 'Platform fee quote unavailable — refresh and try again in a moment.',
        })
        return
      }
    }
    const assetIds = [...selected]
    setBusy(true)
    setNotice(null)
    try {
      const signature = await sendCoinArtUpgradeFeeTransaction({
        connection,
        sendTransaction: sendTransaction as Parameters<typeof sendCoinArtUpgradeFeeTransaction>[0]['sendTransaction'],
        publicKey,
        units: assetIds.length,
        feeConfig: {
          wallet_a: config.fee_split.wallet_a,
          wallet_b: config.fee_split.wallet_b,
          percent_a: config.fee_split.percent_a,
          percent_b: config.fee_split.percent_b,
          unit_lamports: config.fee_lamports,
          platform_fee_unit_lamports: config.platform_fee_lamports ?? undefined,
          platform_fee_treasury: config.platform_fee_treasury,
        },
      })
      // Persist before the POST so a lost response never loses the paid fee.
      writePendingPayment({ signature, asset_ids: assetIds })

      const result = await submitUpgrade(assetIds, signature)
      writePendingPayment(null)
      setSelected(new Set())
      if (result.pending.length === 0) {
        setResultDialog({
          title: 'Upgrade successful',
          message: `Upgraded ${result.upgraded.length} coin${result.upgraded.length === 1 ? '' : 's'}! Your new art is on-chain.`,
          hint:
            config.reward_multiplier > 1
              ? `Enjoy ${config.reward_multiplier}× OWL while nested. Wallets and marketplaces refresh within a few minutes.`
              : 'Wallets and marketplaces refresh within a few minutes.',
          tone: 'success',
        })
      } else {
        setResultDialog({
          title: 'Upgrade in progress',
          message: `Payment received. ${result.upgraded.length} coin${result.upgraded.length === 1 ? '' : 's'} updated now; ${result.pending.length} will finish automatically in the next few minutes.`,
          hint: 'No further action needed — you can close this page.',
          tone: 'info',
        })
      }
      await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Coin art upgrade failed.'
      const stored = readPendingPayment()
      setNotice({
        tone: 'error',
        text: stored
          ? `${message} Your fee payment is saved — reopen this page and it will retry automatically without charging again.`
          : message,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, config, connection, load, publicKey, selected, sendTransaction, submitUpgrade])

  const handleRetryProcessing = useCallback(async () => {
    if (busy || processing.length === 0 || !config?.sellable) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await submitUpgrade(
        processing.slice(0, config.max_per_request).map((c) => c.mint),
        null
      )
      if (result.pending.length === 0) {
        setResultDialog({
          title: 'Upgrade successful',
          message: 'All pending art updates completed.',
          hint: 'Your coins now show the upgraded art on-chain.',
          tone: 'success',
        })
      } else {
        setResultDialog({
          title: 'Upgrade in progress',
          message: 'Still finishing some updates — they retry automatically.',
          hint: 'Check back in a few minutes.',
          tone: 'info',
        })
      }
      await load()
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Retry failed.' })
    } finally {
      setBusy(false)
    }
  }, [busy, config, load, processing, submitUpgrade])

  if (hidden || !loaded || !config) return null

  const sellable = config.sellable === true
  // Live mode still needs a connected wallet with coins; Coming soon always shows.
  if (sellable && (!connected || coins.length === 0)) return null

  const totalSol = formatSol(config.fee_sol * selected.size)
  const platformFeePerCoinLabel =
    config.platform_fee_usd > 0
      ? config.platform_fee_label || '50¢ platform fee per coin'
      : null
  const platformFeeSelectedLabel = platformFeeBatchLabel(config.platform_fee_usd, selected.size)
  const comingSoonStatus = !config.catalog_ready
    ? 'New art is being prepared — upgrades open once the catalog is live.'
    : 'Upgrades open soon — new art stays hidden until you upgrade.'

  return (
    <section
      id="coin-art-upgrade"
      className="rounded-2xl border border-border/60 bg-card/80 p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="h-6 w-6 text-theme-prime shrink-0 mt-0.5" aria-hidden />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Coin art upgrade</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Optional forever-upgrade for your Owltopia coins:{' '}
            <span className="font-medium text-foreground">{formatSol(config.fee_sol)} SOL</span> per coin
            {platformFeePerCoinLabel ? (
              <>
                {' '}
                plus <span className="font-medium text-foreground">{platformFeePerCoinLabel}</span>
              </>
            ) : null}{' '}
            for the new art
            {config.reward_multiplier > 1 ? (
              <>
                {' '}
                and <span className="font-medium text-foreground">{config.reward_multiplier}× OWL</span>{' '}
                while nested
              </>
            ) : null}
            . Nested coins upgrade in place — no unlock needed. Prefer the original art? Just keep it.
          </p>
        </div>
      </div>

      {!sellable ? (
        <div className="space-y-3">
          <p className="text-xs rounded-lg border border-border/60 px-3 py-2 leading-relaxed text-muted-foreground">
            Coming soon — {comingSoonStatus}
          </p>
          <ul className="grid grid-cols-4 sm:grid-cols-8 gap-2" aria-label="New coin art coming soon">
            {Array.from({ length: PREVIEW_PLACEHOLDER_COUNT }, (_, idx) => (
              <li
                key={`placeholder-${idx}`}
                className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/40"
              >
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Soon</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? (
        <p className="text-xs rounded-lg border border-destructive/50 text-destructive px-3 py-2 leading-relaxed">
          {notice.text}
        </p>
      ) : null}

      {sellable && processing.length > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {processing.length} paid upgrade{processing.length === 1 ? '' : 's'} finishing on-chain —
            completes automatically.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-[36px] touch-manipulation shrink-0"
            disabled={busy}
            onClick={() => void handleRetryProcessing()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />}
            Retry now
          </Button>
        </div>
      ) : null}

      {sellable ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {coins.map((coin) => {
            const isSelected = selected.has(coin.mint)
            const selectable = coin.upgrade_status === 'none' && !busy
            const displayImage =
              coin.upgrade_status === 'upgraded' ? coin.new_image ?? coin.image : coin.image
            return (
              <li key={coin.mint}>
                <button
                  type="button"
                  disabled={!selectable}
                  onClick={() => toggleSelect(coin.mint)}
                  aria-pressed={isSelected}
                  className={cn(
                    'w-full text-left rounded-xl border p-2 space-y-2 touch-manipulation transition-colors',
                    isSelected
                      ? 'border-theme-prime ring-1 ring-theme-prime'
                      : 'border-border/60 hover:border-border',
                    !selectable && 'opacity-90 cursor-default'
                  )}
                >
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                    {displayImage ? (
                      <HubCardCoverImage imageUrl={displayImage} alt={coin.name ?? coin.mint} fit="cover" />
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium truncate">{coin.name ?? coin.mint}</p>
                    <div className="flex flex-wrap gap-1">
                      {coin.nested ? (
                        <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Nested
                        </span>
                      ) : null}
                      {coin.upgrade_status === 'upgraded' ? (
                        <span className="rounded-full border border-emerald-500/50 px-1.5 py-0.5 text-[10px] text-emerald-500">
                          Upgraded · {config.reward_multiplier}×
                        </span>
                      ) : coin.upgrade_status === 'processing' ? (
                        <span className="rounded-full border border-amber-500/50 px-1.5 py-0.5 text-[10px] text-amber-500">
                          Finishing…
                        </span>
                      ) : coin.upgrade_status === 'art_unavailable' ? (
                        <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Art coming soon
                        </span>
                      ) : (
                        <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Original
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {sellable && upgradable.length > 0 ? (
        <div className="space-y-2">
          <Button
            type="button"
            className="min-h-[52px] h-auto w-full touch-manipulation whitespace-normal px-3 py-3 text-base leading-snug text-center"
            disabled={busy || selected.size === 0}
            onClick={() => void handleUpgradeSelected()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" aria-hidden /> : null}
            {selected.size === 0
              ? 'Select coins to upgrade'
              : `Upgrade ${selected.size} coin${selected.size === 1 ? '' : 's'} · ${totalSol} SOL${platformFeeSelectedLabel ? ` + ${platformFeeSelectedLabel}` : ''}`}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            {formatSol(config.fee_sol)} SOL
            {platformFeePerCoinLabel ? ` + ${platformFeePerCoinLabel}` : ''} each. One wallet approval for
            the fee{platformFeePerCoinLabel ? ' and platform fees' : ''} — the art update is signed by
            Owltopia, so nested coins never unlock. New art is revealed only after upgrade. Up to{' '}
            {config.max_per_request} coins per batch.
          </p>
        </div>
      ) : sellable && upgradedCount === coins.length && coins.length > 0 ? (
        <p className="text-xs text-muted-foreground text-center">
          All your coins are upgraded. Enjoy the {config.reward_multiplier}× nested rewards!
        </p>
      ) : null}

      <NestingClaimSuccessDialog
        open={resultDialog !== null}
        onOpenChange={(open) => {
          if (!open) setResultDialog(null)
        }}
        title={resultDialog?.title}
        message={resultDialog?.message ?? ''}
        hint={resultDialog?.hint}
        tone={resultDialog?.tone ?? 'success'}
        actionLabel="Done"
      />
    </section>
  )
}
