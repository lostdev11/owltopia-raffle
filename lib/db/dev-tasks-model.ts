/** Dev task shape and limits shared with the admin UI (no server imports — safe for client bundles). */

export const DEV_TASK_MAX_SCREENSHOTS_TOTAL = 12

export interface DevTask {
  id: string
  title: string
  body: string | null
  status: 'open' | 'done'
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string | null
  screenshot_paths: string[]
  screenshot_urls: string[]
}
