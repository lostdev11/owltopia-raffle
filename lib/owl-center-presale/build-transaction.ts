import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import type { OwlCenterPriceBreakdown } from '@/lib/owl-center-presale/pricing'

export type BuiltOwlCenterPresaleTransaction = {
  serializedBase64: string
  blockhash: string
  lastValidBlockHeight: number
}

/**
 * Builds buyer payment: spot proceeds → partner, platform fee → Owltopia treasury.
 * When platform fee is 0, only the partner transfer is included.
 */
export async function buildOwlCenterPresalePaymentTransaction(params: {
  connection: Connection
  buyer: PublicKey
  breakdown: OwlCenterPriceBreakdown
  partnerWallet: PublicKey
  platformFeeWallet: PublicKey
}): Promise<BuiltOwlCenterPresaleTransaction> {
  const { connection, buyer, breakdown, partnerWallet, platformFeeWallet } = params

  if (breakdown.partnerLamports <= 0n) {
    throw new Error('Partner proceeds must be positive')
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: buyer,
      toPubkey: partnerWallet,
      lamports: Number(breakdown.partnerLamports),
    })
  )

  if (breakdown.platformFeeLamports > 0n) {
    if (partnerWallet.equals(platformFeeWallet)) {
      // Same destination — combine into one transfer to avoid zero-ix / double-send quirks.
      tx.instructions[0] = SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: partnerWallet,
        lamports: Number(breakdown.totalLamports),
      })
    } else {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: buyer,
          toPubkey: platformFeeWallet,
          lamports: Number(breakdown.platformFeeLamports),
        })
      )
    }
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.feePayer = buyer

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  })

  return {
    serializedBase64: Buffer.from(serialized).toString('base64'),
    blockhash,
    lastValidBlockHeight,
  }
}
