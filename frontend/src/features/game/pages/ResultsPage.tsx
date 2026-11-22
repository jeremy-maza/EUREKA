import { useEffect, useState } from 'react';
import { Home, RotateCcw, Sparkles } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ARITHMETIC_WORLD_SLUG } from '@/features/game/constants';
import { api, ApiError } from '@/shared/api/client';
import type { WorldProgress } from '@/shared/api/types';
import { Logo } from '@/shared/components/Logo';
import { ScreenMessage } from '@/shared/components/ScreenMessage';
import styles from './ResultsPage.module.css';

export function ResultsPage() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<WorldProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .worldProgress(ARITHMETIC_WORLD_SLUG)
      .then((data) => {
        if (!cancelled) setProgress(data);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(caught instanceof ApiError ? caught.message : 'No se pudo cargar tu resultado.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <ScreenMessage title="No pudimos cargar tu resultado">
        <p>{error}</p>
        <button type="button" onClick={() => navigate('/')}>
          Volver al inicio
        </button>
      </ScreenMessage>
    );
  }
  if (!progress) return <ScreenMessage title="Cargando…" />;
  // Solo se llega aquí al completar el mundo; si no, no hay resultado que mostrar.
  if (progress.status !== 'COMPLETED') return <Navigate to="/" replace />;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo compact />
      </header>
      <section className={styles.result}>
        <div className={styles.emblem}>
          <div className={styles.rays} />
          <Sparkles size={48} />
        </div>
        <span className={styles.label}>DEMO COMPLETADA</span>
        <h1>¡Descubrimiento logrado!</h1>
        <p>
          ¡Completaste todos los desafíos! Sigue practicando y descubrirás aún más caminos con los números.
        </p>
        <div className={styles.stats}>
          <div>
            <small>Desafíos completados</small>
            <strong>{progress.challengeCount}</strong>
          </div>
          <div>
            <small>Puntos totales</small>
            <strong>{progress.totalPoints}</strong>
          </div>
          <div>
            <small>Mejor racha</small>
            <strong>{progress.bestStreak}</strong>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => navigate('/juego')}>
            <RotateCcw size={18} /> Volver a jugar
          </button>
          <button type="button" className={styles.secondary} onClick={() => navigate('/')}>
            <Home size={18} /> Inicio
          </button>
        </div>
      </section>
    </main>
  );
}
