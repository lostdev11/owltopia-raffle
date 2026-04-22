import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Vote } from 'lucide-react'
import { OWL_TICKER } from '@/lib/council/owl-ticker'

export function CouncilHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-green-500/25 bg-gradient-to-br from-emerald-950/40 via-background to-background px-4 py-10 sm:px-8 sm:py-14 mb-10 sm:mb-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        aria-hidden
        style={{
          backgroundImage: `radial-gradient(circle at 30% 20%, rgba(0,255,136,0.4) 0%, transparent 45%),
            radial-gradient(circle at 80% 70%, rgba(0,212,255,0.25) 0%, transparent 40%)`,
        }}
      />
      <div className="relative z-10 max-w-2xl mx-auto text-center space-y-4">
        <p className="text-xs uppercase tracking-[0.2em] text-theme-prime/90 font-medium">Governance</p>
        <h1 className="font-display text-3xl sm:text-4xl md:text-5xl tracking-wide text-foreground">
          Owl Council
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
          Propose and discuss what comes next for Owltopia. Eligible holders can submit ideas; the team reviews and
          publishes them here. When a vote is open, your choice is counted in proportion to the {OWL_TICKER} in your wallet.
        </p>
        <div className="pt-2 flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center items-stretch sm:items-center">
          <Button
            asChild
            size="lg"
            className="min-h-[48px] touch-manipulation shadow-[0_0_20px_rgba(0,255,136,0.15)]"
          >
            <Link href="#active-proposals" className="inline-flex items-center justify-center gap-2">
              <Vote className="h-4 w-4 shrink-0" aria-hidden />
              View active proposals
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
