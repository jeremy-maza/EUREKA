import { useEffect, useState } from 'react';
import { Flame, Lock, Play, Sparkles, Trophy } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { isCompleted, pickRecentWorld, progressOf, unlockHint, worldAccentStyle } from '@/lib/worlds';
import { useWorldCatalog } from '@/lib/useWorldCatalog';
import { api, ApiError } from '@/services/api/client';
import type { AttemptHistoryItem, ScoreSummary, WorldProgress, WorldSummary } from '@/services/api/types';
import { DifficultyBadge } from '@/components/common/DifficultyBadge';
import { InsightsHeader } from '@/components/common/InsightsHeader';
import { WorldTabs } from '@/components/common/WorldTabs';
import { ScreenMessage } from '@/components/ui/ScreenMessage';
import styles from './ProgressPage.module.css';

const RECENT_LIMIT = 10;

/** Datos de un mundo concreto; se guardan con su slug para no mostrar los de otro mundo al cambiar de pestaña. */
type WorldHistory = { slug: string; score: ScoreSummary; attempts: AttemptHistoryItem[] };

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

/** «Mi progreso» por mundo (`/progreso/:slug?`). Solo muestra lo que devuelve la API; no calcula nada del juego. */
export function ProgressPage() {
  const { slug: slugParam } = useParams();
  const {
    catalog,
    error: catalogError,
    retry: retryCatalog,
  } = useWorldCatalog('No se pudo cargar tu progreso.');

  if (catalogError) {
    return (
      <ScreenMessage title="No pudimos cargar tu progreso">
        <p>{catalogError}</p>
        <button type="button" onClick={retryCatalog}>
          Reintentar
        </button>
      </ScreenMessage>
    );
  }
  if (!catalog) return <ScreenMessage title="Cargando tu progreso…" />;

  const slug = slugParam ?? pickRecentWorld(catalog.worlds, catalog.progress);
  const world = catalog.worlds.find((item) => item.slug === slug);
  const progress = progressOf(catalog.progress, slug);

  return (
    <main className={styles.page}>
      <InsightsHeader activePage="progress" />
      <div className={styles.content}>
        <header className={styles.intro}>
          <span className={styles.eyebrow}>
            <Sparkles size={14} aria-hidden="true" /> TU RECORRIDO
          </span>
          <h1>Mi progreso</h1>
          {world && (
            <p>
              Mundo {world.position} · {world.name}
            </p>
          )}
        </header>

        {catalog.worlds.length > 0 && (
          <WorldTabs
            worlds={catalog.worlds}
            progress={catalog.progress}
            activeSlug={slug}
            basePath="/progreso"
            label="Elige un mundo"
          />
        )}

        {!world || !progress ? (
          <section className={styles.card} role="status">
            <h2>No encontramos ese mundo</h2>
            <p className={styles.muted}>Elige uno de la lista o vuelve al mapa.</p>
            <Link to="/" className={styles.play}>
              Volver al mapa
            </Link>
          </section>
        ) : progress.unlocked === false ? (
          <section
            className={styles.card}
            aria-label="Resumen"
            style={worldAccentStyle(world.slug, world.position)}
          >
            <p className={styles.locked}>
              <Lock size={16} aria-hidden="true" /> {unlockHint(progress.unlockRequirement)}
            </p>
            {progress.unlockRequirement && (
              <Link to={`/progreso/${progress.unlockRequirement.worldSlug}`} className={styles.secondaryLink}>
                Ver el Mundo {progress.unlockRequirement.position}
              </Link>
            )}
          </section>
        ) : (
          <WorldProgressView key={slug} world={world} progress={progress} />
        )}
      </div>
    </main>
  );
}

function WorldProgressView({ world, progress }: { world: WorldSummary; progress: WorldProgress }) {
  const slug = world.slug;
  const [history, setHistory] = useState<WorldHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.worldScore(slug, RECENT_LIMIT), api.worldAttempts(slug, RECENT_LIMIT)])
      .then(([score, attempts]) => {
        if (!cancelled) setHistory({ slug, score, attempts: attempts.items });
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'No se pudo cargar tu progreso.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  const retry = () => {
    setError(null);
    setReloadKey((key) => key + 1);
  };

  const stats = progress.statistics;
  const started = stats.attemptsCount > 0;
  const completed = isCompleted(progress);
  const sequence = progress.activeSequence ?? null;
  const completions = progress.completionsCount ?? (progress.status === 'COMPLETED' ? 1 : 0);
  const ruleCount = progress.ruleCount ?? world.ruleCount;
  const score = history?.slug === slug ? history.score : null;
  const attempts = history?.slug === slug ? history.attempts : [];

  // Descripción de las reglas que el jugador ya domina; las demás no se nombran (la API no las expone).
  const describedRules = new Map(progress.unlockedRules.map((rule) => [rule.key, rule.description]));
  const violated = Object.entries(stats.ruleViolationCounts)
    .flatMap(([key, count]) => {
      const description = describedRules.get(key);
      return description ? [{ key, description, count }] : [];
    })
    .sort((a, b) => b.count - a.count);

  return (
    <div className={styles.worldView} style={worldAccentStyle(world.slug, world.position)}>
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
        <div className={styles.position}>
          {sequence ? (
            <span>
              Secuencia en curso: desafío{' '}
              <strong>
                {progress.currentPosition}/{sequence.challengeCount}
              </strong>{' '}
              <DifficultyBadge level={sequence.difficulty} />
            </span>
          ) : (
            <span>Sin secuencia en curso: la próxima sorteará sus reglas.</span>
          )}
          {completed && (
            <span>
              Mundo completado · {completions} {completions === 1 ? 'vez' : 'veces'}
            </span>
          )}
        </div>
        <Link to={`/juego/${slug}`} className={styles.play}>
          <Play size={17} fill="currentColor" aria-hidden="true" />
          {completed ? 'Jugar de nuevo' : started ? 'Continuar' : 'Jugar'}
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
            <h2 id="rules-title">
              Reglas dominadas ({progress.unlockedRules.length}/{ruleCount})
            </h2>
            <p className={styles.hint}>
              Cada regla que superas queda aquí para siempre, aunque después falles una secuencia.
            </p>
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
            {error ? (
              <div role="alert" className={styles.muted}>
                {error}{' '}
                <button type="button" className={styles.inlineButton} onClick={retry}>
                  Reintentar
                </button>
              </div>
            ) : !history || history.slug !== slug ? (
              <p className={styles.muted} role="status">
                Cargando historial…
              </p>
            ) : attempts.length === 0 ? (
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

          {score && score.recentTransactions.length > 0 && (
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
  );
}
