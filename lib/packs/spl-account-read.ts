import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  getAccount,
  type Account,
} from '@solana/spl-token'
import type { Connection, PublicKey } from '@solana/web3.js'
import { withPackSolanaRpcRetry } from '@/lib/packs/rpc-retry'

export function isSplTokenAccountMissingError(error: unknown): boolean {
  return error instanceof TokenAccountNotFoundError
}

/** Read a token account; rethrows RPC errors (never treat as missing). */
export async function readTokenAccountOrThrow(
  connection: Connection,
  address: PublicKey,
  programId: typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID
): Promise<Account> {
  return withPackSolanaRpcRetry(() =>
    getAccount(connection, address, 'confirmed', programId)
  )
}
