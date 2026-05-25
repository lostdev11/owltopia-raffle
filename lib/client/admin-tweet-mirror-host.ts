export type AdminTweetMirrorRequest = {
  raffleId: string
  raffleTitle: string
}

type OpenHandler = (req: AdminTweetMirrorRequest) => void

let openHandler: OpenHandler | null = null

/** Registered by AdminTweetMirrorHost (app shell). */
export function setAdminTweetMirrorOpenHandler(handler: OpenHandler | null): void {
  openHandler = handler
}

/** Open the platform tweet-mirror dialog (never use window.prompt). */
export function openAdminTweetMirrorRequest(req: AdminTweetMirrorRequest): void {
  openHandler?.(req)
}
