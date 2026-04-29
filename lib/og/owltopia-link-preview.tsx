import type { ReactElement } from 'react'
import { getSiteBaseUrl } from '@/lib/site-config'
import { OG_FONT_SANS } from '@/lib/og/og-image-fonts'
import { OWLTOPIA_OG_H, OWLTOPIA_OG_W, OWLTOPIA_OG_SIZE } from '@/lib/og/og-constants'

/**
 * 1200×630 — same *visual* structure as `RafflePromoPngButton` (1200×675 canvas) so
 * a shared link “looks like” the downloadable X card, within platform size limits.
 */
const W = OWLTOPIA_OG_W
const H = OWLTOPIA_OG_H

const THEME = {
  bg: '#0a0a0a',
  foreground: '#fafafa',
  muted: '#a3a3a3',
  prime: '#00ff88',
  midnight: '#00d4ff',
  greenRgba: 'rgba(34, 197, 94, 0.45)',
} as const

/** Proportions from RafflePromoPng `PROMO` / panel, scaled for H=630. */
const L = {
  outer: 40,
  panelR: 28,
  art: 400,
  textLeft: 48,
  textArtGap: 32,
  title: 50,
  titleLine: 1.1,
  meta: 25,
  afterTitle: 22,
  betweenMeta: 32,
} as const

const sans = `${OG_FONT_SANS}, ui-sans-serif, system-ui, -apple-system, sans-serif`

export type OwltopiaLinkPreviewOgProps = {
  title: string
  /** Optional. Raffle promo has none — keep null/empty to match the PNG. */
  kindLabel?: string | null
  line1: string
  line2?: string
  imageUrl: string | null
}

/**
 * Branded 1200×630 PNG for `next/og` — mirrors the client promo (`RafflePromoPngButton`):
 * triple radial field, glass panel, gradient accent bar, title, ticket/ends, big art, LIVE ON pill.
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
  const safeTitle = title.length > 110 ? `${title.slice(0, 106).trimEnd()}...` : title
  const showKind = kindLabel && kindLabel.trim().length > 0
  const kl = (kindLabel ?? '').trim().toUpperCase()

  return (
    <div
      style={{
        position: 'relative',
        width: W,
        height: H,
        display: 'flex',
        backgroundColor: THEME.bg,
        fontFamily: sans,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `radial-gradient(ellipse 60% 55% at 20% 50%, rgba(0, 255, 136, 0.11) 0%, rgba(0, 255, 136, 0) 60%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `radial-gradient(ellipse 50% 48% at 80% 82%, rgba(0, 212, 255, 0.1) 0%, rgba(0, 212, 255, 0) 55%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: `radial-gradient(ellipse 42% 40% at 40% 18%, rgba(168, 255, 0, 0.08) 0%, rgba(168, 255, 0, 0) 50%)`,
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          width: '100%',
          height: '100%',
          padding: L.outer,
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
            borderRadius: L.panelR,
            border: '2.5px solid rgba(0, 255, 136, 0.95)',
            background:
              'linear-gradient(145deg, rgba(10, 28, 18, 0.97) 0%, rgba(6, 20, 12, 0.98) 50%, rgba(12, 26, 16, 0.97) 100%)',
            boxShadow: '0 0 0 1px rgba(0, 255, 136, 0.15), 0 0 32px rgba(0, 255, 136, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.045)',
            padding: L.textLeft,
            paddingRight: L.textLeft,
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: L.textArtGap,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              height: '100%',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                justifyContent: 'flex-start',
                paddingTop: 4,
              }}
            >
              {showKind ? (
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'rgba(0, 255, 136, 0.88)',
                    letterSpacing: 4.5,
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}
                >
                  {kl}
                </div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'stretch',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 5,
                    minHeight: 44,
                    borderRadius: 2,
                    background: `linear-gradient(180deg, ${THEME.prime} 0%, ${THEME.midnight} 100%)`,
                    flexShrink: 0,
                    alignSelf: 'stretch',
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      fontSize: L.title,
                      fontWeight: 700,
                      color: THEME.foreground,
                      lineHeight: L.titleLine,
                      letterSpacing: -0.5,
                      textShadow: '0 0 20px rgba(0, 255, 136, 0.18)',
                    }}
                  >
                    {safeTitle}
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  marginTop: L.afterTitle,
                }}
              >
                <div
                  style={{
                    fontSize: L.meta,
                    fontWeight: 500,
                    color: THEME.muted,
                  }}
                >
                  {line1}
                </div>
                {line2 ? (
                  <div
                    style={{
                      fontSize: L.meta,
                      fontWeight: 500,
                      color: THEME.muted,
                      marginTop: L.betweenMeta - 2,
                    }}
                  >
                    {line2}
                  </div>
                ) : null}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                borderRadius: 999,
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 8,
                paddingBottom: 8,
                alignSelf: 'flex-start',
                background: 'linear-gradient(90deg, rgba(0, 255, 136, 0.2) 0%, rgba(0, 212, 255, 0.14) 100%)',
                border: `1px solid ${THEME.greenRgba}`,
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
                width: L.art,
                height: L.art,
                borderRadius: 20,
                overflow: 'hidden',
                border: '2px solid rgba(0, 255, 136, 0.5)',
                display: 'flex',
                boxShadow: '0 0 10px rgba(0, 255, 136, 0.25), 0 0 1px rgba(0,0,0,0.2)',
                flexShrink: 0,
              }}
            >
              <img
                src={imageUrl}
                width={L.art}
                height={L.art}
                style={{
                  objectFit: 'cover',
                  width: L.art,
                  height: L.art,
                }}
                alt=""
              />
            </div>
          ) : (
            <div
              style={{
                width: L.art,
                height: L.art,
                borderRadius: 20,
                backgroundColor: 'rgba(6, 20, 12, 0.75)',
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

export { OWLTOPIA_OG_SIZE } from '@/lib/og/og-constants'
