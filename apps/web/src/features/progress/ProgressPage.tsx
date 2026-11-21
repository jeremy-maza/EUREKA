import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { AttemptHistoryItem, ScoreSummary, WorldProgress } from '../../api/types';
import { RuleList } from '../game/RuleList';

const WORLD = 'arithmetic';

const OUTCOME_LABEL: Record<AttemptHistoryItem['outcome'], string> = {
  CORRECT: 'Correcto',
  INCORRECT: 'Incorrecto',
  TIMEOUT: 'Tiempo agotado',
  PENDING: 'En curso',
};

interface Data {
  progress: WorldProgress;
  score: ScoreSummary;
  attempts: AttemptHistoryItem[];
}

/** Vista simple del avance del jugador en el Mundo 1: puntos, racha, reglas, estadísticas e historial reciente. */
export function ProgressPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.worldProgress(WORLD), api.worldScore(WORLD, 5), api.worldAttempts(WORLD, 10)])
      .then(([progress, score, attempts]) => {
        if (!cancelled) setData({ progress, score, attempts: attempts.items });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Ocurrió un error inesperado.');
      });
    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  function retry() {
    setError(null);
    setData(null);
    setLoadKey((k) => k + 1);
  }

  if (error) {
    return (
      <section>
        <h1>Mi progreso</h1>
        <div className="alert alert--error" role="alert">
          <p>{error}</p>
          <button type="button" className="button" onClick={retry}>
            Reintentar
          </button>
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section>
        <h1>Mi progreso</h1>
        <p role="status">Cargando tu progreso…</p>
      </section>
    );
  }

  const { progress, score, attempts } = data;
  const stats = progress.statistics;
  const fresh = stats.attemptsCount === 0;

  return (
    <section>
      <h1>Mi progreso</h1>
      <h2>Mundo 1: Aritmética</h2>

      <dl className="scorebar scorebar--big">
        <div>
          <dt>Puntos totales</dt>
          <dd>{progress.totalPoints}</dd>
        </div>
        <div>
          <dt>Racha actual</dt>
          <dd>{progress.streak}</dd>
        </div>
        <div>
          <dt>Mejor racha</dt>
          <dd>{progress.bestStreak}</dd>
        </div>
        <div>
          <dt>Próximo multiplicador</dt>
          <dd>×{progress.nextMultiplier}</dd>
        </div>
      </dl>

      <p>
        <Link to={`/mundos/${WORLD}/jugar`} className="button">
          {fresh ? 'Empezar a jugar' : 'Seguir jugando'}
        </Link>
      </p>

      {fresh ? (
        <p className="card muted">
          Aún no has jugado. Cuando respondas tu primer reto aparecerá aquí tu avance.
        </p>
      ) : (
        <>
          <div className="card">
            <h3>Estadísticas</h3>
            <ul className="stats">
              <li>Intentos: {stats.attemptsCount}</li>
              <li>Correctos: {stats.correctCount}</li>
              <li>Incorrectos: {stats.incorrectCount}</li>
              <li>Tiempo agotado: {stats.timeoutCount}</li>
            </ul>
          </div>

          <div className="card">
            <h3>Reglas desbloqueadas ({progress.unlockedRules.length})</h3>
            {progress.unlockedRules.length === 0 ? (
              <p className="muted">Todavía ninguna.</p>
            ) : (
              <RuleList rules={progress.unlockedRules} />
            )}
          </div>

          <div className="card">
            <h3>Últimos intentos</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Reto</th>
                  <th>Resultado</th>
                  <th>Tu respuesta</th>
                  <th>Puntos</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.attemptId}>
                    <td>
                      #{a.position} <span className="muted">{a.expression}</span>
                    </td>
                    <td className={`outcome outcome--${a.outcome.toLowerCase()}`}>
                      {OUTCOME_LABEL[a.outcome]}
                    </td>
                    <td>{a.submission ?? '—'}</td>
                    <td>{a.pointsAwarded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {score.recentTransactions.length > 0 && (
            <div className="card">
              <h3>Últimos puntos ganados</h3>
              <ul className="stats">
                {score.recentTransactions.map((t) => (
                  <li key={t.id}>
                    +{t.points} ({t.basePoints} × {t.multiplier}) · racha {t.streakAfter}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
