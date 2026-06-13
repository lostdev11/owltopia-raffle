export type RaffleShareCopyRequest = {
  title: string
  shareText: string
  onCopied?: () => void
}

type OpenHandler = (req: RaffleShareCopyRequest) => void

let openHandler: OpenHandler | null = null

/** Registered by RaffleShareCopyHost (app shell). */
export function setRaffleShareCopyOpenHandler(handler: OpenHandler | null): void {
  openHandler = handler
}

/** Open the platform copy dialog (never use window.prompt). */
export function openRaffleShareCopyRequest(req: RaffleShareCopyRequest): void {
  openHandler?.(req)
}
