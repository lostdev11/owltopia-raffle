import { redirect } from 'next/navigation'

/** Primary admin giveaways UI is community pool (join, draw, claim). */
export default function AdminGiveawaysPage() {
  redirect('/admin/community-giveaways')
}
