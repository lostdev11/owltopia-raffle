/**
 * Read multipart file fields as buffers for API routes.
 * Uses Blob duck-typing: Node/undici may return Blob for file parts, or `instanceof File`
 * can be false across realms, which would skip uploads if we only checked File.
 */
export async function readFormDataFileParts(
  form: FormData,
  fieldName: string
): Promise<Array<{ buffer: Buffer; type: string; name: string }>> {
  const out: Array<{ buffer: Buffer; type: string; name: string }> = []
  for (const value of form.getAll(fieldName)) {
    if (typeof value !== 'object' || value === null) continue
    const blob = value as Blob
    if (typeof blob.size !== 'number' || blob.size <= 0) continue
    if (typeof blob.arrayBuffer !== 'function') continue
    const buffer = Buffer.from(await blob.arrayBuffer())
    const type = typeof blob.type === 'string' ? blob.type : ''
    const name = fileNameFromFormPart(value)
    out.push({ buffer, type, name })
  }
  return out
}

function fileNameFromFormPart(value: object): string {
  if ('name' in value && typeof (value as { name?: unknown }).name === 'string') {
    const n = (value as { name: string }).name
    if (n.trim()) return n
  }
  return 'image'
}
