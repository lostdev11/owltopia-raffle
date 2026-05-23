import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import type { OwlCenterPriceBreakdown } from '@/lib/owl-center-presale/pricing'

export type BuiltOwlCenterPresaleTransaction = {
  serializedBase64: string
  blockhash: string
  lastValidBlockHeight: number
}

export async function buildOwlCenterPresalePaymentTransaction(params: {
  connection: Connection
  buyer: PublicKey
  breakdown: OwlCenterPriceBreakdown
  treasury: PublicKey
}): Promise<BuiltOwlCenterPresaleTransaction> {
  const { connection, buyer, breakdown, treasury } = params

  const ix = SystemProgram.transfer({
    fromPubkey: buyer,
    toPubkey: treasury,
    lamports: Number(breakdown.treasuryLamports),
  })

  const tx = new Transaction().add(ix)
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
