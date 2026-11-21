import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import type { AnswerResult, ChallengeAttempt } from '../../api/types';
import { RuleList } from './RuleList';

/** Margen tras el plazo local antes de preguntar al servidor (que es quien decide si venció). */
const EXPIRY_GRACE_MS = 600;
const TICK_MS = 250;

function formatTime(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface Props {
  attempt: ChallengeAttempt;
  onResult(result: AnswerResult): void;
}

/**
 * Reto en curso. El tiempo restante lo fija el servidor (`remainingMs`); aquí solo se cuenta hacia atrás para
 * mostrarlo. Al llegar a cero se consulta al servidor: él cierra el reto por tiempo y entrega el resultado.
 */
export function Playing({ attempt, onResult }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadline = useRef<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(attempt.remainingMs);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  const settling = useRef(false);

  const submit = useCallback(
    async (expression: string) => {
      setBusy(true);
      setError(null);
      try {
        onResult(await api.answer(attempt.attemptId, expression));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'No se pudo enviar la respuesta.');
        setBusy(false);
      }
    },
    [attempt.attemptId, onResult],
  );

  // Cuenta atrás visible.
  useEffect(() => {
    deadline.current = Date.now() + attempt.remainingMs;
    const id = setInterval(() => setRemainingMs(Math.max(0, (deadline.current ?? 0) - Date.now())), TICK_MS);
    return () => clearInterval(id);
  }, [attempt.remainingMs]);

  // Expiración: el servidor confirma el TIMEOUT (o, si por desfase aún queda tiempo, se resincroniza).
  const expired = remainingMs <= 0;
  useEffect(() => {
    if (!expired) return;
    const id = setTimeout(() => {
      if (settling.current) return;
      settling.current = true;
      void (async () => {
        try {
          const current = await api.currentAttempt(attempt.sessionId);
          if (current && current.attemptId === attempt.attemptId && current.remainingMs > 0) {
            deadline.current = Date.now() + current.remainingMs;
            setRemainingMs(current.remainingMs);
            return;
          }
          // El servidor ya lo cerró por tiempo: reenviar devuelve el resultado original (TIMEOUT).
          await submit(textRef.current.trim() || '0');
        } catch (e) {
          setError(e instanceof ApiError ? e.message : 'No se pudo consultar el estado del reto.');
        } finally {
          settling.current = false;
        }
      })();
    }, EXPIRY_GRACE_MS);
    return () => clearTimeout(id);
  }, [expired, attempt.attemptId, attempt.sessionId, submit]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    void submit(text.trim());
  }

  const urgent = remainingMs <= 10_000;
  const fraction = Math.min(1, remainingMs / (attempt.timeLimitSeconds * 1000));

  return (
    <article className="card challenge" aria-labelledby="challenge-title">
      <header className="challenge-head">
        <h2 id="challenge-title">
          Reto {attempt.position} de {attempt.challengeCount}
        </h2>
        <div className={urgent ? 'timer timer--urgent' : 'timer'} role="timer" aria-label="Tiempo restante">
          {formatTime(remainingMs)}
        </div>
      </header>
      <div className="timer-bar" aria-hidden="true">
        <span style={{ width: `${fraction * 100}%` }} />
      </div>

      <p className="muted">Escribe una expresión cuyo valor sea el mismo que el de:</p>
      <p className="expression" data-testid="challenge-expression">
        {attempt.expression}
      </p>

      <h3>Reglas activas</h3>
      <RuleList rules={attempt.rules} newRuleKey={attempt.newRule?.key} />

      <form onSubmit={onSubmit} className="answer-form">
        <label htmlFor="answer">Tu expresión</label>
        <div className="answer-row">
          <input
            id="answer"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            maxLength={200}
            placeholder="p. ej. 7 * 1 * 3"
            value={text}
            disabled={busy || expired}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="button" disabled={busy || expired || !text.trim()}>
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
        <span className="hint">
          Usa números enteros, + − × ÷ y paréntesis. Un error termina la secuencia.
        </span>
      </form>
      {expired && !error && (
        <p className="alert alert--warn" role="status">
          Se acabó el tiempo; comprobando con el servidor…
        </p>
      )}
      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
