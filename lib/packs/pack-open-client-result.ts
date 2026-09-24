import type { PackOpenClientResult } from '@/lib/client/execute-pack-purchase'
import { packRevealMessage } from '@/lib/packs/reveal-message'

/** Map public verify API JSON into client reveal state (refresh / deep link). */
export function packOpenVerifyJsonToClientResult(
  json: Record<string, unknown>
): PackOpenClientResult | null {
  const id = typeof json.id === 'string' ? json.id : ''
  const status = typeof json.status === 'string' ? json.status : ''
  const category = typeof json.category === 'string' ? json.category : ''
  if (!id || status !== 'completed' || !category) return null

  const prizeLabel =
    typeof json.prizeLabel === 'string' && json.prizeLabel.trim()
      ? json.prizeLabel
      : 'Prize'
  const isJackpotWin = json.isJackpotWin === true

  return {
    openId: id,
    category,
    prizeLabel,
    owlAmount: typeof json.owlAmount === 'number' ? json.owlAmount : null,
    solAmount: typeof json.solAmount === 'number' ? json.solAmount : null,
    nftMint: typeof json.nftMint === 'string' ? json.nftMint : null,
    nftName: typeof json.nftName === 'string' ? json.nftName : null,
    nftImageUrl: typeof json.nftImageUrl === 'string' ? json.nftImageUrl : null,
    freeTicketCredits:
      typeof json.freeTicketCredits === 'number' ? json.freeTicketCredits : 0,
    payoutSignature:
      typeof json.payoutSignature === 'string' ? json.payoutSignature : null,
    openSeed: typeof json.openSeed === 'string' ? json.openSeed : '',
    openCommitHash:
      typeof json.openCommitHash === 'string' ? json.openCommitHash : '',
    revealMessage:
      typeof json.revealMessage === 'string' && json.revealMessage.trim()
        ? json.revealMessage
        : packRevealMessage({ category, prizeLabel, isJackpotWin }),
    isJackpotWin,
    jackpotAmountSol:
      typeof json.jackpotAmountSol === 'number' ? json.jackpotAmountSol : null,
    jackpotPoolSol: null,
  }
}
