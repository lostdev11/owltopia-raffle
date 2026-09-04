import { isTransientSolanaRpcError } from '@/lib/solana/rpc-retry'

/** True when Core/UMI account reads failed due to flaky browser RPC (screenshot NetworkError). */
export function isOwlSendRpcNetworkError(message: string): boolean {
  return (
    isTransientSolanaRpcError(message) ||
    /networkerror|failed to fetch|failed to get info about account/i.test(message)
  )
}
