/** Default on-chain guards for Owl Center public_simple collections (free mint + site-side limits). */
export function publicSimpleSugarGuardsConfig() {
  return {
    default: {
      botTax: {
        value: 0.001,
        lastInstruction: false,
      },
    },
  } as const
}

/** Metaplex UMI guard set for createCandyGuard (bot tax only). */
export function publicSimpleCandyGuardGuards() {
  return {
    botTax: {
      lamports: 1_000_000n,
      lastInstruction: false,
    },
  } as const
}
