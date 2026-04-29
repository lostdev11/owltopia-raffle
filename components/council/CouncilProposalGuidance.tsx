import Link from 'next/link'
import { COMMUNITY_DISCORD_INVITE_URL } from '@/lib/site-config'
import { MAX_COUNCIL_PROPOSAL_DURATION_DAYS } from '@/lib/council/owl-proposal-rules'

const detailsSummaryClass =
  'min-h-[44px] w-full cursor-pointer touch-manipulation font-medium text-sm text-foreground py-2 px-0.5'

const MARKDOWN_OUTLINE = `## Problem or opportunity

## Proposed approach

## Who does what (rough timeline)

## Risks and mitigations (if any)

## Funding (optional — write "None" if not asking for treasury)

## Who benefits`

/** DAO-style checklist + outline for the create-proposal flow (mobile-friendly \`<details>\`). */
export function CouncilProposalGuidance() {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:p-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Strong proposals are specific and easy to discuss. Use the checklist and outline — they are optional helpers,
        not required fields.
      </p>

      <details className="rounded-md border border-border/50 bg-background/60 px-3">
        <summary className={detailsSummaryClass}>Before you submit</summary>
        <ul className="list-disc space-y-2 pb-4 pl-5 text-sm text-muted-foreground marker:text-theme-prime/80">
          <li>
            Do a quick <span className="text-foreground/90">temperature check</span> in{' '}
            <Link
              href={COMMUNITY_DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-prime underline underline-offset-2 touch-manipulation"
            >
              Discord
            </Link>{' '}
            so the idea is not landing cold.
          </li>
          <li>
            State <span className="text-foreground/90">what would change</span>, for whom, and on what rough timeline.
            Avoid vague slogans.
          </li>
          <li>
            <span className="text-foreground/90">Funding is optional</span> — signaling-only proposals (policy,
            process, priorities) are welcome. If you are not asking for treasury, say so explicitly.
          </li>
          <li>
            Your voting window must be at most <span className="text-foreground/90">{MAX_COUNCIL_PROPOSAL_DURATION_DAYS} days</span>{' '}
            after start; moderators still review drafts before anything goes live on Council.
          </li>
          <li>
            If a submission is not activated, treat feedback as a chance to refine and try again — governance is
            iterative.
          </li>
        </ul>
      </details>

      <details className="rounded-md border border-border/50 bg-background/60 px-3">
        <summary className={detailsSummaryClass}>Suggested description outline (markdown)</summary>
        <div className="space-y-2 pb-4">
          <p className="text-xs text-muted-foreground">
            Paste into the description field and replace each section with your own text.
          </p>
          <pre className="max-h-[220px] overflow-auto rounded-md border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap font-mono">
            {MARKDOWN_OUTLINE}
          </pre>
        </div>
      </details>
    </div>
  )
}
