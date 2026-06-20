import JSZip from 'jszip'

import { clearCompositeImageCache, compositeTraitsToBlob } from '@/lib/owl-center/generator/composite'
import { dataUrlToBlob } from '@/lib/owl-center/generator/one-of-one'
import type { GeneratedNft, GeneratorProject } from '@/lib/owl-center/generator/types'
import {
  StreamingZip,
  openZipFileSink,
  supportsFileSystemAccess,
  type ZipSink,
} from '@/lib/owl-center/generator/zip-stream'

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

function nftMetadataJson(project: GeneratorProject, nft: GeneratedNft): string {
  const { collectionName, symbol, description } = project
  return JSON.stringify(
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
}

export type FullSupplyExportResult = {
  filename: string
  count: number
  /** True when the archive was streamed straight to a user-chosen file (low memory). */
  streamedToDisk: boolean
}

/**
 * Stream a full supply into ONE ZIP, writing each entry as it's built so only a
 * single PNG is ever held in memory. On Chromium (File System Access API) it
 * streams to a user-chosen file with bounded memory; elsewhere it falls back to
 * assembling the archive in memory (still single-download).
 *
 * `prepareBatch` is invoked AFTER the save dialog so the picker keeps the user's
 * activation gesture. Pass `onCancel` handling via the thrown AbortError.
 */
export async function exportFullSupplyStreaming(
  project: GeneratorProject,
  prepareBatch: () => Promise<GeneratedNft[]>,
  onProgress?: (p: SugarZipProgress) => void
): Promise<FullSupplyExportResult> {
  const encoder = new TextEncoder()
  const scratchCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : undefined

  // Open the save target first (while the click gesture is still valid).
  let sink: ZipSink
  let close: (() => Promise<void>) | null = null
  let chunks: Uint8Array[] | null = null
  const streamedToDisk = supportsFileSystemAccess()

  if (streamedToDisk) {
    const opened = await openZipFileSink(`${safeProjectName(project)}.zip`)
    sink = opened.sink
    close = opened.close
  } else {
    chunks = []
    sink = (chunk) => {
      chunks!.push(chunk)
    }
  }

  const batch = await prepareBatch()
  const zip = new StreamingZip(sink)

  try {
    let done = 0
    for (const nft of batch) {
      const pngBlob = nft.oneOfOneImageSrc
        ? await dataUrlToBlob(nft.oneOfOneImageSrc)
        : await compositeTraitsToBlob(nft.traits, project.categories, 1024, scratchCanvas)
      await zip.add(`assets/${nft.index}.png`, new Uint8Array(await pngBlob.arrayBuffer()))
      await zip.add(`assets/${nft.index}.json`, encoder.encode(nftMetadataJson(project, nft)))
      done += 1
      onProgress?.({ phase: 'compositing', completed: done, total: batch.length })
      if (done % 10 === 0) await yieldToBrowser()
    }
    await zip.add('assets/collection.json', encoder.encode(collectionJson(project)))
    await zip.add('assets/traits.csv', encoder.encode(traitsCsv(project, batch)))
    await zip.finish()
  } finally {
    clearCompositeImageCache()
  }

  const filename = sugarZipFilename(project, batch.length)
  if (close) {
    await close()
  } else if (chunks) {
    onProgress?.({ phase: 'zipping', completed: 100, total: 100 })
    triggerDownload(new Blob(chunks as BlobPart[], { type: 'application/zip' }), filename)
  }

  return { filename, count: batch.length, streamedToDisk }
}

