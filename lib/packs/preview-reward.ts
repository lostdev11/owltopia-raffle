import type { PackOpenClientResult } from '@/lib/client/execute-pack-purchase'

export function mockPackOpenReward(category: 'owl' | 'sol' | 'nft'): PackOpenClientResult {
  if (category === 'sol') {
    return {
      openId: '00000000-0000-4000-8000-000000000001',
      category: 'sol',
      prizeLabel: '0.1 SOL',
      owlAmount: null,
      solAmount: 0.1,
      nftMint: null,
      nftName: null,
      nftImageUrl: null,
      freeTicketCredits: 0,
      payoutSignature: null,
      openSeed: 'preview-seed',
      openCommitHash: 'preview-commit',
      revealMessage: 'You won 0.1 SOL (preview)',
    }
  }
  if (category === 'nft') {
    return {
      openId: '00000000-0000-4000-8000-000000000002',
      category: 'nft',
      prizeLabel: 'Preview Owl NFT',
      owlAmount: null,
      solAmount: null,
      nftMint: 'Prev1ew111111111111111111111111111111111111',
      nftName: 'Preview Owl NFT',
      nftImageUrl: '/logo.gif',
      freeTicketCredits: 0,
      payoutSignature: null,
      openSeed: 'preview-seed',
      openCommitHash: 'preview-commit',
      revealMessage: 'You won Preview Owl NFT (preview)',
    }
  }
  return {
    openId: '00000000-0000-4000-8000-000000000003',
    category: 'owl',
    prizeLabel: '25 $OWL',
    owlAmount: 25,
    solAmount: null,
    nftMint: null,
    nftName: null,
    nftImageUrl: null,
    freeTicketCredits: 25,
    payoutSignature: null,
    openSeed: 'preview-seed',
    openCommitHash: 'preview-commit',
    revealMessage: 'You have won 25 free tickets on raffle site (preview)',
  }
}
