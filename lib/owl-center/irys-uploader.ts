import 'server-only'

/**
 * Irys / Arweave uploader for Owl Center Phase B.
 * Requires: npm install @irys/upload @irys/upload-solana
 */

import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'
import { lamportsToSolDisplay } from '@/lib/gen2-presale/format-sol'
import { irysNetworkLabel, isIrysUploadConfigured } from '@/lib/owl-center/irys-config'
import { normalizeOwlCenterArweaveGatewayUri } from '@/lib/owl-center/arweave-gateway-uri'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export { isIrysUploadConfigured, irysNetworkLabel } from '@/lib/owl-center/irys-config'

function irysRpcUrl(): string {
  if (irysNetworkLabel() === 'devnet') {
    const dev =
      process.env.SOLANA_RPC_DEVNET_URL?.trim() ||
      process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim()
    if (dev) return dev
    return 'https://api.devnet.solana.com'
  }
  return resolveServerSolanaRpcUrl()
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
  let builder: any = Uploader(Solana).withWallet(key).withRpc(irysRpcUrl())
  if (irysNetworkLabel() === 'devnet') {
    builder = builder.devnet()
  }
  const irys = await builder
  return { irys }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function irysUploadPriceLamports(irys: any, totalBytes: number, fileCount: number): Promise<bigint> {
  const priceAtomic =
    typeof irys.utils?.estimateFolderPrice === 'function'
      ? await irys.utils.estimateFolderPrice({ fileCount, totalBytes })
      : typeof irys.getPrice === 'function'
        ? await irys.getPrice(totalBytes)
        : null
  if (priceAtomic == null) {
    throw new Error('Could not quote Irys upload price')
  }
  return BigInt(String(priceAtomic))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function irysLoadedBalanceLamports(irys: any): Promise<bigint> {
  if (typeof irys.getLoadedBalance === 'function') {
    return BigInt(String(await irys.getLoadedBalance()))
  }
  if (typeof irys.getBalance === 'function') {
    return BigInt(String(await irys.getBalance()))
  }
  return 0n
}

export type IrysFundResult = {
  funded: boolean
  payer_address: string
  loaded_balance_before_lamports: string
  loaded_balance_after_lamports: string
  required_lamports: string
}

/** Deposit SOL from payer wallet into Irys when bundler balance is below upload cost. */
export async function ensureIrysFundedForUpload(
  totalBytes: number,
  fileCount: number
): Promise<IrysFundResult> {
  const { irys } = await buildIrysUploader()
  const payerAddress = String(irys.address ?? '')
  const required = await irysUploadPriceLamports(irys, totalBytes, fileCount)
  const target = (required * 125n) / 100n
  const loadedBefore = await irysLoadedBalanceLamports(irys)

  if (loadedBefore >= target) {
    return {
      funded: false,
      payer_address: payerAddress,
      loaded_balance_before_lamports: loadedBefore.toString(),
      loaded_balance_after_lamports: loadedBefore.toString(),
      required_lamports: required.toString(),
    }
  }

  const shortfall = target - loadedBefore
  try {
    await irys.fund(shortfall, 1.2)
  } catch (e) {
    throw new Error(formatIrysUploadError(e, payerAddress))
  }

  const loadedAfter = await irysLoadedBalanceLamports(irys)
  if (loadedAfter < required) {
    throw new Error(
      `Irys fund tx sent but bundler balance (${lamportsToSolDisplay(loadedAfter)} SOL) is still below upload cost (~${lamportsToSolDisplay(required)} SOL). ` +
        `Ensure payer wallet ${payerAddress} has SOL on ${irysNetworkLabel()} and retry.`
    )
  }

  return {
    funded: true,
    payer_address: payerAddress,
    loaded_balance_before_lamports: loadedBefore.toString(),
    loaded_balance_after_lamports: loadedAfter.toString(),
    required_lamports: required.toString(),
  }
}

function formatIrysUploadError(error: unknown, payerAddress?: string): string {
  const base = error instanceof Error ? error.message : String(error)
  if (base.includes('402') || /not enough balance/i.test(base)) {
    const payer = payerAddress ? ` Payer: ${payerAddress}.` : ''
    return (
      `Irys bundler balance too low (402). SOL must be deposited to Irys (not only held in the wallet).` +
      `${payer} Auto-fund failed — send SOL to the payer wallet on ${irysNetworkLabel()}, then retry Push to Arweave.`
    )
  }
  return base
}

/** Live Irys folder quote (per-file tx overhead + data bytes). */
export async function estimateIrysFolderUploadLamports(
  totalBytes: number,
  fileCount: number
): Promise<{ lamports: bigint; solUsdPrice: number } | null> {
  if (!isIrysUploadConfigured() || totalBytes < 1 || fileCount < 1) return null
  try {
    const { irys } = await buildIrysUploader()
    const lamports = await irysUploadPriceLamports(irys, totalBytes, fileCount)
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

export type IrysUploaderHandle = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  irys: any
  payerAddress: string
}

/**
 * Build a reusable Irys uploader. Building the client runs an Irys node handshake,
 * so callers uploading many files MUST build once and reuse — rebuilding per file
 * (the old uploadBufferToArweaveViaIrys behaviour) dominated upload runtime.
 */
export async function createIrysUploader(): Promise<IrysUploaderHandle> {
  const { irys } = await buildIrysUploader()
  return { irys, payerAddress: String(irys.address ?? '') }
}

/** Upload a single buffer using an already-built uploader (no per-file rebuild). */
export async function uploadBufferWithUploader(
  handle: IrysUploaderHandle,
  data: Buffer,
  contentType: string
): Promise<{ uri: string; id: string }> {
  try {
    const receipt = await handle.irys.upload(data, {
      tags: [{ name: 'Content-Type', value: contentType }],
    })
    const id = String(receipt.id)
    const network = irysNetworkLabel()
    return {
      id,
      uri: normalizeOwlCenterArweaveGatewayUri(`https://arweave.net/${id}`, network),
    }
  } catch (e) {
    throw new Error(formatIrysUploadError(e, handle.payerAddress))
  }
}

export async function uploadBufferToArweaveViaIrys(
  data: Buffer,
  contentType: string
): Promise<{ uri: string; id: string }> {
  const handle = await createIrysUploader()
  return uploadBufferWithUploader(handle, data, contentType)
}
