/** Official Owltopia X account used in #x-post Discord mirrors. */
export const OWLTOPIA_X_HANDLE = 'Owltopia_sol'

export const MAX_X_POST_TWEET_MIRRORS = 5

const X_STATUS_PATH_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|fixupx\.com|fxtwitter\.com|vxtwitter\.com)\/([^/?#\s]+)\/status\/(\d+)/i

export type ParsedXTweetStatus = {
  handle: string
  statusId: string
}

export function parseXTweetStatusUrl(input: string): ParsedXTweetStatus | null {
  const raw = input.trim()
  if (!raw) return null
  const match = raw.match(X_STATUS_PATH_RE)
  if (!match) return null
  const handle = match[1]?.replace(/^@/, '').trim()
  const statusId = match[2]?.trim()
  if (!handle || !statusId || !/^\d+$/.test(statusId)) return null
  return { handle, statusId }
}

/** fixupx.com embeds X posts reliably in Discord (same pattern as manual #x-post posts). */
export function buildFixupxTweetUrl(handle: string, statusId: string): string {
  const h = handle.replace(/^@/, '').trim()
  return `https://fixupx.com/${encodeURIComponent(h)}/status/${statusId}`
}

export function normalizeTweetUrlToFixupx(input: string): string | null {
  const parsed = parseXTweetStatusUrl(input)
  if (!parsed) return null
  return buildFixupxTweetUrl(parsed.handle, parsed.statusId)
}

export function buildDiscordXTweetMirrorContent(
  tweetUrl: string,
  opts?: { mentionEveryone?: boolean; xHandle?: string }
): { ok: true; content: string; fixupxUrl: string } | { ok: false; error: string } {
  const fixupxUrl = normalizeTweetUrlToFixupx(tweetUrl)
  if (!fixupxUrl) {
    return {
      ok: false,
      error:
        'Paste a valid X/Twitter post URL (e.g. https://x.com/Owltopia_sol/status/123… or a fixupx.com link).',
    }
  }

  const handle = (opts?.xHandle ?? OWLTOPIA_X_HANDLE).replace(/^@/, '')
  const prefix = opts?.mentionEveryone === true ? '@everyone ' : ''
  const content = `${prefix}${handle} just tweeted: ${fixupxUrl}`

  return { ok: true, content, fixupxUrl }
}

/** One URL per line (or whitespace-separated); dedupes by status id; max 5. */
export function parseTweetUrlsFromMultiline(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const chunk of input.split(/\s+/)) {
    const raw = chunk.trim()
    if (!raw) continue
    const parsed = parseXTweetStatusUrl(raw)
    if (!parsed) continue
    const key = `${parsed.handle.toLowerCase()}:${parsed.statusId}`
    if (seen.has(key)) continue
    seen.add(key)
    const fixupx = buildFixupxTweetUrl(parsed.handle, parsed.statusId)
    out.push(fixupx)
    if (out.length >= MAX_X_POST_TWEET_MIRRORS) break
  }
  return out
}
