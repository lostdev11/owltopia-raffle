import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

/** Persist acknowledgment per wallet for this browsing session only (not durable consent). */
export const NESTING_SECURITY_ACK_STORAGE_KEY = 'owl_nesting_security_ack_v3'

/** Text the wallet signs when acknowledging nesting safeguards (must match server-built messages). */
export const NESTING_SECURITY_ACK_STATEMENT =
  'I have read the nesting notes. I understand some perches record my nest inside Owltopia until that perch upgrades to fuller wallet-held on-chain locks.'

import { NESTING_NFT_WALLET_HELD_LOCK_LINE } from '@/lib/nesting/gen-owl-staking-groups'

/** Accuracy checked against staking APIs / auth (`lib/auth-server`) / `lib/nesting/service.ts`; wording is plain-language only. */
export const NESTING_SECURITY_BULLETS: readonly string[] = [
  'One short “hey, it’s you” signature unlocks nesting — we never ask for seed phrases or private keys.',
  'The connected wallet must match the one you signed with, so nests stay on the right account.',
  'Nest moves go through Owltopia after safety checks — your browser never gets a direct database tap.',
  `For NFT nest perches (Owltopia Coins, Gen 1, Gen 2, and partner collections): ${NESTING_NFT_WALLET_HELD_LOCK_LINE}`,
  'Some wallets (especially Jupiter) make the nest lock look scarier than it is. Phantom and Solflare usually show clearer wording — same safe freeze, NFT stays in your wallet.',
  'Every tap re-checks perch rules, IDs, amounts, and that the nest belongs to you before anything changes.',
  'OWL claims pay out on-chain from the reward treasury when it is funded; otherwise only your in-app totals update.',
]

export function readNestingSecurityAckWallet(): string | null {
  try {
    const raw = sessionStorage.getItem(NESTING_SECURITY_ACK_STORAGE_KEY)
    if (!raw) return null
    return normalizeSolanaWalletAddress(raw)
  } catch {
    return null
  }
}

export function writeNestingSecurityAckWallet(wallet: string): void {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) return
  try {
    sessionStorage.setItem(NESTING_SECURITY_ACK_STORAGE_KEY, normalized)
  } catch {
    /* private mode / storage full */
  }
}
