/**
 * OwlSwap server config surface — dedicated ops wallet + escrow (not raffle / packs / Discord).
 */
import {
  getOwlSwapWalletKeypair,
  getOwlSwapWalletPublicKey,
} from '@/lib/owlswap/owlswap-wallet-keypair'
import {
  getOwlSwapEscrowKeypair,
  getOwlSwapEscrowPublicKey,
} from '@/lib/owlswap/owlswap-escrow-keypair'

export {
  getOwlSwapWalletKeypair,
  getOwlSwapWalletPublicKey,
  getOwlSwapEscrowKeypair,
  getOwlSwapEscrowPublicKey,
}

/** True when both signing keypairs load and match optional *_WALLET checks. */
export function isOwlSwapConfigured(): boolean {
  return getOwlSwapWalletKeypair() !== null && getOwlSwapEscrowKeypair() !== null
}

export type OwlSwapPublicConfig = {
  configured: boolean
  wallet: string | null
  escrow: string | null
}

export function getOwlSwapPublicConfig(): OwlSwapPublicConfig {
  const wallet = getOwlSwapWalletPublicKey()
  const escrow = getOwlSwapEscrowPublicKey()
  return {
    configured: Boolean(wallet && escrow && isOwlSwapConfigured()),
    wallet,
    escrow,
  }
}
