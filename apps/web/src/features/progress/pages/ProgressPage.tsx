import { useEffect, useState } from 'react';
import { Flame, Play, Sparkles, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ARITHMETIC_WORLD_SLUG } from '@/lib/worlds';
import { api, ApiError } from '@/services/api/client';
import type { AttemptHistoryItem, ScoreSummary, WorldProgress, WorldSummary } from '@/services/api/types';
import { InsightsHeader } from '@/components/common/InsightsHeader';
import { ScreenMessage } from '@/components/ui/ScreenMessage';
import styles from './ProgressPage.module.css';

const RECENT_LIMIT = 10;

type ProgressData = {
  world: WorldSummary | undefined;
  progress: WorldProgress;
  score: ScoreSummary;
  attempts: AttemptHistoryItem[];
};

const OUTCOME_LABEL: Record<AttemptHistoryItem['outcome'], string> = {
  CORRECT: 'Correcto',
  INCORRECT: 'Incorrecto',
  TIMEOUT: 'Sin tiempo',
  PENDING: 'En curso',
};

const formatSeconds = (milliseconds: number | null) =>
  milliseconds === null ? '—' : `${(milliseconds / 1000).toFixed(1)} s`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Vista del avance del jugador en el Mundo 1. Solo muestra lo que devuelve la API; no calcula nada del juego. */
