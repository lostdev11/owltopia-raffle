import {
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type PublicKey as PublicKeyType,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import type { RaffleMilestone } from '@/lib/types'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { getTokenInfo } from '@/lib/tokens'
import {
  pendingCryptoMilestonesForCreate,
  sumMilestoneDepositsByCurrency,
  type MilestoneDepositCurrency,
} from '@/lib/raffles/milestones/create-deposit-totals'

export { pendingCryptoMilestonesForCreate, sumMilestoneDepositsByCurrency }

/** Append SOL bonus milestone transfer(s) to an existing transaction (e.g. SPL NFT deposit). */
export async function appendSolMilestoneTransfersToTransaction(
  tx: Transaction,
  publicKey: PublicKeyType,
  milestones: RaffleMilestone[]
): Promise<{ amount: number } | null> {
  const amount = milestoneDepositTotalForPrizeCurrency(milestones, 'SOL')
  if (amount <= 0) return null
  const fundsEscrowAddress = await fetchFundsEscrowAddress()
  if (!fundsEscrowAddress) return null
  tx.add(
    SystemProgram.transfer({
      fromPubkey: publicKey,
      toPubkey: new PublicKey(fundsEscrowAddress),
      lamports: Math.round(amount * 1e9),
    })
  )
  return { amount }
}

export async function fetchFundsEscrowAddress(): Promise<string | null> {
  const res = await fetch('/api/config/funds-escrow', { credentials: 'include' })
  const data = (await res.json().catch(() => ({}))) as { address?: string; error?: string }
  if (!res.ok || typeof data.address !== 'string' || !data.address.trim()) return null
  return data.address.trim()
}

export async function sendMilestoneDepositTransaction(params: {
  connection: Connection
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>
  publicKey: PublicKeyType
  currency: MilestoneDepositCurrency
  amount: number
  fundsEscrowAddress: string
}): Promise<string> {
  const { connection, sendTransaction, publicKey, currency, amount, fundsEscrowAddress } = params
  const escrowPk = new PublicKey(fundsEscrowAddress)
  if (currency === 'SOL') {
    const lamports = Math.round(amount * 1e9)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: escrowPk,
        lamports,
      })
    )
    const sig = await sendTransaction(tx, connection)
    await confirmSignatureSuccessOnChain(connection, sig)
    return sig
  }

  const tokenInfo = getTokenInfo('USDC')
  if (!tokenInfo.mintAddress) {
    throw new Error('USDC is not configured.')
  }
  const mint = new PublicKey(tokenInfo.mintAddress)
  const decimals = tokenInfo.decimals
  const raw = BigInt(Math.round(amount * Math.pow(10, decimals)))
  const fromAta = await getAssociatedTokenAddress(
    mint,
    publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const toAta = await getAssociatedTokenAddress(
    mint,
    escrowPk,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const tx = new Transaction()
  try {
    await getAccount(connection, toAta, 'confirmed', TOKEN_PROGRAM_ID)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        publicKey,
        toAta,
        escrowPk,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(createTransferInstruction(fromAta, toAta, publicKey, raw, [], TOKEN_PROGRAM_ID))
  const sig = await sendTransaction(tx, connection)
  await confirmSignatureSuccessOnChain(connection, sig)
  return sig
}

export function milestoneDepositTotalForPrizeCurrency(
  milestones: RaffleMilestone[],
  prizeCurrency: string
): number {
  const cur = prizeCurrency.trim().toUpperCase()
  if (cur !== 'SOL' && cur !== 'USDC') return 0
  const pending = pendingCryptoMilestonesForCreate(milestones).filter((m) => m.prize_currency === cur)
  const totals = sumMilestoneDepositsByCurrency(pending)
  return totals[cur as MilestoneDepositCurrency] ?? 0
}

export async function verifyCreateMilestoneDepositsFromClient(params: {
  raffleId: string
  depositTx: string
  currency: MilestoneDepositCurrency
}): Promise<{ ok: boolean; error?: string; published?: boolean }> {
  const res = await fetch(`/api/raffles/${params.raffleId}/milestones/verify-create-deposits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ deposit_tx: params.depositTx, currency: params.currency }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    error?: string
    published?: boolean
  }
  if (!res.ok) {
    return { ok: false, error: typeof json.error === 'string' ? json.error : 'Milestone verification failed' }
  }
  return { ok: true, published: json.published === true }
}
