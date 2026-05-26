import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

/** Persist acknowledgment per wallet for this browsing session only (not durable consent). */
export const NESTING_SECURITY_ACK_STORAGE_KEY = 'owl_nesting_security_ack_v2'

/** Text the wallet signs when acknowledging nesting safeguards (must match server-built messages). */
export const NESTING_SECURITY_ACK_STATEMENT =
  'I have read the nesting safeguards. I understand some perches record my nest inside Owltopia until that perch upgrades to fuller wallet-held on-chain locks.'

/** Accuracy checked against staking APIs / auth (`lib/auth-server`) / `lib/nesting/service.ts`; wording is plain-language only. */
export const NESTING_SECURITY_BULLETS: readonly string[] = [
  'You approve one short sign-in message so we know it is your wallet—we never touch seed phrases or private keys.',
  'Whatever wallet stays connected must match what you signed in with, so nests never hop to the wrong person.',
  'Nesting moves run through Owltopia’s servers after safety checks—we do not expose direct database taps from your browser.',
  'For freeze-backed Owl Nest NFT perches, the NFT stays in your wallet but cannot transfer while it is frozen.',
  'Every tap double-checks perch rules, IDs, amounts, and that the nest belongs to you before anything changes.',
  'OWL reward claims are delivered on-chain from the platform reward treasury when it is configured and funded; otherwise only your in-app totals update.',
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
