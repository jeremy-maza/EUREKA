import { useEffect, useState } from 'react';
import { api, ApiError } from '@/services/api/client';
import type { WorldProgress, WorldSummary } from '@/services/api/types';
import { sortWorlds } from './worlds';

export type WorldCatalog = { worlds: WorldSummary[]; progress: WorldProgress[] };

/**
 * Mundos (ordenados por posición) y el progreso del jugador en cada uno (solo estudiantes: `enabled`). `retry` vuelve a pedirlos; los efectos no
 * llaman a `setState` de forma síncrona (se incrementa un contador de recarga).
 */
export function useWorldCatalog(fallbackError: string, enabled = true) {
  const [catalog, setCatalog] = useState<WorldCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.all([api.worlds(), api.progress()])
      .then(([worlds, progress]) => {
        if (!cancelled) setCatalog({ worlds: sortWorlds(worlds), progress });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : fallbackError);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, fallbackError, enabled]);

  const retry = () => {
    setError(null);
    setReloadKey((key) => key + 1);
  };

  return { catalog, error, retry };
}
