/**
 * Irys / Arweave uploader for Owl Center Phase B.
 * Requires: npm install @irys/upload @irys/upload-solana
 */

import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'

export function isIrysUploadConfigured(): boolean {
  return Boolean(process.env.IRYS_PRIVATE_KEY?.trim())
}

export function irysNetworkLabel(): 'devnet' | 'mainnet' {
  return process.env.IRYS_NETWORK?.trim().toLowerCase() === 'devnet' ? 'devnet' : 'mainnet'
}

async function buildIrysUploader(): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  irys: any
}> {
  const key = process.env.IRYS_PRIVATE_KEY?.trim()
  if (!key) {
    throw new Error('IRYS_PRIVATE_KEY is not configured')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Uploader: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Solana: any
  try {
    ;({ Uploader } = await import('@irys/upload'))
    ;({ Solana } = await import('@irys/upload-solana'))
  } catch {
    throw new Error('Irys packages missing — run: npm install @irys/upload @irys/upload-solana')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let builder: any = Uploader(Solana).withWallet(key)
  if (irysNetworkLabel() === 'devnet') {
    builder = builder.devnet()
  }
  const irys = await builder
  return { irys }
}

/** Live Irys folder quote (per-file tx overhead + data bytes). */
export async function estimateIrysFolderUploadLamports(
  totalBytes: number,
  fileCount: number
): Promise<{ lamports: bigint; solUsdPrice: number } | null> {
  if (!isIrysUploadConfigured() || totalBytes < 1 || fileCount < 1) return null
  try {
    const { irys } = await buildIrysUploader()
    const priceAtomic =
      typeof irys.utils?.estimateFolderPrice === 'function'
        ? await irys.utils.estimateFolderPrice({ fileCount, totalBytes })
        : typeof irys.getPrice === 'function'
          ? await irys.getPrice(totalBytes)
          : null
    if (priceAtomic == null) return null

    const lamports = BigInt(String(priceAtomic))
    let solUsdPrice: number
    try {
      solUsdPrice = await resolveGen2SolUsdPrice()
    } catch {
      solUsdPrice = 0
    }
    return { lamports, solUsdPrice }
  } catch (e) {
    console.error('estimateIrysFolderUploadLamports', e)
    return null
  }
}

export async function uploadBufferToArweaveViaIrys(
  data: Buffer,
  contentType: string
): Promise<{ uri: string; id: string }> {
  const { irys } = await buildIrysUploader()

  const receipt = await irys.upload(data, {
    tags: [{ name: 'Content-Type', value: contentType }],
  })

  const id = String(receipt.id)
  return {
    id,
    uri: `https://arweave.net/${id}`,
  }
}
