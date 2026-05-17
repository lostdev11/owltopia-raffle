import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

const SNS_EXPLORE = 'https://www.sns.id/explore'

/**
 * Header for the `.sol` domains raffle hub — layout inspired by SNS explore (grid hub, not a data mirror).
 */
export function SolDomainsHubIntro() {
  return (
    <div className="mb-8 w-full min-w-0">
      <div className="relative overflow-hidden rounded-2xl border border-teal-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950/80 p-5 shadow-lg sm:p-7">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-40 w-40 rounded-full bg-teal-400/15 blur-3xl"
          aria-hidden
        />
        <div className="relative space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/90">Domains</p>
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            <span className="font-mono text-teal-200">.sol</span> raffles
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
            Name prizes raffled on Owltopia — same escrow and tickets as other NFT raffles, listed here only
            (not on Main or Partner). Floor values are set by hosts; compare comps on SNS when you like.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              href={SNS_EXPLORE}
              target="_blank"
              rel="noopener noreferrer"
              className="touch-manipulation inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-500/90 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400"
            >
              Browse SNS
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </Link>
            <Link
              href="/admin/raffles/new/sns"
              className="touch-manipulation inline-flex min-h-[44px] items-center rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10"
            >
              Create SNS raffle
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
