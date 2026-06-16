import type { MintGen2Result } from '@/lib/solana/gen2-mint'

export type MintSessionOutcome = {
  mintedCount: number
  lastSig: string | null
  lastMintAddress: string | null
  /** Set when some mints succeeded but the batch did not finish. */
  warning: string | null
}

export function resolveMintSessionOutcome(
  minted: MintGen2Result,
  requestedQuantity: number
): MintSessionOutcome | { error: string } {
  const sigs = minted.ok ? minted.txSignatures : (minted.txSignatures ?? [])
  const mints = minted.ok ? minted.mintedNftMints : (minted.mintedNftMints ?? [])

  if (!minted.ok && sigs.length === 0) {
    return { error: minted.error }
  }

  const lastSig = sigs.length ? sigs[sigs.length - 1]! : null
  const lastMintAddress = mints.length ? mints[mints.length - 1]! : null

  let warning: string | null = null
  if (!minted.ok) {
    const remaining = Math.max(0, requestedQuantity - sigs.length)
    warning =
      remaining > 0
        ? `${minted.error} ${remaining} mint${remaining === 1 ? '' : 's'} left — tap Mint again to continue.`
        : minted.error
  }

  return {
    mintedCount: sigs.length,
    lastSig,
    lastMintAddress,
    warning,
  }
}

export type MintConfirmPayload = {
  txSignature: string
  mintedNftMint: string | null
}

export async function recordMintConfirms(
  payloads: MintConfirmPayload[],
  confirmOne: (payload: MintConfirmPayload) => Promise<void>,
  onProgress?: (confirmedCount: number) => void
): Promise<{ confirmedCount: number; lastSig: string | null; lastMintAddress: string | null }> {
  let lastSig: string | null = null
  let lastMintAddress: string | null = null

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i]!
    await confirmOne(payload)
    lastSig = payload.txSignature
    if (payload.mintedNftMint) lastMintAddress = payload.mintedNftMint
    onProgress?.(i + 1)
  }

  return { confirmedCount: payloads.length, lastSig, lastMintAddress }
}
