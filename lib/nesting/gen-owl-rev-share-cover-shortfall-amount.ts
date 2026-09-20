/** Pure helpers for Gen Owl rev-share coverage top-ups (no Solana RPC imports). */

const LAMPORTS_PER_SOL = 1_000_000_000

/** Small extra so fee-reserve rounding does not leave the gate 1 lamport short. */
export const GEN_OWL_REV_SHARE_COVER_SHORTFALL_BUFFER_SOL = 0.001

export function suggestedGenOwlRevShareCoverShortfallSol(shortfallSol: number): number {
  const short = Math.max(0, Number(shortfallSol) || 0)
  if (short <= 0) return 0
  const withBuffer = short + GEN_OWL_REV_SHARE_COVER_SHORTFALL_BUFFER_SOL
  // Round up to lamports so the on-chain transfer meets the gate.
  return Math.ceil(withBuffer * LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL
}
