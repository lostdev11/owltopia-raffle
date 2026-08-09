/**
 * Shared non-SPL escrow deposit attempts (Token Metadata → compressed → Core, ordered by DAS hints).
 */
import type { Connection } from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import {
  logEscrowDepositAbort,
  logEscrowDepositPath,
  logEscrowDepositSigned,
  type EscrowDepositLogBase,
  type EscrowDepositPath,
} from '@/lib/solana/escrow-deposit-log'
import { transferCompressedNftToEscrow } from '@/lib/solana/cnft-transfer'
import { transferMplCoreToEscrow } from '@/lib/solana/mpl-core-transfer'
import {
  isMplCoreNoApprovalsError,
  isMplCoreWrongAccountTypeError,
  sanitizeEscrowTransferFallbackError,
} from '@/lib/solana/mpl-core-transfer-errors'
import { orderedEscrowFallbacks, type EscrowFallbackKind } from '@/lib/solana/prize-nft-standard'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { transferTokenMetadataNftToEscrow } from '@/lib/solana/token-metadata-transfer'

export type TryEscrowDepositFallbacksParams = {
  connection: Connection
  wallet: WalletAdapter | any
  assetId: string
  escrowAddress: string
  sendTransaction?: WalletSendTransactionFn
  solMilestoneLamports?: number
  fundsEscrowAddress?: string
  logCtx: EscrowDepositLogBase
  dasInterface?: string | null
  compressedHint?: boolean | null
  /** When SPL holder path already tried Token Metadata. */
  skipTokenMetadata?: boolean
}

export type TryEscrowDepositFallbacksResult =
  | { ok: true; signature: string; path: EscrowDepositPath }
  | {
      ok: false
      lastError: string | null
      /** Sanitized for UI; Core wrong-type noise collapsed. */
      displayError: string | null
      mplCoreNoApprovals: boolean
    }

function pathForKind(kind: EscrowFallbackKind): EscrowDepositPath {
  switch (kind) {
    case 'token_metadata':
      return 'fallback_token_metadata'
    case 'compressed':
      return 'fallback_compressed'
    case 'mpl_core':
      return 'fallback_mpl_core'
  }
}

/**
 * Attempt Token Metadata / compressed / Core transfers when no SPL token account was resolved.
 */
export async function tryEscrowDepositFallbacks(
  params: TryEscrowDepositFallbacksParams
): Promise<TryEscrowDepositFallbacksResult> {
  const {
    connection,
    wallet,
    assetId,
    escrowAddress,
    sendTransaction,
    solMilestoneLamports,
    fundsEscrowAddress,
    logCtx,
    dasInterface,
    compressedHint,
    skipTokenMetadata,
  } = params

  const umiExtra = {
    ...(solMilestoneLamports && fundsEscrowAddress
      ? { solMilestoneLamports, fundsEscrowAddress }
      : {}),
    sendTransaction,
  }

  const order = orderedEscrowFallbacks({
    interface: dasInterface,
    compressed: compressedHint,
    skipTokenMetadata,
  })

  let lastError: string | null = null

  for (const kind of order) {
    const path = pathForKind(kind)
    try {
      logEscrowDepositPath(logCtx, path, {
        note: `No SPL holder resolved; trying ${kind}`,
        dasInterface: dasInterface ?? undefined,
        compressedHint: compressedHint ?? undefined,
      })
      let signature: string
      if (kind === 'token_metadata') {
        signature = await transferTokenMetadataNftToEscrow({
          connection,
          wallet,
          mintAddress: assetId,
          escrowAddress,
          ...umiExtra,
        })
      } else if (kind === 'compressed') {
        signature = await transferCompressedNftToEscrow({
          connection,
          wallet,
          assetId,
          escrowAddress,
          ...umiExtra,
        })
      } else {
        signature = await transferMplCoreToEscrow({
          connection,
          wallet,
          assetId,
          escrowAddress,
          ...umiExtra,
        })
      }
      logEscrowDepositSigned(logCtx, path, signature)
      return { ok: true, signature, path }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Wrong-account-type Core errors are expected when probing non-Core mints — keep probing.
      if (!(kind === 'mpl_core' && isMplCoreWrongAccountTypeError(msg))) {
        lastError = msg
      } else if (!lastError) {
        lastError = msg
      }
      logEscrowDepositAbort(logCtx, `${path}_failed`, {
        detail: msg,
        wrongAccountType:
          kind === 'mpl_core' && isMplCoreWrongAccountTypeError(msg) ? true : undefined,
      })
    }
  }

  const displayError = lastError ? sanitizeEscrowTransferFallbackError(lastError) : null
  return {
    ok: false,
    lastError,
    displayError,
    mplCoreNoApprovals: Boolean(lastError && isMplCoreNoApprovalsError(lastError)),
  }
}
