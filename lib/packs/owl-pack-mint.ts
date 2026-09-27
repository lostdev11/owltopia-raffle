import { TOKEN_PROGRAM_ID } from '@solana/spl-token'

/** Mainnet $OWL mint — classic SPL token, 6 decimals (no per-payout RPC mint fetch). */
export const PACK_OWL_MINT_ADDRESS = 'JA2gZuhy83CD71xQNMJCMHvTvhxFnVFerw5dYiyFkAfM'
export const PACK_OWL_DECIMALS = 6
export const PACK_OWL_TOKEN_PROGRAM = TOKEN_PROGRAM_ID

export function isPackOwlMintAddress(mintB58: string): boolean {
  return mintB58.trim() === PACK_OWL_MINT_ADDRESS
}
