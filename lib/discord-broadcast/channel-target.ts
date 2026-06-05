export type DiscordBroadcastChannelTarget = 'public' | 'holder' | 'both'

export function channelTargetToFlags(target: DiscordBroadcastChannelTarget): {
  post_to_public: boolean
  post_to_holder: boolean
} {
  return {
    post_to_public: target === 'public' || target === 'both',
    post_to_holder: target === 'holder' || target === 'both',
  }
}

export function flagsToChannelTarget(
  postToPublic: boolean,
  postToHolder: boolean
): DiscordBroadcastChannelTarget | null {
  if (postToPublic && postToHolder) return 'both'
  if (postToPublic) return 'public'
  if (postToHolder) return 'holder'
  return null
}

export function channelTargetLabel(target: DiscordBroadcastChannelTarget): string {
  if (target === 'both') return 'Public + holder chat'
  if (target === 'holder') return 'Holder chat only'
  return 'Public chat only'
}
