/**
 * Sends the Owl Council Discord webhook for the most recently updated proposal
 * (same payload as when an admin publishes a proposal).
 *
 * Run from repo root:
 *   npx tsx scripts/notify-recent-council-proposal-discord.ts
 *
 * Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (or service role),
 *   DISCORD_WEBHOOK_OWL_COUNCIL_PROPOSAL_LIVE.
 */
import { loadEnvConfig } from '@next/env'
import { notifyOwlCouncilProposalLive } from '@/lib/discord-owl-council-webhooks'
import { listAllOwlProposalsForAdmin } from '@/lib/db/owl-council'

async function main() {
  loadEnvConfig(process.cwd())

  const hook = process.env.DISCORD_WEBHOOK_OWL_COUNCIL_PROPOSAL_LIVE?.trim()
  if (!hook) {
    console.error('DISCORD_WEBHOOK_OWL_COUNCIL_PROPOSAL_LIVE is not set in .env.local')
    process.exit(1)
  }

  const rows = await listAllOwlProposalsForAdmin()
  const latest = rows[0]
  if (!latest) {
    console.error('No Owl Council proposals found in the database.')
    process.exit(1)
  }

  console.log(`Sending Discord notification for proposal: "${latest.title}" (${latest.slug}) status=${latest.status}`)
  await notifyOwlCouncilProposalLive(latest)
  console.log('Done. Check your Discord channel for the webhook message.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
