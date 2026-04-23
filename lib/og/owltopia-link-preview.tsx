import type { ReactElement } from 'react'
import { getSiteBaseUrl } from '@/lib/site-config'

export type OwltopiaLinkPreviewOgProps = {
  title: string
  kindLabel: string
  line1: string
  line2?: string
  imageUrl: string | null
}

const W = 1200
const H = 630

/**
 * Branded 1200×630 PNG for `next/og` — aligned with in-app promo cards (dark + neon green + art square).
 * Used for X/Twitter, Discord, Slack, iMessage link unfurls via og:image.
 */
export function owltopiaLinkPreviewOg({
  title,
  kindLabel,
  line1,
  line2,
  imageUrl,
}: OwltopiaLinkPreviewOgProps): ReactElement {
  const site = getSiteBaseUrl()
  let host = 'owltopia.xyz'
  try {
    host = new URL(site).hostname.replace(/^www\./i, '')
  } catch {
    /* keep default */
  }
  const safeTitle = title.length > 90 ? `${title.slice(0, 87).trimEnd()}...` : title
  const art = 300

  return (
    <div
      style={{
        width: W,
        height: H,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0a0a0a',
        backgroundImage:
          'radial-gradient(ellipse 70% 55% at 18% 50%, rgba(0, 255, 136, 0.14) 0%, transparent 55%),' +
          'radial-gradient(ellipse 50% 45% at 82% 80%, rgba(0, 212, 255, 0.11) 0%, transparent 50%),' +
          'radial-gradient(ellipse 40% 35% at 38% 18%, rgba(168, 255, 0, 0.08) 0%, transparent 45%)',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          padding: 28,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            borderRadius: 24,
            border: '3px solid #00ff88',
            background: 'linear-gradient(145deg, rgba(10, 28, 18, 0.97) 0%, rgba(6, 20, 12, 0.99) 50%, rgba(8, 22, 14, 0.98) 100%)',
            boxShadow: '0 0 0 1px rgba(0, 255, 136, 0.15), 0 0 40px rgba(0, 255, 136, 0.18)',
            padding: 28,
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 32,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minWidth: 0,
              height: '100%',
              justifyContent: 'space-between',
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'rgba(0, 255, 136, 0.9)',
                  letterSpacing: 5,
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}
              >
                {kindLabel}
              </div>
              <div
                style={{
                  fontSize: 46,
                  fontWeight: 800,
                  color: '#fafafa',
                  lineHeight: 1.1,
                  letterSpacing: -1,
                }}
              >
                {safeTitle}
              </div>
              <div
                style={{
                  fontSize: 23,
                  fontWeight: 500,
                  color: '#a3a3a3',
                  marginTop: 20,
                }}
              >
                {line1}
              </div>
              {line2 ? (
                <div
                  style={{
                    fontSize: 23,
                    fontWeight: 500,
                    color: '#a3a3a3',
                    marginTop: 8,
                  }}
                >
                  {line2}
                </div>
              ) : null}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                borderRadius: 999,
                paddingLeft: 18,
                paddingRight: 18,
                paddingTop: 10,
                paddingBottom: 10,
                alignSelf: 'flex-start',
                background: 'linear-gradient(90deg, rgba(0, 255, 136, 0.22) 0%, rgba(0, 212, 255, 0.14) 100%)',
                border: '1px solid rgba(34, 197, 94, 0.45)',
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#d1fae5',
                }}
              >{`LIVE ON ${host}`}</span>
            </div>
          </div>

          {imageUrl ? (
            <div
              style={{
                width: art,
                height: art,
                borderRadius: 18,
                overflow: 'hidden',
                border: '2px solid rgba(0, 255, 136, 0.45)',
                display: 'flex',
                flexShrink: 0,
                boxShadow: '0 0 20px rgba(0, 255, 136, 0.15)',
              }}
            >
              <img
                src={imageUrl}
                width={art}
                height={art}
                style={{
                  objectFit: 'cover',
                  width: art,
                  height: art,
                }}
                alt=""
              />
            </div>
          ) : (
            <div
              style={{
                width: art,
                height: art,
                borderRadius: 18,
                backgroundColor: 'rgba(6, 20, 12, 0.9)',
                border: '2px solid rgba(0, 255, 136, 0.2)',
                flexShrink: 0,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export const OWLTOPIA_OG_SIZE = { width: W, height: H } as const
