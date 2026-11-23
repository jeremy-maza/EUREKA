import { useEffect, useState } from 'react';
import { ArrowRight, Home, RotateCcw, Sparkles } from 'lucide-react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_WORLD_SLUG, isCompleted, progressOf, sortWorlds, worldAccentStyle } from '@/lib/worlds';
import { api, ApiError } from '@/services/api/client';
import type { WorldProgress, WorldRef, WorldSummary } from '@/services/api/types';
import { Logo } from '@/components/ui/Logo';
import { ScreenMessage } from '@/components/ui/ScreenMessage';
import styles from './ResultsPage.module.css';

type ResultData = {
  slug: string;
  world: WorldSummary | undefined;
  progress: WorldProgress | undefined;
  /** Siguiente mundo por posición, con su estado según el servidor. */
  next: { world: WorldSummary; unlocked: boolean } | null;
};

/** Pantalla de mundo completado (`/final/:slug`). */
export function ResultsPage() {
  const navigate = useNavigate();
  const { slug = DEFAULT_WORLD_SLUG } = useParams();
  const location = useLocation();
  // La partida pasa el mundo que el último acierto acaba de desbloquear (dato del servidor).
  const justUnlocked = (location.state as { nextWorldUnlocked?: WorldRef | null } | null)?.nextWorldUnlocked;
  const [data, setData] = useState<ResultData | null>(null);
  const [error, setError] = useState<{ slug: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.worlds(), api.progress()])
      .then(([worlds, progress]) => {
        if (cancelled) return;
        const sorted = sortWorlds(worlds);
        const world = sorted.find((item) => item.slug === slug);
        const nextWorld = world ? sorted.find((item) => item.position > world.position) : undefined;
        setData({
          slug,
          world,
          progress: progressOf(progress, slug),
          next: nextWorld
            ? { world: nextWorld, unlocked: progressOf(progress, nextWorld.slug)?.unlocked !== false }
            : null,
        });
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError({
            slug,
            message: caught instanceof ApiError ? caught.message : 'No se pudo cargar tu resultado.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error?.slug === slug) {
    return (
      <ScreenMessage title="No pudimos cargar tu resultado">
        <p>{error.message}</p>
        <button type="button" onClick={() => navigate('/')}>
          Volver al inicio
        </button>
      </ScreenMessage>
    );
  }
  if (!data || data.slug !== slug) return <ScreenMessage title="Cargando…" />;
  if (!data.world) {
    return (
      <ScreenMessage title="No encontramos ese mundo">
        <p>Elige un mundo en el mapa.</p>
        <button type="button" onClick={() => navigate('/')}>
          Volver al mapa
        </button>
      </ScreenMessage>
    );
  }
  // Solo se llega aquí al completar el mundo; si no, no hay resultado que mostrar.
  if (!isCompleted(data.progress)) return <Navigate to="/" replace />;

  const { world, progress, next } = data;
  const nextTarget: WorldRef | null = justUnlocked
    ? justUnlocked
    : next?.unlocked
      ? { slug: next.world.slug, name: next.world.name, position: next.world.position }
      : null;
  const isLastWorld = next === null;
  const completions = progress?.completionsCount ?? 1;

  return (
    <main className={styles.page} style={worldAccentStyle(world.slug, world.position)}>
      <header className={styles.header}>
        <Logo compact />
      </header>
      <section className={styles.result}>
        <div className={styles.emblem}>
          <div className={styles.rays} />
          <Sparkles size={48} />
        </div>
        <span className={styles.label}>
          MUNDO {world.position} COMPLETADO · {world.name.toUpperCase()}
        </span>
        <h1>¡Descubrimiento logrado!</h1>
        <p>
          {isLastWorld
            ? '¡Superaste el último mundo! Vuelve cuando quieras: cada secuencia sortea reglas distintas.'
            : 'Superaste todos los desafíos de la secuencia. Cada partida sortea reglas distintas: ¡sigue explorando!'}
        </p>

        {justUnlocked && (
          <p className={styles.unlocked} role="status">
            <Sparkles size={16} aria-hidden="true" /> ¡Nuevo mundo desbloqueado! Mundo {justUnlocked.position}
            : {justUnlocked.name}
          </p>
        )}

        <div className={styles.stats}>
          <div>
            <small>Puntos totales</small>
            <strong>{progress?.totalPoints ?? 0}</strong>
          </div>
          <div>
            <small>Mejor racha</small>
            <strong>{progress?.bestStreak ?? 0}</strong>
          </div>
          <div>
            <small>Reglas dominadas</small>
            <strong>
              {progress?.unlockedRules.length ?? 0}
              {typeof progress?.ruleCount === 'number' && <span> / {progress.ruleCount}</span>}
            </strong>
          </div>
          <div>
            <small>Veces completado</small>
            <strong>{completions}</strong>
          </div>
        </div>
        <div className={styles.actions}>
          {nextTarget && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => navigate(`/juego/${nextTarget.slug}`)}
            >
              Ir al Mundo {nextTarget.position} <ArrowRight size={18} />
            </button>
          )}
          <button
            type="button"
            className={nextTarget ? styles.secondary : styles.primary}
            onClick={() => navigate(`/juego/${world.slug}`)}
          >
            <RotateCcw size={18} /> Jugar de nuevo
          </button>
          <button type="button" className={styles.secondary} onClick={() => navigate('/')}>
            <Home size={18} /> Mapa de mundos
          </button>
        </div>
      </section>
    </main>
  );
}
