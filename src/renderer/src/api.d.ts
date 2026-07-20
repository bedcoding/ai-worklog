import type { WorklogApi } from '@shared/types'

declare global {
  interface Window {
    api: WorklogApi
  }
}

export {}
