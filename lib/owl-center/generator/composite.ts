import type { TraitCategory, TraitLayer } from '@/lib/owl-center/generator/types'

// Decoded trait images are cached by source so a full-supply export (thousands
// of pieces sharing the same handful of layer PNGs) decodes each layer once
// instead of re-decoding it for every single NFT.
const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return cached

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}`))
    img.src = src
  })
  // Don't cache rejections — a transient load failure shouldn't poison retries.
  promise.catch(() => imageCache.delete(src))
  imageCache.set(src, promise)
  return promise
}

/** Drop cached decoded layer images (call after a large export to free memory). */
export function clearCompositeImageCache(): void {
  imageCache.clear()
}

export async function compositeTraitsToCanvas(
  traits: TraitLayer[],
  categories: TraitCategory[],
  size = 1024,
  reuseCanvas?: HTMLCanvasElement
): Promise<HTMLCanvasElement> {
  const catOrder = new Map(categories.map((c) => [c.id, c.zIndex]))
  const sorted = [...traits].sort(
    (a, b) => (catOrder.get(a.categoryId) ?? 0) - (catOrder.get(b.categoryId) ?? 0)
  )

  const canvas = reuseCanvas ?? document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')

  ctx.clearRect(0, 0, size, size)

  for (const trait of sorted) {
    const img = await loadImage(trait.imageSrc)
    ctx.drawImage(img, 0, 0, size, size)
  }

  return canvas
}

export async function compositeTraitsToBlob(
  traits: TraitLayer[],
  categories: TraitCategory[],
  size = 1024,
  reuseCanvas?: HTMLCanvasElement
): Promise<Blob> {
  const canvas = await compositeTraitsToCanvas(traits, categories, size, reuseCanvas)
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png')
  })
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}
