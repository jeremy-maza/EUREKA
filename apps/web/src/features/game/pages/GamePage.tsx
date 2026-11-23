import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Clock, Lock, RotateCcw, Send, Sparkles, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_WORLD_SLUG, worldAccentStyle } from '@/lib/worlds';
import { FloatingIsland } from '@/components/ui/FloatingIsland';
import { DifficultyBadge } from '@/components/common/DifficultyBadge';
import { Grasshopper, type PlatformPosition } from '@/features/game/components/Grasshopper';
import { api, ApiError } from '@/services/api/client';
import {
  describeFailure,
  describeSuccess,
  describeTimeout,
  type Failure,
  isAnswerResult,
  isRuleMastered,
  isWorldProgress,
  type Success,
} from '@/features/game/feedback';
import type {
  ChallengeAttempt,
  MathSyntax,
  Rule,
  WorldProgress,
  WorldRef,
  WorldSummary,
} from '@/services/api/types';
import { Logo } from '@/components/ui/Logo';
import { ScreenMessage } from '@/components/ui/ScreenMessage';
import styles from './GamePage.module.css';

type Feedback = 'idle' | 'success' | 'error';

type Scoreboard = {
  totalPoints: number;
  streak: number;
  nextMultiplier: string;
};

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

/** Solo presentación: el servidor usa `*` y `/`, pero también acepta `×` y `÷`. */
const formatExpression = (expression: string) => expression.replace(/\*/g, '×').replace(/\//g, '÷');

/** Símbolos que acepta el servidor en este mundo (además de los dígitos). Solo informativo: valida el servidor. */
type SyntaxChip = { symbol: string; name: string; word?: string };

function syntaxChips(syntax: MathSyntax | undefined): SyntaxChip[] {
  const chips: SyntaxChip[] = [
    { symbol: '+', name: 'suma' },
    { symbol: '−', name: 'resta' },
    { symbol: '×', name: 'multiplicación (también *)' },
    { symbol: '÷', name: 'división (también /)' },
    { symbol: '( )', name: 'paréntesis' },
  ];
  if (syntax?.decimals) chips.push({ symbol: ', .', name: 'decimales con coma o punto', word: 'decimales' });
  if (syntax?.powers) chips.push({ symbol: '^', name: 'potencia (signo ^)', word: 'potencias' });
  return chips;
}

/**
 * Ruta de islas: una por reto más la de llegada, alternando lados y ascendiendo. La longitud de cada secuencia la
 * decide el servidor. Un escenario ilustrado trae sus propias 5 islas (84/68/52/36/24 %): con él se usa esa ruta.
 */
const ILLUSTRATED_ROUTE: PlatformPosition[] = [
  { side: 'left', x: 29, top: 84 },
  { side: 'right', x: 71, top: 68 },
  { side: 'left', x: 29, top: 52 },
  { side: 'right', x: 71, top: 36 },
  { side: 'left', x: 29, top: 24 },
];

function routeFor(challengeCount: number, illustrated: boolean): PlatformPosition[] {
  if (illustrated) return ILLUSTRATED_ROUTE;
  const stops = Math.max(challengeCount, 1) + 1;
  return Array.from({ length: stops }, (_, index) => ({
    side: index % 2 === 0 ? 'left' : 'right',
    x: index % 2 === 0 ? 29 : 71,
    top: Math.round(84 - (index * 60) / (stops - 1)),
  }));
}

const platformForPosition = (position: number, route: PlatformPosition[]) =>
  Math.min(Math.max(position - 1, 0), route.length - 1);

const backgroundFiles = import.meta.glob('../../../assets/backgrounds/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});
const backgroundFor = (slug: string) =>
  Object.entries(backgroundFiles).find(([path]) => path.endsWith(`/${slug}-background.png`))?.[1] as
    string | undefined;

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Ocurrió un error inesperado. Inténtalo de nuevo.';

type Phase = 'loading' | 'error' | 'ready' | 'missing' | 'locked';
type LockInfo = { message: string; requirement: WorldProgress['unlockRequirement'] };
type Entry = { phase: Phase; world: WorldSummary | null; lock?: LockInfo; error?: string };

/** Partida en el mundo de la URL (`/juego/:slug`). Se vuelve a montar al cambiar de mundo. */
export function GamePage() {
  const { slug = DEFAULT_WORLD_SLUG } = useParams();
  return <WorldGame key={slug} slug={slug} />;
}

function WorldGame({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [world, setWorld] = useState<WorldSummary | null>(null);
  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null);
  const [attempt, setAttempt] = useState<ChallengeAttempt | null>(null);
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isSettlingTimeout, setIsSettlingTimeout] = useState(false);
  /** La regla nueva del reto ya estaba entre las dominadas (solo cambia el texto del aviso). */
  const [isNewRuleMastered, setIsNewRuleMastered] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [playerPlatform, setPlayerPlatform] = useState(0);
  const [jumpTargetIndex, setJumpTargetIndex] = useState<number | null>(null);
  const [hasJumped, setHasJumped] = useState(false);
  const [answer, setAnswer] = useState('');
  const answerInputRef = useRef<HTMLInputElement>(null);
  const restartButtonRef = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState<Feedback>('idle');
  const [discoveredRule, setDiscoveredRule] = useState<Rule | null>(null);
  const [isRuleToastLeaving, setIsRuleToastLeaving] = useState(false);
  const [hasExpiredNotice, setHasExpiredNotice] = useState(false);
  const [isExpiredNoticeLeaving, setIsExpiredNoticeLeaving] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const isSubmittingRef = useRef(false);
  const settlingRef = useRef(false);
  const completedRef = useRef(false);
  const nextWorldRef = useRef<WorldRef | null>(null);
  const attemptRef = useRef<ChallengeAttempt | null>(null);
  /** Reglas dominadas según el último progreso recibido del servidor. */
  const masteredRef = useRef<WorldProgress['unlockedRules']>([]);
  const backgroundUrl = backgroundFor(slug);
  const route = routeFor(attempt?.challengeCount ?? 4, !!backgroundUrl);

  const isGameOver = failure !== null;
  const isBusy = isSubmitting || isLoadingNext || isRestarting || isSettlingTimeout;

  /** Carga en pantalla un reto devuelto por el servidor (el tiempo restante lo fija el servidor). */
  const applyAttempt = useCallback(
    (next: ChallengeAttempt, syncPlatform: boolean) => {
      // `newRule` es la regla que este reto suma a la secuencia; puede que el jugador ya la dominara de antes.
      attemptRef.current = next;
      setAttempt(next);
      setIsNewRuleMastered(
        next.newRule !== null && isRuleMastered(next.newRule, { unlockedRules: masteredRef.current }),
      );
      setDeadline(Date.now() + next.remainingMs);
      setRemainingSeconds(Math.ceil(next.remainingMs / 1000));
      setAnswer('');
      setFeedback('idle');
      setFailure(null);
      setSuccess(null);
      setRestartError(null);
      setSubmitError(null);
      setHasJumped(false);
      if (syncPlatform) {
        setPlayerPlatform(platformForPosition(next.position, routeFor(next.challengeCount, !!backgroundUrl)));
      }
      if (next.newRule) {
        setIsRuleToastLeaving(false);
        setDiscoveredRule(next.newRule);
      } else {
        setDiscoveredRule(null);
      }
    },
    [backgroundUrl],
  );

  const applyScore = useCallback((progress: WorldProgress) => {
    masteredRef.current = progress.unlockedRules;
    setScoreboard({
      totalPoints: progress.totalPoints,
      streak: progress.streak,
      nextMultiplier: progress.nextMultiplier,
    });
  }, []);

  /** Abre (o reanuda) la sesión del mundo y el reto actual. Devuelve `false` si una carga más reciente la reemplazó. */
  const startRun = useCallback(async () => {
    const runId = ++runRef.current;
    const { session, expiredAttempt } = await api.startSession(slug);
    const first = await api.startAttempt(session.id);
    const progress = await api.worldProgress(slug);
    if (runRef.current !== runId) return false;
    sessionIdRef.current = session.id;
    completedRef.current = false;
    nextWorldRef.current = null;
    applyScore(progress);
    applyAttempt(first, true);
    // Un reto que venció mientras el jugador estaba ausente lo cierra el servidor al entrar: se le avisa.
    setIsExpiredNoticeLeaving(false);
    setHasExpiredNotice(expiredAttempt !== null);
    return true;
  }, [applyAttempt, applyScore, slug]);

  /**
   * Entrada al mundo: primero se comprueba que exista; después se abre la sesión. Un mundo bloqueado lo rechaza el
   * servidor con 403 (con su mensaje); entonces se pide el progreso para saber qué mundo hay que completar.
   * Devuelve `null` si una carga más reciente la reemplazó.
   */
  const enterWorld = useCallback(async (): Promise<Entry | null> => {
    let found: WorldSummary | null = null;
    try {
      const worlds = await api.worlds();
      found = worlds.find((item) => item.slug === slug) ?? null;
      if (!found) return { phase: 'missing', world: null };
      const applied = await startRun();
      return applied ? { phase: 'ready', world: found } : null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        const requirement = await api
          .worldProgress(slug)
          .then((progress) => progress.unlockRequirement ?? null)
          .catch(() => null);
        return { phase: 'locked', world: found, lock: { message: error.message, requirement } };
      }
      return { phase: 'error', world: found, error: errorMessage(error) };
    }
  }, [slug, startRun]);

  const applyEntry = useCallback((entry: Entry | null) => {
    if (!entry) return;
    setWorld(entry.world);
    if (entry.lock) setLockInfo(entry.lock);
    if (entry.error) setLoadError(entry.error);
    setPhase(entry.phase);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void enterWorld().then((entry) => {
      if (!cancelled) applyEntry(entry);
    });
    return () => {
      cancelled = true;
      runRef.current += 1;
    };
  }, [enterWorld, applyEntry]);

  useEffect(() => {
    if (phase === 'ready' && !isBusy && !isGameOver && feedback !== 'success')
      answerInputRef.current?.focus();
  }, [phase, attempt?.attemptId, isBusy, isGameOver, feedback]);

  // Al terminar la secuencia, el foco pasa al diálogo (a su acción principal).
  useEffect(() => {
    if (isGameOver) restartButtonRef.current?.focus();
  }, [isGameOver]);

  /**
   * El reloj local solo es informativo: al llegar a 0 se consulta al servidor, que decide si venció. Si lo cerró por
   * tiempo, el resultado y el progreso se leen del servidor (nada se liquida ni se calcula aquí). Solo una
   * comprobación a la vez: `settlingRef` evita peticiones duplicadas aunque el temporizador se vuelva a armar.
   */
  const checkDeadlineWithServer = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const expectedAttempt = attemptRef.current;
    if (!sessionId || !expectedAttempt || settlingRef.current) return;
    settlingRef.current = true;
    setIsSettlingTimeout(true);
    try {
      const current = await api.currentAttempt(sessionId);
      if (current !== null) {
        if (current.attemptId === expectedAttempt.attemptId) {
          setDeadline(Date.now() + current.remainingMs);
        } else {
          // El servidor trabaja con otro reto distinto del que se muestra: se vuelve a sincronizar todo.
          await startRun();
        }
        return;
      }
      // Sin reto abierto: se confirma con el servidor cómo se cerró antes de decir nada al jugador.
      const [history, progress] = await Promise.all([api.worldAttempts(slug, 1), api.worldProgress(slug)]);
      if (!isWorldProgress(progress)) {
        throw new ApiError(0, 'Recibimos una respuesta inesperada del servidor. Inténtalo de nuevo.');
      }
      const closed = history?.items?.[0];
      if (closed?.attemptId === expectedAttempt.attemptId && closed.outcome === 'TIMEOUT') {
        applyScore(progress);
        setDeadline(null);
        setRemainingSeconds(0);
        setSubmitError(null);
        setFailure(describeTimeout(progress, expectedAttempt.newRule, expectedAttempt.rules));
      } else {
        // Se cerró de otra forma (p. ej. se respondió desde otra pestaña): no es un timeout, se resincroniza.
        await startRun();
      }
    } catch (error) {
      setSubmitError(errorMessage(error));
      setDeadline(Date.now() + 2000);
    } finally {
      settlingRef.current = false;
      setIsSettlingTimeout(false);
    }
  }, [applyScore, startRun, slug]);

  useEffect(() => {
    if (deadline === null || phase !== 'ready' || isGameOver || feedback === 'success') return;

    let expired = false;
    const updateCountdown = () => {
      const millisecondsLeft = Math.max(deadline - Date.now(), 0);
      setRemainingSeconds(Math.ceil(millisecondsLeft / 1000));
      if (millisecondsLeft > 0 || expired || isSubmittingRef.current) return;
      expired = true;
      void checkDeadlineWithServer();
    };

    const interval = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(interval);
  }, [deadline, phase, isGameOver, feedback, checkDeadlineWithServer]);

  useEffect(() => {
    if (feedback !== 'success' || jumpTargetIndex !== null || hasJumped) return;

    const timer = window.setTimeout(() => {
      setHasJumped(true);
      setJumpTargetIndex(Math.min(playerPlatform + 1, route.length - 1));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [feedback, jumpTargetIndex, hasJumped, playerPlatform, route.length]);

  useEffect(() => {
    if (!discoveredRule) return;

    const leaveTimer = window.setTimeout(() => setIsRuleToastLeaving(true), 2800);
    const removeTimer = window.setTimeout(() => setDiscoveredRule(null), 3100);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
  }, [discoveredRule]);

  useEffect(() => {
    if (!hasExpiredNotice) return;

    const leaveTimer = window.setTimeout(() => setIsExpiredNoticeLeaving(true), 6000);
    const removeTimer = window.setTimeout(() => setHasExpiredNotice(false), 6300);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
  }, [hasExpiredNotice]);

  const checkAnswer = async () => {
    if (
      !attempt ||
      feedback === 'success' ||
      jumpTargetIndex !== null ||
      isBusy ||
      isGameOver ||
      isSubmittingRef.current ||
      settlingRef.current
    )
      return;

    if (!answer.trim()) {
      setFeedback('error');
      answerInputRef.current?.focus();
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.answer(attempt.attemptId, answer.trim());
      if (!isAnswerResult(result)) {
        throw new ApiError(0, 'Recibimos una respuesta inesperada del servidor. Inténtalo de nuevo.');
      }
      applyScore(result.progress);
      setDeadline(null);
      if (result.outcome === 'CORRECT') {
        completedRef.current = result.worldCompleted === true;
        nextWorldRef.current = result.nextWorldUnlocked ?? null;
        setSuccess(describeSuccess(result));
        setFeedback('success');
      } else {
        setFailure(describeFailure(result, attempt.newRule, attempt.rules));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // El reto ya se resolvió con otra respuesta (otra pestaña): se vuelve a sincronizar con el servidor.
        setIsLoadingNext(true);
        try {
          await startRun();
        } catch (syncError) {
          setSubmitError(errorMessage(syncError));
        } finally {
          setIsLoadingNext(false);
        }
      } else {
        setSubmitError(errorMessage(error));
        // Si el plazo local ya pasó, que el servidor lo confirme.
        setDeadline((current) => (current !== null && current <= Date.now() ? Date.now() : current));
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const loadNextChallenge = async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    setIsLoadingNext(true);
    try {
      applyAttempt(await api.startAttempt(sessionId), false);
    } catch (error) {
      setLoadError(errorMessage(error));
      setPhase('error');
    } finally {
      setIsLoadingNext(false);
    }
  };

  const handleJumpLanded = () => {
    if (jumpTargetIndex === null) return;

    setPlayerPlatform(jumpTargetIndex);
    setJumpTargetIndex(null);

    if (completedRef.current) {
      navigate(`/final/${slug}`, { state: { nextWorldUnlocked: nextWorldRef.current } });
      return;
    }

    void loadNextChallenge();
  };

  const restartGame = async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    setRestartError(null);
    try {
      await startRun();
    } catch (error) {
      setRestartError(errorMessage(error));
    } finally {
      setIsRestarting(false);
    }
  };

  const retryLoad = () => {
    setPhase('loading');
    void enterWorld().then(applyEntry);
  };

  if (phase === 'loading') return <ScreenMessage title="Preparando el mundo…" />;

  if (phase === 'missing') {
    return (
      <ScreenMessage title="No encontramos ese mundo">
        <p>Puede que el enlace no sea correcto. Elige un mundo en el mapa.</p>
        <button type="button" onClick={() => navigate('/')}>
          Volver al mapa
        </button>
      </ScreenMessage>
    );
  }

  if (phase === 'locked') {
    const requirement = lockInfo?.requirement ?? null;
    return (
      <ScreenMessage title={world ? `El Mundo ${world.position} está bloqueado` : 'Mundo bloqueado'}>
        <span className={styles.lockedEmblem} aria-hidden="true">
          <Lock size={22} />
        </span>
        <p>{lockInfo?.message}</p>
        {requirement && (
          <button type="button" onClick={() => navigate(`/juego/${requirement.worldSlug}`)}>
            Ir al Mundo {requirement.position}
          </button>
        )}{' '}
        <button type="button" onClick={() => navigate('/')}>
          Volver al mapa
        </button>
      </ScreenMessage>
    );
  }

  if (phase === 'error' || !attempt) {
    return (
      <ScreenMessage title="No pudimos cargar el juego">
        <p>{loadError}</p>
        <button type="button" onClick={retryLoad}>
          Reintentar
        </button>{' '}
        <button type="button" onClick={() => navigate('/')}>
          Volver al inicio
        </button>
      </ScreenMessage>
    );
  }

  const timeLimit = attempt.timeLimitSeconds;
  const timerLevel = remainingSeconds <= 5 ? 'red' : remainingSeconds <= 10 ? 'yellow' : 'green';
  const statement = formatExpression(attempt.expression);
  const isEquation = attempt.statementKind === 'EQUATION';
  const instruction =
    attempt.instruction?.trim() ||
    (isEquation
      ? 'Escribe una expresión que valga x y cumpla todas las reglas'
      : 'Escribe una expresión con el mismo resultado que cumpla todas las reglas');
  const chips = syntaxChips(attempt.syntax ?? world?.syntax);
  const worldPosition = world?.position ?? 1;
  const keptRuleCount = failure?.kept.ruleCount;

  return (
    <main className={styles.page} style={worldAccentStyle(slug, worldPosition)}>
      <header className={styles.header}>
        <Logo compact />
        <div className={styles.worldName}>
          <span className={styles.worldDot} />
          <span>MUNDO {worldPosition}</span>
          <strong>{world?.name ?? attempt.worldSlug}</strong>
        </div>
        <div className={styles.challengeMeta}>
          <span>
            Desafío <strong>{attempt.position}</strong> de {attempt.challengeCount}
          </span>
          <div
            className={styles.progressBar}
            aria-label={`Progreso ${attempt.position} de ${attempt.challengeCount}`}
          >
            {Array.from({ length: attempt.challengeCount }, (_, index) => (
              <i key={index} className={index < attempt.position ? styles.complete : ''} />
            ))}
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Volver al inicio"
            disabled={feedback === 'success' || isBusy}
          >
            <ArrowLeft size={18} />
          </button>
        </div>
      </header>

      <div
        className={`${styles.timer} ${remainingSeconds <= 5 ? styles.timerUrgent : ''}`}
        data-level={timerLevel}
        role="timer"
        aria-label={`Tiempo restante ${formatTime(remainingSeconds)}`}
      >
        <div className={styles.timerReadout}>
          <span>TIEMPO</span>
          <strong>{formatTime(remainingSeconds)}</strong>
        </div>
        <div
          className={styles.timerTrack}
          role="progressbar"
          aria-label="Tiempo restante"
          aria-valuemin={0}
          aria-valuemax={timeLimit}
          aria-valuenow={remainingSeconds}
        >
          <span
            className={styles.timerProgress}
            style={{ width: `${Math.min((remainingSeconds / timeLimit) * 100, 100)}%` }}
          />
        </div>
      </div>

      <section className={styles.layout}>
        <aside
          className={`${styles.stage} ${backgroundUrl ? styles.illustratedStage : ''}`}
          style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined}
          aria-label="Escenario de plataformas del grillo"
        >
          <div className={styles.stageTrack}>
            {route.map((platform, index) => (
              <FloatingIsland
                key={`${platform.side}-${index}`}
                className={`${styles.stagePlatform} ${styles[`${platform.side}Island`]}`}
                top={platform.top}
              />
            ))}
            <Grasshopper
              position={route[Math.min(playerPlatform, route.length - 1)]}
              destination={jumpTargetIndex === null ? null : route[jumpTargetIndex]}
              onLand={handleJumpLanded}
            />
          </div>
        </aside>

        <article className={styles.challengeCard}>
          <div className={styles.challengeTopline}>
            <span className={styles.challengeBadge}>
              <Sparkles size={16} /> {isEquation ? 'ECUACIÓN' : 'DESAFÍO'}
            </span>
            {attempt.difficulty && <DifficultyBadge level={attempt.difficulty} />}
          </div>
          <h1
            data-long={statement.length > 8}
            aria-label={isEquation ? `Resuelve: ${statement}` : `Operación ${statement}`}
          >
            {isEquation && <span className={styles.statementLead}>Resuelve:</span>}
            {statement}
          </h1>
          <p id="challenge-instruction">{instruction}</p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void checkAnswer();
            }}
          >
            <label htmlFor="answer">Tu respuesta</label>
            <div
              className={`${styles.answerRow} ${isEquation ? styles.equationRow : ''} ${feedback === 'error' ? styles.answerError : ''}`}
            >
              {isEquation && (
                <span className={styles.answerPrefix} aria-hidden="true">
                  x =
                </span>
              )}
              <input
                id="answer"
                ref={answerInputRef}
                inputMode="text"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={200}
                value={answer}
                aria-invalid={feedback === 'error'}
                aria-describedby={`challenge-instruction${isEquation ? ' equation-hint' : ''} allowed-symbols`}
                onChange={(event) => {
                  setAnswer(event.target.value);
                  if (feedback !== 'idle') setFeedback('idle');
                }}
                placeholder={isEquation ? 'Una expresión que valga x' : 'Tu respuesta'}
                autoComplete="off"
                disabled={feedback === 'success' || isBusy || isGameOver}
              />
              <button
                type="submit"
                aria-label="Enviar respuesta"
                disabled={feedback === 'success' || isBusy || isGameOver}
              >
                <Send size={18} />
              </button>
            </div>
            {isEquation && (
              <p id="equation-hint" className={styles.equationHint}>
                Tu respuesta es una expresión cuyo valor es x.
              </p>
            )}
            <div className={styles.syntax} id="allowed-symbols">
              <span>Puedes usar</span>
              <ul aria-label="Símbolos permitidos">
                {chips.map((chip) => (
                  <li key={chip.symbol} title={chip.name}>
                    <kbd aria-hidden="true">{chip.symbol}</kbd>
                    {chip.word && <small aria-hidden="true">{chip.word}</small>}
                    <span className="sr-only">{chip.name}</span>
                  </li>
                ))}
              </ul>
            </div>
            {submitError && (
              <p className={styles.formError} role="alert">
                {submitError}
              </p>
            )}
          </form>

          {success && (
            <div
              className={styles.successNote}
              role="status"
              aria-live="polite"
              aria-label="Resultado del intento"
            >
              <strong>
                <Check size={15} aria-hidden="true" /> {success.message}
              </strong>
              <dl>
                <div>
                  <dt>Puntos ganados</dt>
                  <dd>+{success.points}</dd>
                </div>
                <div>
                  <dt>Multiplicador</dt>
                  <dd>×{success.multiplier}</dd>
                </div>
                <div>
                  <dt>Racha</dt>
                  <dd>{success.streak}</dd>
                </div>
              </dl>
              {success.unlockedRule && (
                <p>
                  Regla superada: {success.unlockedRule.description} Ya forma parte de tus reglas dominadas.
                </p>
              )}
              {success.worldCompleted && <p>¡Completaste el Mundo {worldPosition}!</p>}
              {success.nextWorldUnlocked && (
                <p className={styles.unlockNote}>
                  <Sparkles size={14} aria-hidden="true" /> Desbloqueaste el Mundo{' '}
                  {success.nextWorldUnlocked.position}: {success.nextWorldUnlocked.name}.
                </p>
              )}
            </div>
          )}

          <div className={styles.ruleBlock}>
            <ul className={styles.rules} aria-label="Reglas activas">
              {attempt.rules.map((rule) => {
                const isChallengeRule = rule.key === attempt.newRule?.key;
                return (
                  <li key={rule.key} className={isChallengeRule ? styles.ruleNew : ''}>
                    <span>{rule.description}</span>
                    {isChallengeRule && <b className={styles.ruleTag}>Nueva</b>}
                  </li>
                );
              })}
            </ul>
            {attempt.rules.length > 0 && (
              <p className={styles.ruleLegend}>
                {attempt.newRule
                  ? 'La regla nueva se suma a las de esta secuencia. Si fallas, la secuencia termina y sus reglas se descartan.'
                  : 'Son las reglas de esta secuencia. Si fallas, se descartan y la próxima secuencia sorteará otras.'}
              </p>
            )}
          </div>
        </article>
      </section>

      {scoreboard && (
        <div className={styles.scoreboard} aria-label="Puntuación">
          <span>
            PUNTOS <strong>{scoreboard.totalPoints}</strong>
          </span>
          <span>
            RACHA <strong>{scoreboard.streak}</strong>
          </span>
          <span>
            PRÓXIMO <strong>×{scoreboard.nextMultiplier}</strong>
          </span>
        </div>
      )}

      {discoveredRule && (
        <aside
          key={discoveredRule.key}
          className={`${styles.ruleToast} ${isRuleToastLeaving ? styles.ruleToastLeaving : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <Sparkles size={19} aria-hidden="true" />
          <div>
            <strong>NUEVA REGLA</strong>
            <p>{discoveredRule.description}</p>
            <p className={styles.ruleToastHint}>
              {isNewRuleMastered
                ? 'Ya la dominaste antes: ¡demuéstralo otra vez!'
                : 'Supera este desafío para sumarla a tus reglas dominadas.'}
            </p>
          </div>
        </aside>
      )}

      {hasExpiredNotice && (
        <aside
          className={`${styles.ruleToast} ${isExpiredNoticeLeaving ? styles.ruleToastLeaving : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <Clock size={19} aria-hidden="true" />
          <div>
            <strong>TIEMPO AGOTADO</strong>
            <p>
              Tu reto anterior venció mientras no estabas. Esa secuencia terminó y sus reglas se descartaron;
              conservas tus puntos y tus reglas dominadas.
            </p>
          </div>
        </aside>
      )}

      {failure && (
        <div
          className={styles.pauseOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="failure-title"
          aria-describedby="failure-message"
        >
          <div className={styles.pauseNote}>
            <h2 id="failure-title">{failure.title}</h2>
            <p id="failure-message">{failure.message}</p>
            {failure.violations.length > 0 && (
              <ul className={styles.violations}>
                {failure.violations.map((violation) => (
                  <li key={violation.ruleKey}>{violation.message}</li>
                ))}
              </ul>
            )}
            <section className={styles.discarded} aria-labelledby="discarded-title">
              <h3 id="discarded-title">
                <Trash2 size={13} aria-hidden="true" /> Reglas descartadas
              </h3>
              {failure.discardedRules.length > 0 ? (
                <ul aria-label="Reglas descartadas">
                  {failure.discardedRules.map((rule) => (
                    <li key={rule.key}>{rule.description}</li>
                  ))}
                </ul>
              ) : (
                <p>Esta secuencia aún no tenía reglas activas.</p>
              )}
            </section>
            {failure.lostNewRule && (
              <p className={styles.lifecycleNote}>
                Aún no dominas la regla nueva de este desafío: podrás superarla cuando vuelva a salir en una
                secuencia.
              </p>
            )}
            <section className={styles.restartInfo} aria-label="Qué conservas">
              <h3>Qué conservas</h3>
              <ul>
                <li>
                  Tus puntos: <strong>{failure.kept.totalPoints}</strong>.
                </li>
                <li>
                  Tus reglas dominadas:{' '}
                  <strong>
                    {failure.kept.masteredRules.length}
                    {typeof keptRuleCount === 'number' ? ` de ${keptRuleCount}` : ''}
                  </strong>
                  .
                </li>
                <li>
                  Tu racha vuelve a empezar: <strong>{failure.kept.streak}</strong>.
                </li>
              </ul>
              <p>La próxima secuencia sorteará reglas nuevas y empezará desde el desafío 1.</p>
            </section>
            {restartError && (
              <p className={styles.formError} role="alert">
                {restartError}
              </p>
            )}
            <button
              ref={restartButtonRef}
              type="button"
              onClick={() => void restartGame()}
              disabled={isRestarting}
            >
              <RotateCcw size={16} /> {isRestarting ? 'Preparando secuencia…' : 'Nueva secuencia'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
