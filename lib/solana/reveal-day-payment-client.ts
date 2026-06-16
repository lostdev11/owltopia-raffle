import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import { getOwlCenterPlatformTreasuryWalletClient } from '@/lib/owl-center/platform-treasury'
import { getLaunchSolanaRpcUrl } from '@/lib/solana/launch-cm'
import type { OwlMintNetwork } from '@/lib/solana/network'

export async function sendRevealDayFeeSolTransfer(params: {
  wallet: PublicKey
  sendTransaction: (
    transaction: Transaction,
    connection: Connection,
    options?: { skipPreflight?: boolean }
  ) => Promise<string>
  feeLamports: bigint
  network: OwlMintNetwork
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const treasury = getOwlCenterPlatformTreasuryWalletClient()
  if (!treasury) {
    return { ok: false, error: 'Platform treasury not configured on this site.' }
  }
  if (params.feeLamports <= 0n) {
    return { ok: false, error: 'Reveal Day fee is not configured.' }
  }

  try {
    const connection = new Connection(getLaunchSolanaRpcUrl(params.network), 'confirmed')
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: params.wallet })
    tx.add(
      SystemProgram.transfer({
        fromPubkey: params.wallet,
        toPubkey: new PublicKey(treasury),
        lamports: params.feeLamports,
      })
    )
    const signature = await params.sendTransaction(tx, connection)
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    return { ok: true, signature }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Payment failed' }
  }
}
