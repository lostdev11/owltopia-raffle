'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { nestingClaimReadyButtonClass } from '@/lib/nesting/ui-classes'
import { cn } from '@/lib/utils'

function scrollToPerches() {
  const el = document.getElementById('perches')
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (typeof history !== 'undefined' && history.replaceState) {
    history.replaceState(null, '', '#perches')
  }
}

export function NestingHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-muted/50 via-background to-background px-4 py-10 sm:px-10 sm:py-14">
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.22),transparent_65%)]"
        aria-hidden
      />
      <div className="relative max-w-2xl mx-auto text-center space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-theme-prime">Owltopia</p>
        <h1 className="font-display text-3xl sm:text-4xl md:text-5xl tracking-wide text-theme-prime drop-shadow-[0_0_24px_rgba(0,255,136,0.25)]">
          Owl Nesting
        </h1>
        <p className="text-lg text-muted-foreground font-medium">
          Chill, nest, rack up OWL—with one quick wallet hello.
        </p>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
          Pick a perch, settle in for the countdown, then grab OWL and monthly SOL/USDC rev share whenever you want.
          Signing in costs no gas—you just prove it is still you.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button
            type="button"
            variant="default"
            size="lg"
            className={cn(
              nestingClaimReadyButtonClass,
              'min-h-[48px] touch-manipulation text-base font-semibold'
            )}
            onClick={scrollToPerches}
          >
            See perches
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className={cn(
              'min-h-[48px] touch-manipulation text-base font-semibold',
              'border-theme-prime/55 bg-theme-prime/10 text-theme-prime',
              'hover:bg-theme-prime/20 hover:text-theme-prime hover:border-theme-prime/70',
              'shadow-[0_0_18px_rgba(0,255,136,0.12)]'
            )}
          >
            <Link href="/dashboard/nesting">My nest</Link>
          </Button>
        </div>
        <p className="pt-1 text-xs text-muted-foreground leading-relaxed">
          Already nested Gen 1 / Gen 2?{' '}
          <Link
            href="/dashboard/nesting#nesting-claims"
            className="font-medium text-theme-prime underline-offset-4 hover:underline touch-manipulation"
          >
            Claim rev share on My nest
          </Link>
          .
        </p>
      </div>
    </section>
  )
}
