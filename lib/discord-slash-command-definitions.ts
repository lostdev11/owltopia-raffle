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
      name: 'webhook-raffle-created',
      description: 'Set incoming webhook for new ticket raffles (partner creator announcements)',
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
      name: 'webhook-raffle-winner',
      description: 'Set incoming webhook for ticket raffle winner draws (claim on owltopia dashboard)',
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

export const OWLTOPIA_SHOP_SLASH_COMMAND = {
  name: 'owltopia-shop',
  description: 'Owltopia points shop — browse, buy, and auto-deliver OWL to your linked wallet',
  type: 1,
  dm_permission: false,
  options: [
    {
      name: 'browse',
      description: 'List items available in this server shop',
      type: 1,
    },
    {
      name: 'buy',
      description: 'Purchase an item (requires linked Solana wallet)',
      type: 1,
      options: [
        {
          name: 'product',
          description: 'Product slug from /owltopia-shop browse',
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: 'wallet',
      description: 'Check your linked Solana wallet or get a connect link',
      type: 1,
    },
    {
      name: 'connect-wallet',
      description: 'Get a link to connect your Solana wallet for auto-delivery',
      type: 1,
    },
    {
      name: 'balance',
      description: 'Show your points balance in this server',
      type: 1,
    },
    {
      name: 'purchases',
      description: 'Show your recent shop purchases',
      type: 1,
    },
    {
      name: 'admin',
      description: 'Manage shop products and grant points (admin/founder)',
      type: 1,
      options: [
        {
          name: 'add-product',
          description: 'Add or update a shop product',
          type: 1,
          options: [
            { name: 'name', description: 'Display name', type: 3, required: true },
            { name: 'points', description: 'Points cost', type: 4, required: true },
            { name: 'owl', description: 'OWL amount to auto-send on purchase', type: 10, required: false },
            { name: 'slug', description: 'URL slug (defaults from name)', type: 3, required: false },
            { name: 'description', description: 'Optional description', type: 3, required: false },
          ],
        },
        {
          name: 'grant-points',
          description: 'Add or remove points for a Discord user',
          type: 1,
          options: [
            { name: 'user', description: 'Discord user id (snowflake)', type: 3, required: true },
            { name: 'amount', description: 'Points to add (negative to deduct)', type: 4, required: true },
          ],
        },
        {
          name: 'list-products',
          description: 'List all products including inactive',
          type: 1,
        },
      ],
    },
  ],
} as const

export const ALL_DISCORD_SLASH_COMMANDS = [
  OWLTOPIA_PARTNER_SLASH_COMMAND,
  OWLTOPIA_SHOP_SLASH_COMMAND,
] as const
