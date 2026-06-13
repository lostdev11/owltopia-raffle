/**
 * Irys / Arweave uploader for Owl Center Phase B.
 * Requires: npm install @irys/upload @irys/upload-solana
 */

export function isIrysUploadConfigured(): boolean {
  return Boolean(process.env.IRYS_PRIVATE_KEY?.trim())
}

export function irysNetworkLabel(): 'devnet' | 'mainnet' {
  return process.env.IRYS_NETWORK?.trim().toLowerCase() === 'devnet' ? 'devnet' : 'mainnet'
}

export async function uploadBufferToArweaveViaIrys(
  data: Buffer,
  contentType: string
): Promise<{ uri: string; id: string }> {
  const key = process.env.IRYS_PRIVATE_KEY?.trim()
  if (!key) {
    throw new Error('IRYS_PRIVATE_KEY is not configured — add a funded Solana wallet secret to enable Arweave upload.')
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

  const receipt = await irys.upload(data, {
    tags: [{ name: 'Content-Type', value: contentType }],
  })

  const id = String(receipt.id)
  return {
    id,
    uri: `https://arweave.net/${id}`,
  }
}
