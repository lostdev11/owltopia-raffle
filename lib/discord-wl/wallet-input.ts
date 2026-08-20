import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

export type DiscordWlWalletParse =
  | { ok: true; wallet: string }
  | { ok: false; code: 'evm' | 'invalid'; message: string }

export const DISCORD_WL_WALLET_INVALID_MESSAGE =
  'That doesn’t look like a Solana wallet. Copy the address from Phantom → Receive (starts with a letter/number, ~32–44 chars).'

export const DISCORD_WL_WALLET_EVM_MESSAGE =
  'That’s an Ethereum-style address. We need your **Solana** wallet from Phantom, Solflare, etc.'

export function parseDiscordWlWalletInput(raw: string | null | undefined): DiscordWlWalletParse {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) {
    return { ok: false, code: 'invalid', message: DISCORD_WL_WALLET_INVALID_MESSAGE }
  }
  if (EVM_ADDRESS_RE.test(t)) {
    return { ok: false, code: 'evm', message: DISCORD_WL_WALLET_EVM_MESSAGE }
  }
  const wallet = normalizeSolanaWalletAddress(t)
  if (!wallet) {
    return { ok: false, code: 'invalid', message: DISCORD_WL_WALLET_INVALID_MESSAGE }
  }
  return { ok: true, wallet }
}

export function formatWalletShort(wallet: string): string {
  const w = wallet.trim()
  if (w.length <= 12) return w
  return `${w.slice(0, 4)}…${w.slice(-4)}`
}
