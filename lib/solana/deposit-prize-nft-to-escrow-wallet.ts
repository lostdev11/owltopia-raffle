/**
 * Shared client flow: send selected wallet NFT to prize escrow (same paths as raffle creation).
 */
import { PublicKey, Transaction } from '@solana/web3.js'
import type { Connection } from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import {
  logEscrowDepositAbort,
  logEscrowDepositPath,
  logEscrowDepositSigned,
  logEscrowDepositStart,
  type EscrowDepositLogBase,
} from '@/lib/solana/escrow-deposit-log'
import { transferCompressedNftToEscrow } from '@/lib/solana/cnft-transfer'
import { transferMplCoreToEscrow } from '@/lib/solana/mpl-core-transfer'
import {
  isMplCoreNoApprovalsError,
  mplCoreNoApprovalsEscrowMessage,
} from '@/lib/solana/mpl-core-transfer-errors'
import { transferTokenMetadataNftToEscrow } from '@/lib/solana/token-metadata-transfer'
import { HOLDER_LOOKUP_MAX_ATTEMPTS } from '@/lib/solana/holder-lookup-retries'
import { getNftHolderInWallet, type NftHolderInWallet, type WalletNft } from '@/lib/solana/wallet-tokens'

export type SendTxFn = (
  transaction: Transaction,
  connection: Connection,
  options?: { skipPreflight?: boolean; preflightCommitment?: 'processed' | 'confirmed' | 'finalized'; maxRetries?: number }
) => Promise<string>

export type DepositPrizeNftToEscrowWalletParams = {
  connection: Connection
  publicKey: PublicKey
  sendTransaction: SendTxFn | undefined
  walletAdapter: WalletAdapter | null
  selectedNft: WalletNft
  /** Mint stored on giveaway/raffle (usually same as selectedNft.mint) */
  prizeMintAddress: string
  escrowAddress: string
  logCtx: EscrowDepositLogBase
}

export type DepositPrizeNftToEscrowWalletResult =
  | { ok: true; signature: string }
  | { ok: false; error: string; mplCoreNoApprovalsMintShort?: string; fullAssetId?: string }

