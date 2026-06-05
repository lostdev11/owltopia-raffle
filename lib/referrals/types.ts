export type RaffleReferralPromoterRow = {
  rank: number
  referralCode: string
  displayName: string | null
  ticketsReferred: number
  referredVolume: Record<string, number>
}

export type RaffleReferralStats = {
  promoters: RaffleReferralPromoterRow[]
}
