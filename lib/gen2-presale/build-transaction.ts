import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import type { Gen2PriceBreakdown } from '@/lib/gen2-presale/pricing'

export type BuiltPresaleTransaction = {
  serializedBase64: string
  blockhash: string
  lastValidBlockHeight: number
}

export async function buildGen2PresalePaymentTransaction(params: {
  connection: Connection
  buyer: PublicKey
  breakdown: Gen2PriceBreakdown
  founderA: PublicKey
  founderB: PublicKey
}): Promise<BuiltPresaleTransaction> {
  const { connection, buyer, breakdown, founderA, founderB } = params

  const ixA = SystemProgram.transfer({
    fromPubkey: buyer,
    toPubkey: founderA,
    lamports: Number(breakdown.founderALamports),
  })
  const ixB = SystemProgram.transfer({
    fromPubkey: buyer,
    toPubkey: founderB,
    lamports: Number(breakdown.founderBLamports),
  })

  const tx = new Transaction().add(ixA, ixB)
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
