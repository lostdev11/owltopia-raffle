import type { MintGen2Result } from '@/lib/solana/gen2-mint'

export type MintSessionOutcome = {
  mintedCount: number
  lastSig: string | null
  lastMintAddress: string | null
  /** All NFT mint addresses from this session (same order as on-chain batch). */
  mintedAddresses: string[]
  /** Set when some mints succeeded but the batch did not finish. */
  warning: string | null
}

export function resolveMintSessionOutcome(
  minted: MintGen2Result,
  _requestedQuantity?: number
): MintSessionOutcome | { error: string } {
  const sigs = minted.ok ? minted.txSignatures : (minted.txSignatures ?? [])
  const mints = minted.ok ? minted.mintedNftMints : (minted.mintedNftMints ?? [])

  if (!minted.ok && mints.length === 0 && sigs.length === 0) {
    return { error: minted.error }
  }

  const lastSig = sigs.length ? sigs[sigs.length - 1]! : null
  const lastMintAddress = mints.length ? mints[mints.length - 1]! : null
  const mintedCount = mints.length || sigs.length

  // Consumers just want it to work — we celebrate whatever minted and let them tap Mint again
  // for any remainder. No alarming "wallet reported an error / X left" copy on the success screen.
  return {
    mintedCount,
    lastSig,
    lastMintAddress,
    mintedAddresses: mints,
    warning: null,
  }
}

export type MintConfirmBatchPayload = {
  txSignature: string
  quantity: number
  mintedNftMints: string[]
}

export async function recordMintSessionConfirms(
  sigs: string[],
  mintPks: string[],
  confirmBatch: (payload: MintConfirmBatchPayload) => Promise<void>,
  onProgress?: (confirmedCount: number, totalSteps: number) => void
): Promise<{ confirmedCount: number; lastSig: string | null; lastMintAddress: string | null }> {
  if (sigs.length === 0) {
    return { confirmedCount: 0, lastSig: null, lastMintAddress: null }
  }

  if (sigs.length === 1) {
    onProgress?.(0, 1)
    await confirmBatch({
      txSignature: sigs[0]!,
      quantity: mintPks.length,
      mintedNftMints: mintPks,
    })
    onProgress?.(1, 1)
    return {
      confirmedCount: mintPks.length,
      lastSig: sigs[0]!,
      lastMintAddress: mintPks[mintPks.length - 1] ?? null,
    }
  }

  let lastSig: string | null = null
  let lastMintAddress: string | null = null
  for (let i = 0; i < sigs.length; i++) {
    const txSignature = sigs[i]!
    const mintedNftMint = mintPks[i] ?? null
    await confirmBatch({
      txSignature,
      quantity: 1,
      mintedNftMints: mintedNftMint ? [mintedNftMint] : [],
    })
    lastSig = txSignature
    if (mintedNftMint) lastMintAddress = mintedNftMint
    onProgress?.(i + 1, sigs.length)
  }

  return { confirmedCount: mintPks.length, lastSig, lastMintAddress }
}
