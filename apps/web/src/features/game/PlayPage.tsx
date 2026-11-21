import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { AnswerResult, ChallengeAttempt, WorldProgress } from '../../api/types';
import { WORLDS } from '../worlds/worlds';
import { Playing } from './Playing';
import { ResultPanel } from './ResultPanel';
import { RuleList } from './RuleList';
import { ScoreBar } from './ScoreBar';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'intro' }
  | { kind: 'playing'; attempt: ChallengeAttempt }
  | { kind: 'result'; result: AnswerResult };

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Ocurrió un error inesperado.';
}

/** Pantalla de juego de un mundo: introducción → reto con temporizador → resultado → siguiente reto. */
export function PlayPage() {
  const { slug = 'arithmetic' } = useParams();
  const world = WORLDS.find((w) => w.slug === slug);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [progress, setProgress] = useState<WorldProgress | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    if (!world?.available) return;
    let cancelled = false;
    api
      .worldProgress(slug)
      .then((loaded) => {
        if (cancelled) return;
        setProgress(loaded);
        setPhase({ kind: 'intro' });
      })
      .catch((e: unknown) => {
        if (!cancelled) setPhase({ kind: 'error', message: messageOf(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, world, loadKey]);

  function retryLoad() {
    setPhase({ kind: 'loading' });
    setLoadKey((k) => k + 1);
  }

  /** Abre (o reanuda) la sesión y arranca el reto actual: el cronómetro del servidor empieza aquí. */
  async function begin() {
    setStarting(true);
    setActionError(null);
    try {
      const { session } = await api.startSession(slug);
      const attempt = await api.startAttempt(session.id);
      setNotice(
        attempt.expiredAttempt
          ? 'Tu reto anterior venció mientras no estabas: la secuencia se reinició (conservas tus reglas).'
          : null,
      );
      setPhase({ kind: 'playing', attempt });
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setStarting(false);
    }
  }

  const onResult = useCallback((result: AnswerResult) => {
    setProgress(result.progress);
    setNotice(null);
    setPhase({ kind: 'result', result });
  }, []);

  if (!world || !world.available) {
    return (
      <section>
        <h1>Mundo no disponible</h1>
        <p>
          Por ahora solo está disponible el Mundo 1. <Link to="/mundos">Volver a los mundos</Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>Mundo 1: {world.name}</h1>
      {progress && phase.kind !== 'loading' && phase.kind !== 'error' && <ScoreBar progress={progress} />}

      {phase.kind === 'loading' && <p role="status">Cargando tu partida…</p>}

      {phase.kind === 'error' && (
        <div className="alert alert--error" role="alert">
          <p>{phase.message}</p>
          <button type="button" className="button" onClick={retryLoad}>
            Reintentar
          </button>
        </div>
      )}

      {phase.kind === 'intro' && progress && (
        <Intro progress={progress} busy={starting} error={actionError} onStart={() => void begin()} />
      )}

      {phase.kind === 'playing' && (
        <>
          {notice && (
            <p className="alert alert--warn" role="status">
              {notice}
            </p>
          )}
          {/* `key` reinicia el temporizador y el campo de texto en cada reto nuevo */}
          <Playing key={phase.attempt.attemptId} attempt={phase.attempt} onResult={onResult} />
        </>
      )}

      {phase.kind === 'result' && (
        <>
          <ResultPanel result={phase.result} busy={starting} onContinue={() => void begin()} />
          {actionError && (
            <p className="alert alert--error" role="alert">
              {actionError}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Intro({
  progress,
  busy,
  error,
  onStart,
}: {
  progress: WorldProgress;
  busy: boolean;
  error: string | null;
  onStart(): void;
}) {
  const label = busy
    ? 'Preparando…'
    : progress.pendingAttemptId
      ? 'Continuar reto en curso'
      : progress.statistics.attemptsCount === 0
        ? 'Empezar a jugar'
        : progress.status === 'COMPLETED'
          ? 'Jugar de nuevo'
          : 'Jugar';

  return (
    <div className="card">
      <h2>Cómo se juega</h2>
      <ul className="how-to">
        <li>Cada reto es una operación. Escribe una expresión que dé el mismo resultado.</li>
        <li>Cada reto superado suma una regla nueva; todas las anteriores siguen activas.</li>
        <li>Tienes tiempo limitado. Un error, una regla rota o el tiempo agotado terminan la secuencia.</li>
        <li>
          Si fallas, vuelves al reto 1 sin perder puntos ni reglas. Los aciertos seguidos multiplican tus
          puntos (hasta ×5).
        </li>
      </ul>

      <h3>Reglas que ya has desbloqueado</h3>
      {progress.unlockedRules.length === 0 ? (
        <p className="muted">Ninguna todavía. ¡Supera retos para ganarlas!</p>
      ) : (
        <RuleList rules={progress.unlockedRules} />
      )}

      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="button" onClick={onStart} disabled={busy}>
          {label}
        </button>
        <Link to="/progreso" className="button button--ghost">
          Ver mi progreso
        </Link>
      </div>
    </div>
  );
}
