type PresaleStats = {
  presale_live?: boolean
  sold?: number
  remaining?: number
  presale_supply?: number
  percent_sold?: number
}

export async function fetchPresaleStats(siteUrl: string): Promise<PresaleStats | null> {
  try {
    const res = await fetch(`${siteUrl}/api/gen2-presale/stats`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    return (await res.json()) as PresaleStats
  } catch {
    return null
  }
}

function normalizePrompt(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function buildReplyText(
  promptRaw: string,
  siteUrl: string
): Promise<string> {
  const prompt = normalizePrompt(promptRaw)
  const mintish =
    !prompt ||
    /\b(mint|presale|remaining|sold|supply|spots|left|gen2|gen 2)\b/.test(prompt)

  if (mintish) {
    const stats = await fetchPresaleStats(siteUrl)
    if (stats && typeof stats.remaining === 'number') {
      const live = stats.presale_live ? 'live' : 'not live right now'
      const sold = stats.sold ?? 0
      const supply = stats.presale_supply ?? '?'
      const remaining = stats.remaining
      const pct =
        typeof stats.percent_sold === 'number' ? `${stats.percent_sold.toFixed(1)}%` : null
      const lines = [
        `Gen2 presale is **${live}**.`,
        `**${sold}** / **${supply}** sold · **${remaining}** remaining${pct ? ` (${pct})` : ''}.`,
        `Details: ${siteUrl}/gen2-presale`,
      ]
      return lines.join('\n')
    }
  }

  if (/\b(raffle|raffles|giveaway|giveaways)\b/.test(prompt)) {
    return `Live raffles and giveaways are on owltopia — ${siteUrl}/raffles`
  }

  if (/\b(site|link|website|owltopia)\b/.test(prompt)) {
    return `Owltopia: ${siteUrl}`
  }

  return [
    'Hey — I’m Owltopia Bot.',
    `Mint / presale updates: ${siteUrl}/gen2-presale`,
    `Raffles: ${siteUrl}/raffles`,
  ].join('\n')
}

export function stripBotMention(content: string, botId: string): string {
  return content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim()
}
