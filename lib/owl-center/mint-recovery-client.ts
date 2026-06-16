import {
  detectPlannedMintAccounts,
  findRecentCandyMachineMintSignature,
  recoverRecentCandyMachineMintForWallet,
  type RecoveredCandyMachineMint,
} from '@/lib/solana/recover-candy-machine-mint'
import { getLaunchSolanaRpcUrl } from '@/lib/solana/launch-cm'
import type { OwlMintNetwork } from '@/lib/solana/network'

export type OwlCenterMintRecoveryParams = {
  walletB58: string
  candyMachineB58: string
  mintNetwork: OwlMintNetwork
  plannedMintB58s?: string[]
}

/** Scan on-chain state after Phantom/Solflare disconnects mid-mint. */
export async function attemptOwlCenterMintRecovery(
  params: OwlCenterMintRecoveryParams
): Promise<RecoveredCandyMachineMint | null> {
  const rpcUrl = getLaunchSolanaRpcUrl(params.mintNetwork)
  const planned = params.plannedMintB58s?.filter(Boolean) ?? []

  if (planned.length > 0) {
    const onChain = await detectPlannedMintAccounts(rpcUrl, planned, { attempts: 6, delayMs: 1500 })
    if (onChain.length > 0) {
      const sig = await findRecentCandyMachineMintSignature(
        rpcUrl,
        params.walletB58,
        params.candyMachineB58,
        onChain
      )
      if (sig) return { txSignatures: [sig], mintedNftMints: onChain }
    }
  }

  return recoverRecentCandyMachineMintForWallet({
    rpcUrl,
    walletB58: params.walletB58,
    candyMachineB58: params.candyMachineB58,
  })
}

export function isLikelyWalletMintDisconnectError(message: string): boolean {
  const low = message.toLowerCase()
  if (low.includes('user rejected') || low.includes('cancel')) return false
  return (
    low.includes('simulation failed') ||
    low.includes('wallet reported an error') ||
    low.includes('could not reach solana') ||
    low.includes('blockhash') ||
    low.includes('block height') ||
    low.includes('expired') ||
    low.includes('failed to fetch') ||
    low.includes('confirm_failed') ||
    low.includes('mint could not be simulated')
  )
}
