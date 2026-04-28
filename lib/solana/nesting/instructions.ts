import { type PublicKey, type TransactionInstruction } from '@solana/web3.js'

/**
 * Instruction builders for future Owl Nesting staking program.
 * Returns empty / noop stubs so adapters can be typed without a deployed program.
 *
 * When the program is ready, replace with Anchor/Codama-generated `program.methods.stake(...).instruction()`.
 */

const STUB_ERR = 'Owl Nesting on-chain program not deployed — use mock or solana_ready (DB) pools.'

export class NestingProgramNotDeployedError extends Error {
  constructor(message = STUB_ERR) {
    super(message)
    this.name = 'NestingProgramNotDeployedError'
  }
}

/**
 * @throws NestingProgramNotDeployedError — use only after program exists, or in tests with mocks.
 */
export function buildNestingStakeInstructionStub(_params: {
  poolState: PublicKey
  user: PublicKey
}): TransactionInstruction {
  throw new NestingProgramNotDeployedError()
}

export { STUB_ERR as NESTING_PROGRAM_STUB_MSG }
