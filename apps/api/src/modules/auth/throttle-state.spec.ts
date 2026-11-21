import {
  chargeAttempt,
  isLocked,
  secondsUntilUnlocked,
  ThrottlePolicy,
  ThrottleState,
} from './throttle-state';

const policy: ThrottlePolicy = {
  maxAttempts: 3,
  windowSeconds: 600,
  lockBaseSeconds: 60,
  lockMaxSeconds: 300,
};
const T0 = new Date('2026-06-01T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** Aplica `n` intentos seguidos en `now` respetando la precondición (no cargar si está bloqueado). */
function charge(state: ThrottleState | null, now: Date, n = 1): ThrottleState | null {
  let current = state;
  for (let i = 0; i < n; i++) {
    if (isLocked(current, now)) return current;
    current = chargeAttempt(current, now, policy);
  }
  return current;
}

describe('chargeAttempt (limitador con bloqueo progresivo)', () => {
  it('permite maxAttempts intentos y bloquea el siguiente', () => {
    const state = charge(null, T0, 3)!;
    expect(state.attempts).toBe(3);
    expect(isLocked(state, T0)).toBe(false);

    const locked = chargeAttempt(state, T0, policy);
    expect(isLocked(locked, T0)).toBe(true);
    expect(secondsUntilUnlocked(locked, T0)).toBe(60);
    expect(locked.attempts).toBe(0);
    expect(locked.lockLevel).toBe(1);
  });

  it('el bloqueo expira solo (nunca es permanente)', () => {
    const locked = charge(null, T0, 4)!;
    expect(isLocked(locked, at(59))).toBe(true);
    expect(isLocked(locked, at(60))).toBe(false);
    expect(secondsUntilUnlocked(locked, at(60))).toBe(0);
  });

  it('redondea hacia arriba los segundos restantes', () => {
    const locked = charge(null, T0, 4)!;
    expect(secondsUntilUnlocked(locked, new Date(T0.getTime() + 59_500))).toBe(1);
  });

  it('escala el bloqueo (60 s, 120 s, 240 s) y lo limita a lockMaxSeconds', () => {
    let state = charge(null, T0, 4)!; // nivel 1: 60 s
    let now = at(60);
    state = charge(state, now, 4)!; // 3 intentos + 1 que bloquea → nivel 2
    expect(secondsUntilUnlocked(state, now)).toBe(120);

    now = new Date(now.getTime() + 120_000);
    state = charge(state, now, 4)!;
    expect(secondsUntilUnlocked(state, now)).toBe(240);

    now = new Date(now.getTime() + 240_000);
    state = charge(state, now, 4)!;
    expect(secondsUntilUnlocked(state, now)).toBe(300); // 480 → tope 300
    expect(state.lockLevel).toBe(4);
  });

  it('una ventana nueva reinicia los intentos pero conserva el nivel si el bloqueo es reciente', () => {
    let state = charge(null, T0, 2)!;
    expect(state.attempts).toBe(2);
    state = chargeAttempt(state, at(601), policy); // ventana expirada
    expect(state.attempts).toBe(1);
    expect(state.windowStartedAt).toEqual(at(601));
  });

  it('olvida el nivel tras una ventana completa de calma después del bloqueo', () => {
    const locked = charge(null, T0, 4)!; // nivel 1, bloqueado hasta +60 s
    const calm = chargeAttempt({ ...locked }, at(60 + 600 + 1), policy);
    expect(calm.lockLevel).toBe(0);
    expect(calm.attempts).toBe(1);
  });

  it('conserva el nivel si la ventana expira sin una ventana de calma completa tras el bloqueo', () => {
    const locked = charge(null, T0, 4)!; // bloqueado hasta +60 s; ventana reiniciada en T0
    const next = chargeAttempt(locked, at(601), policy); // ventana expirada pero 601 < 60 + 600
    expect(next.lockLevel).toBe(1);
  });

  it('no desborda con muchísimos bloqueos consecutivos', () => {
    let state: ThrottleState | null = null;
    let now = T0;
    for (let i = 0; i < 100; i++) {
      state = charge(state, now, 4);
      now = new Date(state!.lockedUntil!.getTime());
    }
    expect(state!.lockLevel).toBeLessThanOrEqual(30);
    expect(secondsUntilUnlocked(state, new Date(state!.lockedUntil!.getTime() - 1000))).toBeLessThanOrEqual(
      300,
    );
  });

  it('no está bloqueado sin estado', () => {
    expect(isLocked(null, T0)).toBe(false);
    expect(secondsUntilUnlocked(null, T0)).toBe(0);
  });
});
