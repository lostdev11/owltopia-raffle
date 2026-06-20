import JSZip from 'jszip'

import { clearCompositeImageCache, compositeTraitsToBlob } from '@/lib/owl-center/generator/composite'
import { dataUrlToBlob } from '@/lib/owl-center/generator/one-of-one'
import type { GeneratedNft, GeneratorProject } from '@/lib/owl-center/generator/types'

// Hand control back to the browser so progress repaints and the main thread
// doesn't lock up while compositing a large (e.g. 2,000-piece) supply.
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // Keep the object URL alive long enough for the browser to start reading a
  // large blob. Revoking synchronously cancels downloads of big ZIPs.
  window.setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 60_000)
}

export type SugarZipProgress = {
  phase: 'compositing' | 'zipping'
  completed: number
  total: number
}

function safeProjectName(project: GeneratorProject, filename?: string): string {
  return (filename ?? (project.name || 'owl-collection'))
    .replace(/[^a-z0-9-_]+/gi, '-')
    .toLowerCase()
}

function sugarZipFilename(project: GeneratorProject, batchLength: number, filename?: string): string {
  return `${safeProjectName(project, filename)}-batch-${batchLength}.zip`
}

/** Composite one NFT and write its PNG + metadata JSON into the assets folder. */
async function addNftToAssets(
  assets: JSZip,
  nft: GeneratedNft,
  project: GeneratorProject,
  scratchCanvas?: HTMLCanvasElement
): Promise<void> {
  const { collectionName, symbol, description } = project
  const png = nft.oneOfOneImageSrc
    ? await dataUrlToBlob(nft.oneOfOneImageSrc)
    : await compositeTraitsToBlob(nft.traits, project.categories, 1024, scratchCanvas)
  // PNGs are already compressed — STORE avoids re-deflating (less CPU/memory).
  assets.file(`${nft.index}.png`, png, { compression: 'STORE' })
  assets.file(
    `${nft.index}.json`,
    JSON.stringify(
      {
        name: `${collectionName} #${nft.index}`,
        symbol,
        description: `${description} Token ${nft.index}.`,
        image: `${nft.index}.png`,
        attributes: nft.attributes,
        properties: {
          files: [{ uri: `${nft.index}.png`, type: 'image/png' }],
          category: 'image',
        },
      },
      null,
      2
    )
  )
}

function collectionJson(project: GeneratorProject): string {
  const { collectionName, symbol, description } = project
  return JSON.stringify(
    {
      name: collectionName,
      symbol,
      description,
      image: 'collection.png',
      properties: {
        files: [{ uri: 'collection.png', type: 'image/png' }],
        category: 'image',
      },
    },
    null,
    2
  )
}

function traitsCsv(project: GeneratorProject, batch: GeneratedNft[]): string {
  return (
    [
      'index,' + project.categories.map((c) => c.name.toLowerCase()).join(','),
      ...batch.map((nft) => {
        const byCat = new Map(nft.attributes.map((a) => [a.trait_type.toLowerCase(), a.value]))
        return [
          nft.index,
          ...project.categories.map((c) => byCat.get(c.name.toLowerCase()) ?? ''),
        ].join(',')
      }),
    ].join('\n') + '\n'
  )
}

export async function buildSugarZipBlob(
  project: GeneratorProject,
  batch: GeneratedNft[],
  filename?: string,
  onProgress?: (p: SugarZipProgress) => void
): Promise<{ blob: Blob; filename: string; count: number }> {
  const zip = new JSZip()
  const assets = zip.folder('assets')
  if (!assets) throw new Error('Zip folder failed')

  // One reusable canvas for every generative composite — avoids allocating a
  // fresh 1024×1024 canvas per NFT, which is what made 2,000-piece exports
  // exhaust memory and silently stall before any download started.
  const scratchCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : undefined

  let done = 0
  try {
    for (const nft of batch) {
      await addNftToAssets(assets, nft, project, scratchCanvas)
      done += 1
      onProgress?.({ phase: 'compositing', completed: done, total: batch.length })
      // Yield periodically so the progress UI repaints and mobile browsers
      // don't kill an apparently unresponsive tab during a large export.
      if (done % 25 === 0) await yieldToBrowser()
    }
  } finally {
    clearCompositeImageCache()
  }

  assets.file('collection.json', collectionJson(project))
  assets.file('traits.csv', traitsCsv(project, batch))

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE', streamFiles: true },
    (meta) => {
      onProgress?.({ phase: 'zipping', completed: Math.round(meta.percent), total: 100 })
    }
  )
  const outName = sugarZipFilename(project, batch.length, filename)
  return { blob, filename: outName, count: batch.length }
}

export async function exportBatchAsSugarZip(
  project: GeneratorProject,
  batch: GeneratedNft[],
  filename?: string,
  onProgress?: (p: SugarZipProgress) => void
): Promise<{ blob: Blob; filename: string; count: number }> {
  const built = await buildSugarZipBlob(project, batch, filename, onProgress)
  triggerDownload(built.blob, built.filename)
  return built
}

