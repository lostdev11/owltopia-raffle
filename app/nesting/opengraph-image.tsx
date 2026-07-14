import { ImageResponse } from 'next/og'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'
import { owltopiaLinkPreviewOg, OWLTOPIA_OG_SIZE } from '@/lib/og/owltopia-link-preview'
import { getOwltopiaOgResponseOptions } from '@/lib/og/og-image-fonts'
import { loadLocalOgBrandArtDataUrl } from '@/lib/og/load-local-public-image-for-og'

export const runtime = 'nodejs'
export const revalidate = 600
export const alt = `Owl Nesting | ${PLATFORM_NAME}`
export const size = OWLTOPIA_OG_SIZE
export const contentType = 'image/png'

function hostLabel(site: string): string {
  try {
    return new URL(site).hostname.replace(/^www\./i, '')
  } catch {
    return 'owltopia.xyz'
  }
}

export default async function Image() {
  const ogOpts = await getOwltopiaOgResponseOptions()
  // True PNG from public/og-assets — carousel /images/*.png are WebP bytes that Satori can't embed.
  let imageUrl: string | null = null
  try {
    imageUrl = await loadLocalOgBrandArtDataUrl('nest-punk-owl')
  } catch {
    imageUrl = null
  }

  try {
    return new ImageResponse(
      owltopiaLinkPreviewOg({
        title: 'Owl Nesting',
        kindLabel: 'Earn OWL on perches',
        line1: 'Timed locks · claim when you want · wallet sign-in',
        line2: hostLabel(getSiteBaseUrl()),
        imageUrl,
        insetBrandArt: true,
      }),
      { ...ogOpts }
    )
  } catch {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0a0a',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ fontSize: 52, fontWeight: 800, color: 'white' }}>Owl Nesting</div>
          <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.78)', marginTop: 12 }}>{PLATFORM_NAME}</div>
        </div>
      ),
      { ...OWLTOPIA_OG_SIZE, ...ogOpts }
    )
  }
}
