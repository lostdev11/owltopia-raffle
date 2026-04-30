'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import { useCart } from '@/components/cart/CartProvider'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'

function CartLineThumbnail({
  imageUrl,
  imageFallbackUrl,
}: {
  imageUrl: string | null | undefined
  imageFallbackUrl: string | null | undefined
}) {
  const primary = getRaffleDisplayImageUrl(imageUrl)
  const fallback = getRaffleDisplayImageUrl(imageFallbackUrl)
  const [phase, setPhase] = useState<'primary' | 'fallback' | 'dead'>(() =>
    primary ? 'primary' : fallback ? 'fallback' : 'dead'
  )

  useEffect(() => {
    setPhase(primary ? 'primary' : fallback ? 'fallback' : 'dead')
  }, [primary, fallback])

  const src = phase === 'primary' ? primary : phase === 'fallback' ? fallback : null

  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- cart thumbs: proxy/GIF URLs match RaffleCard list pattern
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => {
            setPhase(p => {
              if (p === 'primary' && fallback) return 'fallback'
              return 'dead'
            })
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground" aria-hidden>
          <Ticket className="h-5 w-5" />
        </div>
      )}
    </div>
  )
}

type CartCheckoutPanelProps = {
  /** Called when user follows a raffle title link (unused on full-page cart). */
  onAfterRaffleLinkNavigate?: () => void
}

export function CartCheckoutPanel({ onAfterRaffleLinkNavigate }: CartCheckoutPanelProps) {
  const {
    lines,
    lineCount,
    ticketCount,
    removeLine,
    setLineQuantity,
    clearCart,
    checkout,
    checkoutBusy,
    checkoutError,
  } = useCart()
  const { connected } = useWallet()

  const subtotalPreview = lines.reduce((s, l) => s + l.snapshot.ticket_price * l.quantity, 0)
  const currencyLabel = lines[0]?.snapshot.currency ?? ''

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto min-h-0 space-y-4 py-2 touch-manipulation">
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your cart is empty. Pick live raffles below to build a multi-raffle checkout.
          </p>
        ) : (
          <ul className="space-y-3">
            {lines.map(line => (
              <li
                key={line.raffleId}
                className="rounded-lg border border-border p-3 space-y-3 bg-muted/30"
              >
                <div className="flex justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <CartLineThumbnail
                      imageUrl={line.snapshot.image_url}
                      imageFallbackUrl={line.snapshot.image_fallback_url}
                    />
                    <div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
                      <Link
                        href={`/raffles/${encodeURIComponent(line.snapshot.slug)}`}
                        className="font-medium text-sm hover:underline min-w-0 break-words block"
                        onClick={() => onAfterRaffleLinkNavigate?.()}
                      >
                        {line.snapshot.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {line.quantity === 1 ? '1 ticket' : `${line.quantity} tickets`} for this raffle
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="shrink-0 h-11 min-h-[44px]"
                    onClick={() => removeLine(line.raffleId)}
                    disabled={checkoutBusy}
                  >
                    Remove
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label
                    className="text-xs text-muted-foreground whitespace-nowrap"
                    htmlFor={`cart-q-${line.raffleId}`}
                  >
                    Tickets
                  </label>
                  <Input
                    id={`cart-q-${line.raffleId}`}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={e => setLineQuantity(line.raffleId, Number(e.target.value) || 1)}
                    className="w-24 h-11 text-base touch-manipulation"
                    disabled={checkoutBusy}
                  />
                  <span className="text-sm flex items-center gap-1">
                    {(line.snapshot.ticket_price * line.quantity).toLocaleString(undefined, {
                      maximumFractionDigits: 12,
                    })}{' '}
                    <CurrencyIcon currency={line.snapshot.currency as 'SOL' | 'USDC' | 'OWL'} size={14} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border pt-3 space-y-2 shrink-0">
        {lines.length > 0 ? (
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2 text-muted-foreground">
              <span>
                {lineCount === 1
                  ? `${ticketCount === 1 ? '1 ticket' : `${ticketCount} tickets`} (1 raffle)`
                  : `${ticketCount} tickets across ${lineCount} raffles`}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Snapshot subtotal ({currencyLabel})</span>
              <span className="font-semibold flex items-center gap-1 shrink-0">
                {subtotalPreview.toLocaleString(undefined, { maximumFractionDigits: 12 })}{' '}
                <CurrencyIcon currency={currencyLabel as 'SOL' | 'USDC' | 'OWL'} size={16} />
              </span>
            </div>
            {lineCount >= 2 ? (
              <p className="text-xs text-muted-foreground leading-snug">
                One approval sends a single batch transaction; each raffle still gets its own entry and ticket count.
              </p>
            ) : null}
          </div>
        ) : null}
        {checkoutError ? (
          <p className="text-sm text-destructive" role="alert">
            {checkoutError}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 pt-1">
          <Button
            type="button"
            className="w-full touch-manipulation min-h-[44px] text-base"
            disabled={checkoutBusy || lines.length === 0 || !connected}
            onClick={() => checkout()}
          >
            {checkoutBusy
              ? 'Checking out…'
              : !connected
                ? 'Connect wallet to checkout'
                : lineCount === 1
                  ? `Checkout (${ticketCount === 1 ? '1 ticket' : `${ticketCount} tickets`})`
                  : `Checkout (${lineCount} raffles · ${ticketCount} tickets)`}
          </Button>
          {lines.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="w-full touch-manipulation min-h-[44px]"
              disabled={checkoutBusy}
              onClick={() => clearCart()}
            >
              Clear cart
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
