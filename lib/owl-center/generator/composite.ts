import type { TraitCategory, TraitLayer } from '@/lib/owl-center/generator/types'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}`))
    img.src = src
  })
}

export async function compositeTraitsToCanvas(
  traits: TraitLayer[],
  categories: TraitCategory[],
  size = 1024
): Promise<HTMLCanvasElement> {
  const catOrder = new Map(categories.map((c) => [c.id, c.zIndex]))
  const sorted = [...traits].sort(
    (a, b) => (catOrder.get(a.categoryId) ?? 0) - (catOrder.get(b.categoryId) ?? 0)
  )

  const canvas = document.createElement('canvas')
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
  size = 1024
): Promise<Blob> {
  const canvas = await compositeTraitsToCanvas(traits, categories, size)
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png')
  })
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}
