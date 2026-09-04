/**
 * Re-export boundary for Metaplex Core Candy Machine (MPL Core assets).
 *
 * Peer deps:
 * - @metaplex-foundation/umi
 * - @metaplex-foundation/mpl-core-candy-machine
 * - @metaplex-foundation/mpl-core
 *
 * Keep Token Metadata CM V3 imports in `candy-machine-v3.ts` — do not mix here.
 */
export {
  mplCandyMachine as mplCoreCandyMachine,
  mintV1,
  create,
  addConfigLines,
  fetchCandyMachine,
  findCandyGuardPda,
  wrap,
  createCandyGuard,
  safeFetchCandyGuard,
  updateCandyGuard,
  MPL_CORE_CANDY_GUARD_PROGRAM_ID,
  MPL_CORE_CANDY_MACHINE_CORE_PROGRAM_ID,
} from '@metaplex-foundation/mpl-core-candy-machine'
export type { MintV1InstructionAccounts } from '@metaplex-foundation/mpl-core-candy-machine'
