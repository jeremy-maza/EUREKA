import type { CSSProperties } from 'react';
import type { DifficultyLevel, WorldProgress, WorldSummary } from '@/services/api/types';

/**
 * Utilidades de presentación de los mundos. No deciden nada del juego: el desbloqueo, la secuencia y la dificultad
 * los decide el servidor; aquí solo se leen sus campos para elegir qué mostrar.
 */

/** Mundo por defecto (Mundo 1) cuando no hay datos para elegir otro. */
export const DEFAULT_WORLD_SLUG = 'arithmetic';

export const DIFFICULTY_LABEL: Record<DifficultyLevel, string> = {
  EASIER: 'Suave',
  BASELINE: 'Normal',
  HARDER: 'Intensa',
};

export const sortWorlds = (worlds: WorldSummary[]) => [...worlds].sort((a, b) => a.position - b.position);

export const progressOf = (progress: WorldProgress[], slug: string) =>
  progress.find((item) => item.worldSlug === slug);

/** El servidor marca `unlocked: false` en los mundos bloqueados. Sin dato, no se bloquea: el servidor responde 403. */
export const isLocked = (progress: WorldProgress | undefined) => progress?.unlocked === false;

export const isCompleted = (progress: WorldProgress | undefined) =>
  !!progress && ((progress.completionsCount ?? 0) > 0 || progress.status === 'COMPLETED');

export type WorldStatus = 'locked' | 'available' | 'in-progress' | 'completed';

export function worldStatus(progress: WorldProgress | undefined): WorldStatus {
  if (isLocked(progress)) return 'locked';
  if (isCompleted(progress)) return 'completed';
  if (progress && (progress.activeSequence || progress.statistics.attemptsCount > 0)) return 'in-progress';
  return 'available';
}

/** El mundo más indicado para jugar: el primero desbloqueado y sin completar; si no hay, Aritmética. */
export function pickDefaultWorld(worlds: WorldSummary[], progress: WorldProgress[]): string {
  const sorted = sortWorlds(worlds);
  const next = sorted.find((world) => {
    const item = progressOf(progress, world.slug);
    return !isLocked(item) && !isCompleted(item);
  });
  if (next) return next.slug;
  return sorted.some((world) => world.slug === DEFAULT_WORLD_SLUG)
    ? DEFAULT_WORLD_SLUG
    : (sorted[0]?.slug ?? DEFAULT_WORLD_SLUG);
}

export const unlockHint = (requirement: WorldProgress['unlockRequirement']) =>
  requirement
    ? `Completa el Mundo ${requirement.position} (${requirement.worldName}) para desbloquear.`
    : 'Completa el mundo anterior para desbloquear.';

/** Acento de cada mundo, tomado de la paleta de `global.css`. */
const ACCENTS: Record<string, { main: string; deep: string; soft: string }> = {
  arithmetic: { main: 'var(--green)', deep: 'var(--leaf)', soft: '#e8f8e2' },
  signs: { main: 'var(--blue)', deep: '#2b789f', soft: '#e2f4fc' },
  fractions: { main: 'var(--yellow)', deep: '#9a6214', soft: '#fff4c5' },
  algebra: { main: 'var(--coral)', deep: '#b9473e', soft: '#ffe8e4' },
  chaos: { main: 'var(--orange)', deep: '#b35512', soft: '#ffeedd' },
};
const ACCENT_ORDER = ['arithmetic', 'signs', 'fractions', 'algebra', 'chaos'];

/** Variables CSS `--accent`, `--accent-deep` y `--accent-soft` para un mundo (por slug o, si no se conoce, por posición). */
export function worldAccentStyle(slug: string, position = 1): CSSProperties {
  const accent = ACCENTS[slug] ?? ACCENTS[ACCENT_ORDER[(Math.max(position, 1) - 1) % ACCENT_ORDER.length]];
  return {
    '--accent': accent.main,
    '--accent-deep': accent.deep,
    '--accent-soft': accent.soft,
  } as CSSProperties;
}
