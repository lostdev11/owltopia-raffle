import type { Client, TextChannel } from 'discord.js'

const MAX_CONTENT_LENGTH = 2000

type BroadcastAllowedMentions = { parse: [] } | { parse: ['everyone'] }

export type GatewayBroadcastResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }

function truncateContent(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= MAX_CONTENT_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_CONTENT_LENGTH - 3)}...`
}

/** Post a full message instantly over the Gateway (no per-character typing). */
export async function postBroadcastViaGateway(
  client: Client,
  channelId: string,
  content: string,
  allowedMentions?: BroadcastAllowedMentions
): Promise<GatewayBroadcastResult> {
  const cid = channelId.trim()
  if (!cid) return { ok: false, message: 'Invalid channel id.' }

  const body = truncateContent(content)
  if (!body) return { ok: false, message: 'Message body is empty.' }

  try {
    const channel = await client.channels.fetch(cid)
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      return { ok: false, message: 'Channel not found or not a guild text channel.' }
    }

    const msg = await (channel as TextChannel).send({
      content: body,
      allowedMentions: allowedMentions ?? { parse: [] },
    })
    return { ok: true, messageId: msg.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway send failed.'
    console.error('[discord-reply-bot] broadcast failed:', err)
    return { ok: false, message }
  }
}
