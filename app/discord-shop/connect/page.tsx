import { DiscordShopConnectClient } from '@/components/discord-shop/DiscordShopConnectClient'

export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<{ state?: string }>
}

export default async function DiscordShopConnectPage({ searchParams }: Props) {
  const sp = await searchParams
  const state = typeof sp.state === 'string' ? sp.state.trim() : ''

  return (
    <main className="mx-auto min-h-[70vh] max-w-lg px-4 py-16">
      <DiscordShopConnectClient state={state} />
    </main>
  )
}
