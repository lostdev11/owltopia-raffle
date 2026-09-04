export type DiscordWlCsvRow = {
  wallet: string
  phase_key: string
  discord_user_id: string
  discord_username: string | null
  submitted_at: string
  spots: number
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function buildDiscordWlExportCsv(rows: DiscordWlCsvRow[]): string {
  const header = 'wallet,phase_key,discord_user_id,discord_username,submitted_at,spots'
  const lines = rows.map((r) =>
    [
      escapeCsvField(r.wallet),
      escapeCsvField(r.phase_key),
      escapeCsvField(r.discord_user_id),
      escapeCsvField(r.discord_username ?? ''),
      escapeCsvField(r.submitted_at),
      String(r.spots),
    ].join(',')
  )
  return `\uFEFF${header}\n${lines.join('\n')}`
}

export function discordWlWalletsPlaintext(wallets: string[]): string {
  return wallets.join('\n')
}

export function mapPushWallets(input: {
  wallets: string[]
  spotsPerWallet: number
  notePrefix?: string
}): Array<{ wallet: string; allowed_mints: number; note: string | null }> {
  const spots = Math.max(1, Math.floor(input.spotsPerWallet || 1))
  const note = input.notePrefix?.trim() || 'discord-wl'
  return input.wallets.map((wallet) => ({
    wallet,
    allowed_mints: spots,
    note,
  }))
}
