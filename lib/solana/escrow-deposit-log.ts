/**
 * Client-side logs for prize NFT → escrow transfers. Filter DevTools console by: owltopia:escrow-deposit
 */
const TAG = '[owltopia:escrow-deposit]'

export type EscrowDepositPath =
  | 'mpl_core'
  | 'compressed'
  | 'token_metadata'
  | 'spl_transfer'
  | 'fallback_compressed'
  | 'fallback_mpl_core'

export interface EscrowDepositLogBase {
  /** Raffle id when known */
  raffleId?: string
  raffleSlug?: string
  /** Community pool giveaway id when deposit is for that flow */
  communityGiveawayId?: string
  /** Prize mint from raffle record */
  nftMint: string
  /** Asset id used for Core / compressed (may match mint) */
  transferAssetId: string
  escrowAddress: string
  fromWallet: string
}

function emit(
  phase: 'start' | 'path' | 'signed' | 'verify_ok' | 'verify_fail' | 'abort' | 'error',
  payload: Record<string, unknown>
) {
  const line = { phase, ts: new Date().toISOString(), ...payload }
  try {
    // One string so DevTools / Edge don’t collapse the payload as a generic "Object" in the console stream.
    console.info(`${TAG} ${JSON.stringify(line)}`)
  } catch {
    console.info(TAG, line)
  }
}

export function logEscrowDepositStart(
  ctx: EscrowDepositLogBase & {
    dbPrizeStandard?: string | null
    /** e.g. NFT name from wallet list or raffle title for context */
    displayLabel?: string | null
  }
) {
  emit('start', {
    raffleId: ctx.raffleId,
    raffleSlug: ctx.raffleSlug,
    communityGiveawayId: ctx.communityGiveawayId,
    nftMint: ctx.nftMint,
    transferAssetId: ctx.transferAssetId,
    escrowAddress: ctx.escrowAddress,
    fromWallet: ctx.fromWallet,
    dbPrizeStandard: ctx.dbPrizeStandard ?? undefined,
    displayLabel: ctx.displayLabel ?? undefined,
    message: 'Sending NFT to prize escrow',
  })
}

export function logEscrowDepositPath(
  ctx: EscrowDepositLogBase,
  path: EscrowDepositPath,
  extra?: Record<string, unknown>
) {
  emit('path', {
    raffleId: ctx.raffleId,
    raffleSlug: ctx.raffleSlug,
    communityGiveawayId: ctx.communityGiveawayId,
    nftMint: ctx.nftMint,
    transferAssetId: ctx.transferAssetId,
    escrowAddress: ctx.escrowAddress,
    fromWallet: ctx.fromWallet,
    path,
    ...extra,
  })
}

export function logEscrowDepositSigned(
  ctx: EscrowDepositLogBase,
  path: EscrowDepositPath,
  signature: string
) {
  emit('signed', {
    raffleId: ctx.raffleId,
    raffleSlug: ctx.raffleSlug,
    communityGiveawayId: ctx.communityGiveawayId,
    nftMint: ctx.nftMint,
    transferAssetId: ctx.transferAssetId,
    escrowAddress: ctx.escrowAddress,
    fromWallet: ctx.fromWallet,
    path,
    signature,
    message: 'Transfer tx signed / confirmed; NFT should move to escrow',
  })
}

export function logEscrowDepositVerify(
  ctx: EscrowDepositLogBase,
  ok: boolean,
  detail?: string
) {
  emit(ok ? 'verify_ok' : 'verify_fail', {
    raffleId: ctx.raffleId,
    raffleSlug: ctx.raffleSlug,
    communityGiveawayId: ctx.communityGiveawayId,
    nftMint: ctx.nftMint,
    escrowAddress: ctx.escrowAddress,
    detail,
  })
}

export function logEscrowDepositAbort(
  ctx: Partial<EscrowDepositLogBase> & { nftMint?: string; escrowAddress?: string; fromWallet?: string },
  reason: string,
  extra?: Record<string, unknown>
) {
  emit('abort', {
    ...ctx,
    reason,
    ...extra,
  })
}

export function logEscrowDepositError(
  ctx: Partial<EscrowDepositLogBase>,
  err: unknown,
  path?: EscrowDepositPath
) {
  const message = err instanceof Error ? err.message : String(err)
  emit('error', {
    raffleId: ctx.raffleId,
    raffleSlug: ctx.raffleSlug,
    communityGiveawayId: ctx.communityGiveawayId,
    nftMint: ctx.nftMint,
    transferAssetId: ctx.transferAssetId,
    escrowAddress: ctx.escrowAddress,
    fromWallet: ctx.fromWallet,
    path,
    error: message,
  })
}
