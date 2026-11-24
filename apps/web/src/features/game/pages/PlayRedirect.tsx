import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '@/services/api/client';
import { DEFAULT_WORLD_SLUG, pickDefaultWorld, sortWorlds } from '@/lib/worlds';
import { ScreenMessage } from '@/components/ui/ScreenMessage';

/**
 * `/juego` sin mundo: lleva al más indicado (el primero desbloqueado y sin completar; si no, Aritmética). Si no se
 * pueden leer los mundos, va al Mundo 1: la partida mostrará el error y permitirá reintentar.
 */
export function PlayRedirect() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.worlds(), api.progress()])
      .then(([worlds, progress]) => {
        if (!cancelled) setTarget(pickDefaultWorld(sortWorlds(worlds), progress));
      })
      .catch(() => {
        if (!cancelled) setTarget(DEFAULT_WORLD_SLUG);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) return <ScreenMessage title="Buscando tu próximo mundo…" />;
  return <Navigate to={`/juego/${target}`} replace />;
}
