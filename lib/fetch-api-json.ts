/** Parse JSON API responses; surface plain-text platform errors (e.g. 413 body limit). */
export async function readApiJsonResponse<T extends Record<string, unknown>>(
  res: Response
): Promise<T> {
  const text = await res.text()
  if (!text.trim()) {
    if (res.status === 413) {
      throw new Error(
        'ZIP is too large to upload through the app server. Retry staging — direct storage upload should be used automatically.'
      )
    }
    throw new Error(`Request failed (${res.status})`)
  }

  try {
    return JSON.parse(text) as T
  } catch {
    const lower = text.toLowerCase()
    if (res.status === 413 || lower.includes('request entity too large')) {
      throw new Error(
        'ZIP is too large to upload through the app server. Retry staging — direct storage upload should be used automatically.'
      )
    }
    throw new Error(text.slice(0, 160).trim() || `Request failed (${res.status})`)
  }
}
