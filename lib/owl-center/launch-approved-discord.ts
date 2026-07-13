/**
 * Discord announcement when an Owl Center collection is approved and goes live.
 * Uses DISCORD_WEBHOOK_OWL_CENTER_LAUNCH, else DISCORD_WEBHOOK_URL. No-op when unset.
 */
import {
  postDiscordIncomingWebhookEmbed,
  type DiscordIncomingEmbed,
} from '@/lib/discord-incoming-webhook'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { getSiteBaseUrl } from '@/lib/site-config'

const EMBED_GREEN = 0x00ff9c

function webhookUrl(): string | undefined {
  return (
    process.env.DISCORD_WEBHOOK_OWL_CENTER_LAUNCH?.trim() ||
    process.env.DISCORD_WEBHOOK_URL?.trim() ||
    undefined
  )
}

/** Fire-and-forget — never throws; go-live must not fail on a Discord hiccup. */
export async function postLaunchApprovedDiscord(
  launch: Pick<
    OwlCenterLaunchPublic,
    'name' | 'symbol' | 'slug' | 'total_supply' | 'creator_wallet' | 'image_url'
  >
): Promise<void> {
  const url = webhookUrl()
  if (!url) return

  try {
    const mintUrl = `${getSiteBaseUrl()}/owl-center/collection/${encodeURIComponent(launch.slug)}`
    const creator = (launch.creator_wallet ?? '').trim()

    const embed: DiscordIncomingEmbed = {
      title: `🦉 New collection approved on Owl Center: ${launch.name}`,
      url: mintUrl,
      description: 'The mint page is live — good luck to the team!',
      color: EMBED_GREEN,
      fields: [
        { name: 'Supply', value: String(launch.total_supply ?? '—'), inline: true },
        ...(launch.symbol ? [{ name: 'Symbol', value: launch.symbol, inline: true }] : []),
        ...(creator
          ? [{ name: 'Creator', value: `${creator.slice(0, 6)}…${creator.slice(-4)}`, inline: true }]
          : []),
        { name: 'Mint page', value: mintUrl, inline: false },
      ],
      ...(launch.image_url ? { thumbnail: { url: launch.image_url } } : {}),
      timestamp: new Date().toISOString(),
    }

    await postDiscordIncomingWebhookEmbed(url, embed)
  } catch (e) {
    console.error('owl-center launch approved discord post failed:', e)
  }
}
