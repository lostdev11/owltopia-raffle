import type { Context, TransactionBuilder } from '@metaplex-foundation/umi'
import { lamports, publicKey } from '@metaplex-foundation/umi'
import { transferSol } from '@metaplex-foundation/mpl-toolbox'

export type StakingPlatformFeeUmiTransfer = {
  treasury: string
  lamports: number
}

/** Append nesting platform fee SOL transfer to a UMI transaction (same wallet approval as nest lock). */
export function appendStakingPlatformFeeToUmiBuilder(
  umi: Pick<Context, 'identity' | 'programs'>,
  builder: TransactionBuilder,
  fee: StakingPlatformFeeUmiTransfer | null | undefined
): TransactionBuilder {
  if (!fee || fee.lamports <= 0 || !fee.treasury.trim()) return builder
  return builder.add(
    transferSol(umi, {
      destination: publicKey(fee.treasury.trim()),
      amount: lamports(fee.lamports),
    })
  )
}
