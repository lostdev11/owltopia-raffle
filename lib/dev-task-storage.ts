import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  DEV_TASK_SCREENSHOTS_BUCKET,
  DEV_TASK_SCREENSHOT_MAX_BYTES,
  DEV_TASK_SCREENSHOT_MAX_FILES,
} from '@/lib/dev-task-screenshot-limits'

export {
  DEV_TASK_SCREENSHOTS_BUCKET,
  DEV_TASK_SCREENSHOT_MAX_BYTES,
  DEV_TASK_SCREENSHOT_MAX_FILES,
} from '@/lib/dev-task-screenshot-limits'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

const SAFE_EXT = new Set(['jpg', 'png', 'webp', 'gif', 'heic', 'heif'])

function normalizeExt(ext: string): string {
  const e = ext.toLowerCase()
  return e === 'jpeg' ? 'jpg' : e
}

function extFromFilename(name: string): string | null {
  const i = name.lastIndexOf('.')
  if (i < 0 || i === name.length - 1) return null
  return normalizeExt(name.slice(i + 1))
}

export function isAllowedScreenshotFile(file: { type: string; name?: string; size: number }): {
  ok: true
  ext: string
} | { ok: false; error: string } {
  if (file.size > DEV_TASK_SCREENSHOT_MAX_BYTES) {
    return {
      ok: false,
      error: `Each image must be ${DEV_TASK_SCREENSHOT_MAX_BYTES / (1024 * 1024)}MB or smaller.`,
    }
  }
  if (file.size < 1) {
    return { ok: false, error: 'File is empty.' }
  }

  const mime = (file.type || '').toLowerCase().split(';')[0].trim()
  if (mime === 'image/svg+xml' || mime.includes('svg')) {
    return { ok: false, error: 'SVG is not allowed.' }
  }

  if (mime.startsWith('image/')) {
    const fromMime = EXT_BY_MIME[mime]
    const fromName = file.name ? extFromFilename(file.name) : null
    const ext = normalizeExt(fromMime ?? fromName ?? 'jpg')
    if (!SAFE_EXT.has(ext)) {
      return { ok: false, error: 'Unsupported image type.' }
    }
    return { ok: true, ext }
  }

  const fromName = file.name ? extFromFilename(file.name) : null
  if (fromName && SAFE_EXT.has(fromName)) {
    return { ok: true, ext: fromName }
  }

  return { ok: false, error: 'Only image files are allowed (e.g. JPG, PNG, WebP, HEIC).' }
}

export function publicUrlForScreenshotPath(storagePath: string): string {
  const { data } = getSupabaseAdmin().storage.from(DEV_TASK_SCREENSHOTS_BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
}

export async function uploadDevTaskScreenshots(
  taskId: string,
  files: Array<{ buffer: Buffer; type: string; name?: string }>
): Promise<{ paths: string[] } | { error: string }> {
  if (files.length === 0) return { paths: [] }
  if (files.length > DEV_TASK_SCREENSHOT_MAX_FILES) {
    return { error: `You can attach at most ${DEV_TASK_SCREENSHOT_MAX_FILES} images per request.` }
  }

  const admin = getSupabaseAdmin()
  const paths: string[] = []

  for (const file of files) {
    const check = isAllowedScreenshotFile({ type: file.type, name: file.name, size: file.buffer.length })
    if (!check.ok) return { error: check.error }
    const path = `${taskId}/${randomUUID()}.${check.ext}`
    const contentType =
      file.type && file.type.startsWith('image/')
        ? file.type.split(';')[0].trim()
        : `image/${check.ext === 'jpg' ? 'jpeg' : check.ext}`
    const { error } = await admin.storage.from(DEV_TASK_SCREENSHOTS_BUCKET).upload(path, file.buffer, {
      contentType,
      upsert: false,
    })
    if (error) {
      console.error('uploadDevTaskScreenshots:', error)
      if (paths.length) {
        await admin.storage.from(DEV_TASK_SCREENSHOTS_BUCKET).remove(paths)
      }
      return { error: 'Upload failed. Check that the dev-task-screenshots storage bucket exists.' }
    }
    paths.push(path)
  }

  return { paths }
}

export async function removeDevTaskScreenshotPaths(paths: string[] | null | undefined): Promise<void> {
  if (!paths?.length) return
  const admin = getSupabaseAdmin()
  const { error } = await admin.storage.from(DEV_TASK_SCREENSHOTS_BUCKET).remove(paths)
  if (error) {
    console.error('removeDevTaskScreenshotPaths:', error)
  }
}

export function screenshotUrlsFromPaths(paths: string[] | null | undefined): string[] {
  if (!paths?.length) return []
  return paths.map(publicUrlForScreenshotPath)
}
