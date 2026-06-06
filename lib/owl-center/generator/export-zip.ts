import JSZip from 'jszip'

import { compositeTraitsToBlob } from '@/lib/owl-center/generator/composite'
import { dataUrlToBlob } from '@/lib/owl-center/generator/one-of-one'
import type { GeneratedNft, GeneratorProject } from '@/lib/owl-center/generator/types'

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportBatchAsSugarZip(
  project: GeneratorProject,
  batch: GeneratedNft[],
  filename?: string
): Promise<void> {
  const zip = new JSZip()
  const assets = zip.folder('assets')
  if (!assets) throw new Error('Zip folder failed')

  const { collectionName, symbol, description } = project

  for (const nft of batch) {
    const png = nft.oneOfOneImageSrc
      ? await dataUrlToBlob(nft.oneOfOneImageSrc)
      : await compositeTraitsToBlob(nft.traits, project.categories)
    assets.file(`${nft.index}.png`, png)
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

  assets.file(
    'collection.json',
    JSON.stringify(
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
  )

  assets.file(
    'traits.csv',
    [
      'index,' + project.categories.map((c) => c.name.toLowerCase()).join(','),
      ...batch.map((nft) => {
        const byCat = new Map(
          nft.attributes.map((a) => [a.trait_type.toLowerCase(), a.value])
        )
        return [
          nft.index,
          ...project.categories.map((c) => byCat.get(c.name.toLowerCase()) ?? ''),
        ].join(',')
      }),
    ].join('\n') + '\n'
  )

  const blob = await zip.generateAsync({ type: 'blob' })
  const safeName = (filename ?? (project.name || 'owl-collection'))
    .replace(/[^a-z0-9-_]+/gi, '-')
    .toLowerCase()
  triggerDownload(blob, `${safeName}-batch-${batch.length}.zip`)
}
