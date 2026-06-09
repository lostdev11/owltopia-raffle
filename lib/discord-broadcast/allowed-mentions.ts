export type DiscordBroadcastAllowedMentions =
  | { parse: [] }
  | { parse: ['everyone'] }

const EVERYONE_LINE_RE = /^@everyone\s*$/im

export function stripEveryoneLineFromBody(body: string): string {
  return body
    .split('\n')
    .filter((line) => !EVERYONE_LINE_RE.test(line.trim()))
    .join('\n')
    .trim()
}

/** Build Discord content + allowed_mentions from admin opt-in (not from free text in the body). */
export function buildDiscordBroadcastContent(
  body: string,
  mentionEveryone: boolean
): { content: string; allowedMentions: DiscordBroadcastAllowedMentions } {
  const trimmed = stripEveryoneLineFromBody(body)
  if (!mentionEveryone) {
    return { content: trimmed, allowedMentions: { parse: [] } }
  }
  const content = trimmed ? `@everyone\n${trimmed}` : '@everyone'
  return { content, allowedMentions: { parse: ['everyone'] } }
}
