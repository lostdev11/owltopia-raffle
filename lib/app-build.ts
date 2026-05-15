/**
 * Build id exposed to the client and `/api/app-build` so long-lived mobile tabs
 * (Android Chrome, Seeker Web Shell, installed PWA) can detect a newer deployment.
 */
export function getAppBuildId(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_BUILD_ID?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.VERCEL_DEPLOYMENT_ID?.trim()
  if (fromEnv) return fromEnv
  if (process.env.NODE_ENV === 'development') return 'dev'
  return 'local'
}
