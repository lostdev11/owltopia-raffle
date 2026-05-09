import { BorshAccountsCoder, BorshInstructionCoder, type Idl } from '@coral-xyz/anchor'
import rawIdl from '@/lib/governance/owltopia_governance.json'

const idl = rawIdl as Idl

export const governanceInstructionCoder = new BorshInstructionCoder(idl)
export const governanceAccountCoder = new BorshAccountsCoder(idl)
export { idl as governanceIdl }
