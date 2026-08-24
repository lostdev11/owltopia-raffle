export const COIN_ART_UPGRADE_COLLECTION_CAPACITY = 1000

export type CoinArtUpgradePublicProgress = {
  capacity: number
  upgraded: number
  upgrading: number
  remaining: number
  percent_upgraded: number
  /** False when catalog is empty — hide the public bar. */
  visible: boolean
}
