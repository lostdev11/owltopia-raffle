'use client'

import { useCallback, useState } from 'react'
import { Download, X } from 'lucide-react'

/**
 * Coarse "is this a touch device" check. ~75% of users are on mobile crypto
 * wallets (Phantom/Solflare), where the in-app browser cannot reliably download
 * blobs — so we treat these as mobile and surface an inline long-press preview.
 */
export function isLikelyMobile(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  return (
    (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0) ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: none), (pointer: coarse)').matches)
  )
}

type SaveImageShareOptions = {
  /** Title used by the native share sheet. */
  title?: string
  /** Body text used by the native share sheet. */
  text?: string
}

type PreviewState = {
  url: string
  fileName: string
} | null

type SaveImageResult = 'shared' | 'preview' | 'downloaded' | 'cancelled'

/**
 * Robust, mobile-first image save flow.
 *
 * Order of attempts:
 * 1. Web Share API with files (lets the user "Save Image" via the OS sheet).
 * 2. On touch devices, show an in-page preview the user can long-press to save.
 *    (We never `window.open(blobUrl)` — blob URLs render as a blank page in
 *    most in-app wallet browsers and iOS Safari, and popups opened after an
 *    `await` are usually blocked.)
 * 3. On desktop, trigger a normal `<a download>` click.
 *
 * Render `savePngOverlay` somewhere in your component tree for the preview to show.
 */
export function useSaveImage() {
  const [preview, setPreview] = useState<PreviewState>(null)

  const closePreview = useCallback(() => {
    setPreview((current) => {
      if (current) {
        window.setTimeout(() => window.URL.revokeObjectURL(current.url), 0)
      }
      return null
    })
  }, [])

  const saveImage = useCallback(
    async (
      blob: Blob,
      fileName: string,
      options: SaveImageShareOptions = {}
    ): Promise<SaveImageResult> => {
      const nav = typeof navigator !== 'undefined' ? navigator : null
      const file =
        typeof File !== 'undefined' ? new File([blob], fileName, { type: blob.type || 'image/png' }) : null

      const canShareFile =
        !!nav &&
        !!file &&
        typeof nav.share === 'function' &&
        typeof nav.canShare === 'function' &&
        nav.canShare({ files: [file] })

      if (canShareFile && file) {
        try {
          await nav.share({ title: options.title, text: options.text, files: [file] })
          return 'shared'
        } catch (shareErr) {
          if (shareErr instanceof DOMException && shareErr.name === 'AbortError') {
            return 'cancelled'
          }
          // Fall through to the preview / download fallbacks below.
        }
      }

      const blobUrl = window.URL.createObjectURL(blob)

      if (isLikelyMobile()) {
        setPreview((current) => {
          if (current) window.URL.revokeObjectURL(current.url)
          return { url: blobUrl, fileName }
        })
        return 'preview'
      }

      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileName
      a.rel = 'noopener'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 15_000)
      return 'downloaded'
    },
    []
  )

  const savePngOverlay = preview ? (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-background/90 backdrop-blur-sm p-4 safe-area-bottom"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-png-overlay-title"
    >
      <div className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-lg space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 text-left">
            <h2 id="save-png-overlay-title" className="text-lg font-semibold text-foreground">
              Save image
            </h2>
            <p className="text-sm text-muted-foreground">
              Press and hold the image, then tap “Save Image” (or “Download image”) to add it to your
              device.
            </p>
          </div>
          <button
            type="button"
            onClick={closePreview}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 touch-manipulation items-center justify-center rounded-md border border-border bg-muted/50"
            aria-label="Close save preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL for long-press save */}
        <img
          src={preview.url}
          alt="Generated image — long-press to save"
          className="w-full rounded-md border border-border"
          draggable={false}
        />
        <a
          href={preview.url}
          download={preview.fileName}
          className="inline-flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 rounded-md border border-border bg-muted px-4 text-sm font-medium hover:bg-muted/80"
        >
          <Download className="h-4 w-4" />
          Download image
        </a>
      </div>
    </div>
  ) : null

  return { saveImage, savePngOverlay, isMobile: isLikelyMobile }
}
