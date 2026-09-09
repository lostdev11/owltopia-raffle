/**
 * Phase 3 gate for exploiting Solana Transaction V1's 4096-byte ceiling.
 *
 * Do NOT raise OwlSend / Nesting / Packs / Gen2 batch product constants until every
 * prerequisite below is true. Sending v1 requires @solana/kit 8+ or web3.js 3.x;
 * web3.js 1.99 is read-only for v1.
 *
 * See https://solana.com/upgrades/larger-transaction-sizes
 */
import {
  OWL_SEND_MAX_PER_TX,
  OWL_SEND_MAX_PER_TX_NFT_ONE,
  OWL_SEND_MAX_PER_TX_NFT_SCATTER,
  OWL_SEND_MAX_SPECIAL_PER_TX,
} from '@/lib/owl-send/constants'
import { OWL_SEND_TX_PACKET_LIMIT, OWL_SEND_TX_SAFE_BYTES } from '@/lib/owl-send/tx-size'
import { PACK_DEPOSIT_MAX_PER_TX } from '@/lib/packs/deposit-nft-batch-plan'
import { NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX } from '@/lib/solana/mpl-core-freeze'

/** Flip only after wallets + Kit send path are proven on Surfpool/devnet. */
export const SOLANA_TX_V1_BATCH_EXPLOIT_ENABLED = false

export type SolanaTxV1BatchPrerequisite = {
  id: string
  ready: boolean
  detail: string
}

/**
 * Checklist for a future PR that raises batch sizes under the 4096-byte v1 limit.
 * Keeping `ready: false` entries is intentional until evidence exists.
 */
export function getSolanaTxV1BatchPrerequisites(): SolanaTxV1BatchPrerequisite[] {
  return [
    {
      id: 'kit_or_web3js3_send',
      ready: false,
      detail:
        'App can build/sign/send v1 via @solana/kit >= 8.0.0 or @solana/web3.js 3.x (1.99 is read-only).',
    },
    {
      id: 'wallet_v1_lighthouse',
      ready: false,
      detail:
        'Phantom / Solflare / Mobile accept v1 and Lighthouse injection stays within the new size budget.',
    },
    {
      id: 'base64_send_encoding',
      ready: false,
      detail: 'Sends >1232 bytes use encoding base64 (base58 stays capped at 1232 regardless of version).',
    },
    {
      id: 'explicit_v1_resource_limits',
      ready: false,
      detail:
        'v1 messages set computeUnitLimit + loadedAccountsDataSizeLimit explicitly; strip no-op ComputeBudget ixs; priority fee is total lamports.',
    },
    {
      id: 'surfpool_rebenchmark',
      ready: false,
      detail:
        'Re-measure OwlSend/Nesting/Packs/Gen2 batches on Surfpool v1.5+ or Agave CLI 4.2+ with Lighthouse headroom.',
    },
  ]
}

/** Current 1232-era product caps — must not drift upward until exploit gate opens. */
export function getSolanaTxV1CurrentBatchCaps() {
  return {
    owlSendPacketLimit: OWL_SEND_TX_PACKET_LIMIT,
    owlSendSafeBytes: OWL_SEND_TX_SAFE_BYTES,
    owlSendMaxPerTx: OWL_SEND_MAX_PER_TX,
    owlSendMaxPerTxNftScatter: OWL_SEND_MAX_PER_TX_NFT_SCATTER,
    owlSendMaxPerTxNftOne: OWL_SEND_MAX_PER_TX_NFT_ONE,
    owlSendMaxSpecialPerTx: OWL_SEND_MAX_SPECIAL_PER_TX,
    packDepositMaxPerTx: PACK_DEPOSIT_MAX_PER_TX,
    nestingMplCoreFreezeWalletBatchMax: NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX,
  } as const
}

export function assertSolanaTxV1BatchExploitStillGated(): void {
  if (SOLANA_TX_V1_BATCH_EXPLOIT_ENABLED) {
    const pending = getSolanaTxV1BatchPrerequisites().filter((p) => !p.ready)
    if (pending.length > 0) {
      throw new Error(
        `SOLANA_TX_V1_BATCH_EXPLOIT_ENABLED is true but prerequisites remain: ${pending
          .map((p) => p.id)
          .join(', ')}`
      )
    }
  }

  const caps = getSolanaTxV1CurrentBatchCaps()
  // Pin today's 1232-era defaults so a premature raise fails CI.
  if (caps.owlSendPacketLimit !== 1232) {
    throw new Error(`Unexpected OWL_SEND_TX_PACKET_LIMIT=${caps.owlSendPacketLimit}; expected 1232 until v1 send lands.`)
  }
  if (caps.owlSendSafeBytes !== 900) {
    throw new Error(`Unexpected OWL_SEND_TX_SAFE_BYTES=${caps.owlSendSafeBytes}; re-benchmark before changing.`)
  }
  if (caps.owlSendMaxPerTxNftScatter !== 3) {
    throw new Error(`Unexpected scatter cap ${caps.owlSendMaxPerTxNftScatter}; keep 3 until v1+Lighthouse evidence.`)
  }
  if (caps.packDepositMaxPerTx !== 3) {
    throw new Error(`Unexpected pack deposit cap ${caps.packDepositMaxPerTx}; keep 3 until v1 send evidence.`)
  }
}
