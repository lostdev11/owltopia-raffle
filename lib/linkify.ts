/**
 * Normalizes text so that pasted URLs are detected (e.g. from Word, web, etc.).
 * - Replaces fullwidth ASCII with halfwidth
 * - Removes zero-width and other invisible characters that break URL detection
 * - Replaces no-break space (U+00A0) with normal space
 */
function normalizeTextForUrls(text: string): string {
  if (!text || typeof text !== 'string') return ''
  let out = text
  // Zero-width and similar characters that can appear in pasted content
  out = out.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
  // No-break space → normal space
  out = out.replace(/\u00A0/g, ' ')
  // Fullwidth ASCII (e.g. Ｈｔｔｐｓ：／／) → halfwidth (optional but helps)
  const fullwidthMap: Record<string, string> = {}
  for (let i = 0; i < 95; i++) {
    const c = String.fromCharCode(0x20 + i)
    const full = String.fromCharCode(0xFF00 + i)
    if (i === 0) fullwidthMap['\u3000'] = ' ' // ideographic space
    fullwidthMap[full] = c
  }
  Object.entries(fullwidthMap).forEach(([full, half]) => {
    out = out.split(full).join(half)
  })
  return out
}

/** Matches http:// and https:// URLs; avoids trailing punctuation that's not part of the URL */
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+?)(?=[\s,)\.\]}>"']|$)/gi

export type LinkifySegment = { type: 'text'; value: string } | { type: 'link'; url: string; value: string }

/**
 * Splits text into segments: plain text and URLs. Handles pasted content by normalizing first.
 */
export function linkifySegments(text: string | null | undefined): LinkifySegment[] {
  const raw = text ?? ''
  const normalized = normalizeTextForUrls(raw)
  if (!normalized) return []

  const segments: LinkifySegment[] = []
  let lastIndex = 0
  let m: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((m = URL_REGEX.exec(normalized)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'text', value: normalized.slice(lastIndex, m.index) })
    }
    const url = m[1]
    segments.push({ type: 'link', url, value: url })
    lastIndex = m.index + url.length
  }
  if (lastIndex < normalized.length) {
    segments.push({ type: 'text', value: normalized.slice(lastIndex) })
  }
  return segments.length > 0 ? segments : [{ type: 'text', value: normalized }]
}
