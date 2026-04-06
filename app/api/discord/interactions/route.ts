import { NextRequest, NextResponse } from 'next/server'
import { handleDiscordApplicationCommand } from '@/lib/discord-handle-interaction'
import { verifyDiscordInteractionRequest } from '@/lib/discord-interactions-verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** @see https://discord.com/developers/docs/interactions/receiving-and-responding */
const DISCORD_INTERACTION_PING = 1
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2

/**
 * POST /api/discord/interactions
 * Discord Interactions Endpoint URL (Developer Portal). Verifies Ed25519 signature on raw body.
 */
export async function POST(request: NextRequest) {
  const pk = process.env.DISCORD_PUBLIC_KEY?.trim()
  if (!pk) {
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
    const response = await handleDiscordApplicationCommand(body as never)
    return NextResponse.json(response)
  }

  return NextResponse.json({
    type: 4,
    data: { content: 'Unsupported interaction type.', flags: 64 },
  })
}
