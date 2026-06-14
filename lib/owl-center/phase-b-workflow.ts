/** Operator-recommended hybrid path: one Arweave upload in-app, then Sugar deploy only. */
export const PHASE_B_RECOMMENDED_STEPS = [
  'Creator: Generator → export full supply → Stage for launch → Submit launch.',
  'Admin: Stage/validate ZIP here (or use generator-linked job) — do not also run sugar upload on the same files.',
  'Admin: Push to Arweave once via Irys (fund IRYS_PRIVATE_KEY wallet; see estimate below).',
  'Admin: Deploy CM + Candy Guard (one-click below, or npm run sugar:deploy for large collections).',
  'Smoke mint on devnet, then mainnet.',
] as const

export function formatPhaseBWorkflowSteps(): string {
  return PHASE_B_RECOMMENDED_STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')
}
