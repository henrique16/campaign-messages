import type { Clock } from '../../ports/Clock'

/** Relógio real do sistema. */
export class SystemClock implements Clock {
  /** Devolve o instante atual. */
  now(): Date {
    return new Date()
  }
}