export function ProgressPage() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.worlds(),
      api.worldProgress(ARITHMETIC_WORLD_SLUG),
      api.worldScore(ARITHMETIC_WORLD_SLUG, RECENT_LIMIT),
      api.worldAttempts(ARITHMETIC_WORLD_SLUG, RECENT_LIMIT),
    ])
      .then(([worlds, progress, score, attempts]) => {
        if (cancelled) return;
        setData({
          world: worlds.find((item) => item.slug === ARITHMETIC_WORLD_SLUG),
          progress,
          score,
          attempts: attempts.items,
        });
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'No se pudo cargar tu progreso.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = () => {
    setError(null);
    setReloadKey((key) => key + 1);
  };

  if (error) {
    return (
      <ScreenMessage title="No pudimos cargar tu progreso">
        <p>{error}</p>
        <button type="button" onClick={retry}>
          Reintentar
        </button>
      </ScreenMessage>
    );
  }
  if (!data) return <ScreenMessage title="Cargando tu progreso…" />;

  const { world, progress, score, attempts } = data;
  const stats = progress.statistics;
  const started = stats.attemptsCount > 0;
  const challengeCount = world?.challengeCount ?? progress.challengeCount;
  const position = progress.status === 'COMPLETED' ? challengeCount : progress.currentPosition;

  // Descripción de las reglas que el jugador ya descubrió; las demás no se nombran (la API no las expone).
  const describedRules = new Map(progress.unlockedRules.map((rule) => [rule.key, rule.description]));
  const violated = Object.entries(stats.ruleViolationCounts)
    .flatMap(([key, count]) => {
      const description = describedRules.get(key);
      return description ? [{ key, description, count }] : [];
    })
    .sort((a, b) => b.count - a.count);

  return (
    <main className={styles.page}>
      <InsightsHeader activePage="progress" />
      <div className={styles.content}>
        <header className={styles.intro}>
          <span className={styles.eyebrow}>
            <Sparkles size={14} /> TU RECORRIDO
          </span>
          <h1>Mi progreso</h1>
          <p>{world ? `Mundo ${world.position} · ${world.name}` : 'Mundo 1'}</p>
        </header>

        <section className={styles.card} aria-label="Resumen">
          <div className={styles.metrics}>
            <div>
              <small>
                <Trophy size={13} /> Puntos
              </small>
              <strong>{progress.totalPoints}</strong>
            </div>
            <div>
              <small>
                <Flame size={13} /> Racha
              </small>
              <strong>{progress.streak}</strong>
            </div>
            <div>
              <small>Mejor racha</small>
              <strong>{progress.bestStreak}</strong>
            </div>
            <div>
              <small>Próximo acierto</small>
              <strong>×{progress.nextMultiplier}</strong>
            </div>
          </div>
          <p className={styles.position}>
            Desafío{' '}
            <strong>
              {position}/{challengeCount}
            </strong>
            {progress.status === 'COMPLETED' && ' · Mundo completado'}
          </p>
          <Link to="/juego" className={styles.play}>
            <Play size={17} fill="currentColor" />
            {progress.status === 'COMPLETED' ? 'Jugar de nuevo' : started ? 'Continuar' : 'Jugar'}
          </Link>
        </section>

        {!started ? (
          <p className={styles.empty} role="status">
            Aún no has jugado. Cuando respondas tu primer desafío aparecerá aquí tu avance.
          </p>
        ) : (
          <>
            <section className={styles.card} aria-labelledby="stats-title">
              <h2 id="stats-title">Estadísticas</h2>
              <dl className={styles.stats}>
                <div>
                  <dt>Intentos</dt>
                  <dd>{stats.attemptsCount}</dd>
                </div>
                <div>
                  <dt>Aciertos</dt>
                  <dd>{stats.correctCount}</dd>
                </div>
                <div>
                  <dt>Fallos</dt>
                  <dd>{stats.incorrectCount}</dd>
                </div>
                <div>
                  <dt>Sin tiempo</dt>
                  <dd>{stats.timeoutCount}</dd>
                </div>
                <div>
                  <dt>Tiempo medio</dt>
                  <dd>{formatSeconds(stats.averageCorrectElapsedMs)}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.card} aria-labelledby="rules-title">
              <h2 id="rules-title">Reglas descubiertas ({progress.unlockedRules.length})</h2>
              {progress.unlockedRules.length === 0 ? (
                <p className={styles.muted}>Todavía ninguna.</p>
              ) : (
                <ul className={styles.rules}>
                  {progress.unlockedRules.map((rule) => (
                    <li key={rule.key}>
                      <Sparkles size={13} aria-hidden="true" /> {rule.description}
                    </li>
                  ))}
                </ul>
              )}
              {violated.length > 0 && (
                <div className={styles.violated}>
                  <small>REGLAS QUE MÁS SE TE ESCAPAN</small>
                  <ul aria-label="Reglas incumplidas">
                    {violated.map((rule) => (
                      <li key={rule.key}>
                        <span>{rule.description}</span>
                        <b>{rule.count}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className={styles.card} aria-labelledby="attempts-title">
              <h2 id="attempts-title">Últimos intentos</h2>
              {attempts.length === 0 ? (
                <p className={styles.muted}>No hay intentos para mostrar.</p>
              ) : (
                <ol className={styles.attempts}>
                  {attempts.map((attempt) => (
                    <li key={attempt.attemptId} data-outcome={attempt.outcome}>
                      <div className={styles.attemptMain}>
                        <span className={styles.attemptChallenge}>
                          Desafío {attempt.position} · <code>{attempt.expression}</code>
                        </span>
                        <span className={styles.attemptAnswer}>
                          Tu respuesta: {attempt.submission ? <code>{attempt.submission}</code> : '—'}
                        </span>
                        <time dateTime={attempt.startedAt}>{formatDate(attempt.startedAt)}</time>
                      </div>
                      <div className={styles.attemptResult}>
                        <span className={styles.outcome}>{OUTCOME_LABEL[attempt.outcome]}</span>
                        <strong>{attempt.pointsAwarded > 0 ? `+${attempt.pointsAwarded}` : '0'}</strong>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {score.recentTransactions.length > 0 && (
              <section className={styles.card} aria-labelledby="ledger-title">
                <h2 id="ledger-title">Últimos puntos ganados</h2>
                <ul className={styles.ledger}>
                  {score.recentTransactions.map((transaction) => (
                    <li key={transaction.id}>
                      <strong>+{transaction.points}</strong>
                      <span>
                        {transaction.basePoints} × {transaction.multiplier} · racha {transaction.streakAfter}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
