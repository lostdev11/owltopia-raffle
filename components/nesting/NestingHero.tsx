import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { nestingMutedActionButtonClass } from '@/lib/nesting/ui-classes'
import { cn } from '@/lib/utils'

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
        <p className="text-lg text-muted-foreground">Earn while you hold.</p>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
          DB-backed staking for the Owltopia MVP — lock period, snapshots, and reward estimates. Full on-chain custody
          comes later; nothing here calls the Solana RPC.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button asChild variant="outline" size="lg" className={cn(nestingMutedActionButtonClass, 'text-base')}>
            <Link href="#pools">View pools</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className={cn(nestingMutedActionButtonClass, 'text-base')}>
            <Link href="/dashboard/nesting">Your nest</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
