import { NextRequest, NextResponse, after } from 'next/server'
import { editOriginalInteractionResponse } from '@/lib/discord-interaction-edit-original'
import { handleDiscordApplicationCommand } from '@/lib/discord-handle-interaction'
import {
  normalizeDiscordApplicationPublicKeyHex,
  verifyDiscordInteractionRequest,
} from '@/lib/discord-interactions-verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Allow deferred handler + Discord PATCH to finish on serverless (requires Vercel plan that supports it). */
export const maxDuration = 60

/** @see https://discord.com/developers/docs/interactions/receiving-and-responding */
const DISCORD_INTERACTION_PING = 1
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2
/** DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE — Discord allows ~3s; we finish via PATCH @original */
const DISCORD_INTERACTION_DEFERRED_CHANNEL_MESSAGE = 5

/** Discord Application “Public Key” (General Information) is 32 bytes → 64 hex chars. */
const DISCORD_APP_PUBLIC_KEY_HEX_LENGTH = 64

/**
 * POST /api/discord/interactions
 * Discord Interactions Endpoint URL (Developer Portal). Verifies Ed25519 signature on raw body.
 */
export async function POST(request: NextRequest) {
  const pk = normalizeDiscordApplicationPublicKeyHex(process.env.DISCORD_PUBLIC_KEY ?? '')
  if (!pk) {
    return NextResponse.json({ error: 'Discord interactions not configured' }, { status: 503 })
  }
  if (!/^[0-9a-fA-F]+$/.test(pk) || pk.length !== DISCORD_APP_PUBLIC_KEY_HEX_LENGTH) {
    console.error(
      '[discord/interactions] DISCORD_PUBLIC_KEY must be 64 hex characters from Developer Portal → General Information → Public Key (not Client Secret).'
    )
    return NextResponse.json({ error: 'Discord interactions not configured' }, { status: 503 })
  }

  const signature = request.headers.get('x-signature-ed25519')
  const timestamp = request.headers.get('x-signature-timestamp')
  const rawBody = await request.text()

  if (
    !verifyDiscordInteractionRequest({
      rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
      applicationPublicKeyHex: pk,
    })
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { type?: number; [key: string]: unknown }
  try {
    body = JSON.parse(rawBody) as { type?: number }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const t = body.type
  if (t === DISCORD_INTERACTION_PING) {
    return NextResponse.json({ type: DISCORD_INTERACTION_PING })
  }

  if (t === DISCORD_INTERACTION_APPLICATION_COMMAND) {
    const interaction = body as {
      application_id?: string
      token?: string
    }
    const applicationId = interaction.application_id
    const interactionToken = interaction.token
    if (!applicationId || !interactionToken) {
      return NextResponse.json({
        type: 4,
        data: { content: 'Invalid interaction payload.', flags: 64 },
      })
    }

    after(async () => {
      try {
        const response = await handleDiscordApplicationCommand(body as never)
        await editOriginalInteractionResponse(applicationId, interactionToken, response)
      } catch (e) {
        console.error('[discord/interactions] deferred handler:', e)
        try {
          await editOriginalInteractionResponse(applicationId, interactionToken, {
            type: 4,
            data: {
              content: 'Something went wrong. Try again in a moment.',
              flags: 64,
            },
          })
        } catch (editErr) {
          console.error('[discord/interactions] deferred error reply failed:', editErr)
        }
      }
    })

    return NextResponse.json({
      type: DISCORD_INTERACTION_DEFERRED_CHANNEL_MESSAGE,
      data: { flags: 64 },
    })
  }

  return NextResponse.json({
    type: 4,
    data: { content: 'Unsupported interaction type.', flags: 64 },
  })
}
