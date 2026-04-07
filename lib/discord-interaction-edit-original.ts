/**
 * Edit the deferred interaction message (PATCH …/messages/@original).
 * @see https://discord.com/developers/docs/interactions/receiving-and-responding#edit-original-interaction-response
 */
const DISCORD_API = 'https://discord.com/api/v10'

export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  interactionResponse: Record<string, unknown>
): Promise<void> {
  const data = interactionResponse.data as Record<string, unknown> | undefined
  const body: Record<string, unknown> = {
    flags: typeof data?.flags === 'number' ? data.flags : 64,
  }
  if (typeof data?.content === 'string') body.content = data.content
  if (Array.isArray(data?.embeds)) body.embeds = data.embeds
  if (Array.isArray(data?.components)) body.components = data.components

  const url = `${DISCORD_API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Discord PATCH @original ${res.status}: ${text.slice(0, 500)}`)
  }
}
