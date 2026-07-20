import type { BackfillProgress } from '@shared/types'

export type ProgressFn = (p: BackfillProgress) => void

export class BackfillCancelledError extends Error {
  constructor() {
    super('생성이 취소되었습니다')
    this.name = 'BackfillCancelledError'
  }
}

let cancelled = false

export function resetCancel(): void {
  cancelled = false
}

export function cancelBackfill(): void {
  cancelled = true
}

export function throwIfCancelled(): void {
  if (cancelled) throw new BackfillCancelledError()
}
