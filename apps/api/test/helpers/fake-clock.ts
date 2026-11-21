import { Clock } from '../../src/common';

/** Reloj controlable: las pruebas avanzan el tiempo del SERVIDOR sin esperas reales. */
export class FakeClock extends Clock {
  constructor(private current = new Date('2026-06-01T12:00:00.000Z')) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
