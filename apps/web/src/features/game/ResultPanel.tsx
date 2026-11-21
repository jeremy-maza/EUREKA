import { Link } from 'react-router';
import type { AnswerResult } from '../../api/types';

interface Props {
  result: AnswerResult;
  busy: boolean;
  onContinue(): void;
}

/** Retroalimentación inmediata tras responder (o agotar el tiempo). */
export function ResultPanel({ result, busy, onContinue }: Props) {
  const correct = result.outcome === 'CORRECT';
  const title = correct
    ? result.worldCompleted
      ? '¡Mundo completado!'
      : '¡Correcto!'
    : result.outcome === 'TIMEOUT'
      ? 'Se acabó el tiempo'
      : 'Respuesta incorrecta';

  return (
    <article className={correct ? 'card result result--ok' : 'card result result--fail'}>
      <h2 aria-live="polite">{title}</h2>
      <p>{result.message}</p>

      {result.evaluatedValue !== null && !correct && (
        <p className="muted">
          Tu expresión vale <strong>{result.evaluatedValue}</strong>.
        </p>
      )}

      {result.violations.length > 0 && (
        <ul className="violations" aria-label="Reglas incumplidas">
          {result.violations.map((v) => (
            <li key={v.ruleKey}>
              <strong>{v.description}</strong> {v.message}
            </li>
          ))}
        </ul>
      )}

      {correct && (
        <p className="points">
          +{result.score.points} puntos{' '}
          <span className="muted">
            ({result.score.basePoints} × {result.score.multiplier})
          </span>
        </p>
      )}
      {correct && result.unlockedRule && (
        <p className="alert alert--info">
          Regla desbloqueada: <strong>{result.unlockedRule.description}</strong> Seguirá activa desde ahora.
        </p>
      )}
      {!correct && (
        <p className="alert alert--warn">
          Tu racha vuelve a 0 y la secuencia se reinicia. Conservas tus puntos y las{' '}
          <strong>{result.progress.unlockedRules.length}</strong> regla(s) ya desbloqueadas.
        </p>
      )}

      <div className="actions">
        <button type="button" className="button" onClick={onContinue} disabled={busy}>
          {busy
            ? 'Cargando…'
            : correct
              ? result.worldCompleted
                ? 'Jugar de nuevo'
                : 'Siguiente reto'
              : 'Reiniciar secuencia'}
        </button>
        <Link to="/progreso" className="button button--ghost">
          Ver mi progreso
        </Link>
      </div>
    </article>
  );
}