export async function depositPrizeNftToEscrowFromWallet(
  params: DepositPrizeNftToEscrowWalletParams
): Promise<DepositPrizeNftToEscrowWalletResult> {
  const {
    connection,
    publicKey,
    sendTransaction,
    walletAdapter,
    selectedNft,
    prizeMintAddress,
    escrowAddress,
    logCtx,
  } = params

  const mintPk = new PublicKey(prizeMintAddress.trim())
  const escrowPubkey = new PublicKey(escrowAddress)

  logEscrowDepositStart({
    ...logCtx,
    dbPrizeStandard: null,
    displayLabel: selectedNft.name,
  })

  let resolvedHolder: NftHolderInWallet | null = null
  if (selectedNft?.tokenAccount) {
    try {
      const selectedTokenAccount = new PublicKey(selectedNft.tokenAccount)
      const selectedInfo = await connection.getParsedAccountInfo(selectedTokenAccount, 'processed')
      const ownerProgram = selectedInfo.value?.owner
      const isSplProgram = ownerProgram?.equals(TOKEN_PROGRAM_ID) ?? false
      const isToken2022 = ownerProgram?.equals(TOKEN_2022_PROGRAM_ID) ?? false
      const info = (selectedInfo.value?.data as { parsed?: { info?: Record<string, unknown> } } | undefined)?.parsed
        ?.info
      const selectedMint = typeof info?.mint === 'string' ? info.mint : null
      const amountRaw =
        typeof info?.tokenAmount === 'object' && info?.tokenAmount
          ? (info.tokenAmount as { amount?: unknown }).amount
          : undefined
      const amount =
        typeof amountRaw === 'string' ? Number(amountRaw) : typeof amountRaw === 'number' ? amountRaw : 0
      const delegate = typeof info?.delegate === 'string' ? info.delegate : null
      if (selectedMint === mintPk.toBase58() && amount >= 1 && !delegate) {
        if (isSplProgram) {
          resolvedHolder = { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: selectedTokenAccount }
        } else if (isToken2022) {
          resolvedHolder = { tokenProgram: TOKEN_2022_PROGRAM_ID, tokenAccount: selectedTokenAccount }
        }
      }
    } catch {
      // Fall through to holder lookup retries.
    }
  }

  for (let attempt = 0; attempt < HOLDER_LOOKUP_MAX_ATTEMPTS; attempt++) {
    if (resolvedHolder) break
    const h = await getNftHolderInWallet(connection, mintPk, publicKey, 'processed')
    if (h && 'delegated' in h && h.delegated) {
      return { ok: false, error: 'This NFT is staked or delegated. Unstake it before sending to escrow.' }
    }
    if (h && 'tokenProgram' in h && 'tokenAccount' in h) {
      resolvedHolder = h
      break
    }
    if (attempt < HOLDER_LOOKUP_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 700))
    }
  }

  let depositSig: string | null = null
  let lastMplCoreEscrowError: string | null = null

  if (resolvedHolder) {
    const { tokenProgram, tokenAccount: sourceTokenAccount } = resolvedHolder
    if (walletAdapter && tokenProgram.equals(TOKEN_PROGRAM_ID)) {
      try {
        logEscrowDepositPath(logCtx, 'token_metadata')
        depositSig = await transferTokenMetadataNftToEscrow({
          connection,
          wallet: walletAdapter,
          mintAddress: prizeMintAddress.trim(),
          escrowAddress,
        })
        logEscrowDepositSigned(logCtx, 'token_metadata', depositSig)
      } catch (tmErr) {
        logEscrowDepositAbort(logCtx, 'token_metadata_failed_trying_spl', {
          detail: tmErr instanceof Error ? tmErr.message : String(tmErr),
        })
        depositSig = null
      }
    }
    if (!depositSig) {
      if (!sendTransaction) {
        logEscrowDepositAbort(logCtx, 'no_send_transaction_after_token_metadata')
        return {
          ok: false,
          error:
            'Your wallet did not expose a transaction sender. Try another wallet or send the NFT manually and verify.',
        }
      }
      const escrowAta = await getAssociatedTokenAddress(
        mintPk,
        escrowPubkey,
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const tx = new Transaction()
      try {
        await getAccount(connection, escrowAta, 'confirmed', tokenProgram)
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            escrowAta,
            escrowPubkey,
            mintPk,
            tokenProgram,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        )
      }
      tx.add(
        createTransferInstruction(sourceTokenAccount, escrowAta, publicKey, 1n, [], tokenProgram)
      )
      logEscrowDepositPath(logCtx, 'spl_transfer', {
        tokenProgram: tokenProgram.toBase58(),
        sourceTokenAccount: sourceTokenAccount.toBase58(),
        escrowAta: escrowAta.toBase58(),
      })
      depositSig = await sendTransaction(tx, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })
      await confirmSignatureSuccessOnChain(connection, depositSig)
      logEscrowDepositSigned(logCtx, 'spl_transfer', depositSig)
    }
  } else if (walletAdapter) {
    try {
      logEscrowDepositPath(logCtx, 'fallback_compressed', { note: 'No SPL holder resolved; trying compressed' })
      depositSig = await transferCompressedNftToEscrow({
        connection,
        wallet: walletAdapter,
        assetId: selectedNft.mint,
        escrowAddress,
      })
      logEscrowDepositSigned(logCtx, 'fallback_compressed', depositSig)
    } catch (cErr) {
      logEscrowDepositAbort(logCtx, 'fallback_compressed_failed', {
        detail: cErr instanceof Error ? cErr.message : String(cErr),
      })
      depositSig = null
    }
    if (!depositSig) {
      try {
        logEscrowDepositPath(logCtx, 'fallback_mpl_core')
        depositSig = await transferMplCoreToEscrow({
          connection,
          wallet: walletAdapter,
          assetId: selectedNft.mint,
          escrowAddress,
        })
        logEscrowDepositSigned(logCtx, 'fallback_mpl_core', depositSig)
      } catch (coreErr) {
        const coreMsg = coreErr instanceof Error ? coreErr.message : String(coreErr)
        lastMplCoreEscrowError = coreMsg
        logEscrowDepositAbort(logCtx, 'fallback_mpl_core_failed', { detail: coreMsg })
        depositSig = null
      }
    }
    if (!depositSig) {
      logEscrowDepositAbort(logCtx, 'no_path_deposit_prize_nft')
      const mintShort =
        selectedNft.mint.length > 16
          ? `${selectedNft.mint.slice(0, 4)}…${selectedNft.mint.slice(-4)}`
          : selectedNft.mint
      if (lastMplCoreEscrowError && isMplCoreNoApprovalsError(lastMplCoreEscrowError)) {
        return {
          ok: false,
          error: mplCoreNoApprovalsEscrowMessage(mintShort, { fullAssetId: selectedNft.mint }),
          mplCoreNoApprovalsMintShort: mintShort,
          fullAssetId: selectedNft.mint,
        }
      }
      return {
        ok: false,
        error:
          'Could not send this NFT to escrow (tried Metaplex token metadata, SPL, compressed, and Core). Check Wi‑Fi / RPC or deposit manually.',
      }
    }
  } else {
    logEscrowDepositAbort(logCtx, 'no_wallet_adapter_for_core_compressed')
    return {
      ok: false,
      error:
        'Could not confirm this NFT as SPL in your wallet yet, and the wallet adapter is not ready for Core/compressed transfers.',
    }
  }

  return { ok: true, signature: depositSig }
}
