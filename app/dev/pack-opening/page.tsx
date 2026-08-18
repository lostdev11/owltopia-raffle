import { notFound } from 'next/navigation'
import { DevPackOpeningClient } from '@/app/dev/pack-opening/DevPackOpeningClient'

/** Local-only cinematic playground. 404 in production builds. */
export default function DevPackOpeningPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return <DevPackOpeningClient />
}
