export type MintUiStep =
  | 'idle'
  | 'checking_eligibility'
  | 'preparing_mint'
  | 'awaiting_signature'
  | 'sending_transaction'
  | 'confirming_transaction'
  | 'recording_mint'
  | 'success'
  | 'error'

export type MintProgressSnapshot = {
  current: number
  total: number
  phase: 'chain' | 'record'
}

export function isMintInProgress(step: MintUiStep): boolean {
  return (
    step === 'checking_eligibility' ||
    step === 'preparing_mint' ||
    step === 'awaiting_signature' ||
    step === 'sending_transaction' ||
    step === 'confirming_transaction' ||
    step === 'recording_mint'
  )
}

export function mintProgressHeading(
  step: MintUiStep,
  progress: MintProgressSnapshot | null
): string {
  if (step === 'recording_mint') {
    if (progress && progress.total > 1) {
      return `Saving mint ${progress.current} of ${progress.total}…`
    }
    return 'Saving your mint…'
  }

  if (progress?.phase === 'chain' && progress.total > 1) {
    return `Minting ${progress.total} NFTs in one transaction`
  }

  switch (step) {
    case 'checking_eligibility':
      return 'Checking eligibility…'
    case 'preparing_mint':
      return 'Preparing your mint…'
    case 'awaiting_signature':
      return 'Waiting for wallet approval…'
    case 'sending_transaction':
      return 'Sending transaction…'
    case 'confirming_transaction':
      return 'Confirming on-chain…'
    default:
      return 'Mint in progress…'
  }
}

export function mintProgressSubtext(
  step: MintUiStep,
  progress: MintProgressSnapshot | null
): string {
  if (step === 'recording_mint') {
    return 'Almost done — updating your allocation on Owltopia.'
  }

  if (progress?.phase === 'chain') {
    if (progress.total > 1) {
      return 'Approve once in Phantom or Solflare — all NFTs mint in a single transaction. Keep this tab open.'
    }
    return 'Approve the mint in Phantom or Solflare. Keep this tab open until it completes.'
  }

  if (step === 'confirming_transaction' || step === 'sending_transaction') {
    return 'This usually takes a few seconds. Do not close your wallet or this page.'
  }

  return 'Hang tight — your mint is on the way.'
}
