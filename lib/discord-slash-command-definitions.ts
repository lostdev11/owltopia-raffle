/**
 * Global application commands for Discord (PUT …/applications/{app.id}/commands).
 * @see https://discord.com/developers/docs/interactions/application-commands
 */
export const OWLTOPIA_PARTNER_SLASH_COMMAND = {
  name: 'owltopia-partner',
  description: 'Owltopia paid Discord giveaway bridge (Solana USDC + webhooks)',
  type: 1,
  dm_permission: false,
  options: [
    {
      name: 'subscribe',
      description: 'Get Solana USDC payment instructions for this server',
      type: 1,
    },
    {
      name: 'verify',
      description: 'Verify USDC payment using the Solana transaction signature',
      type: 1,
      options: [
        {
          name: 'signature',
          description: 'Solana transaction signature (base58)',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'webhook',
      description: 'Set the channel incoming webhook URL for giveaway pings',
      type: 1,
      options: [
        {
          name: 'url',
          description: 'https://discord.com/api/webhooks/…',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'status',
      description: 'Show subscription, webhook, and API status for this server',
      type: 1,
    },
  ],
} as const

export const ALL_DISCORD_SLASH_COMMANDS = [OWLTOPIA_PARTNER_SLASH_COMMAND] as const
