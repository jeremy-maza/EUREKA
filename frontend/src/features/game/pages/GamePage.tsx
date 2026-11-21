import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Clock, RotateCcw, Send, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ARITHMETIC_WORLD_SLUG } from '@/features/game/constants'
import { FloatingIsland } from '@/features/game/components/FloatingIsland'
import { Grasshopper } from '@/features/game/components/Grasshopper'
import { api, ApiError } from '@/shared/api/client'
import type { AnswerResult, ChallengeAttempt, Rule, Violation } from '@/shared/api/types'
import { Logo } from '@/shared/components/Logo'
import { ScreenMessage } from '@/shared/components/ScreenMessage'
import styles from './GamePage.module.css'

type Feedback = 'idle' | 'success' | 'error'

/** Fin de la secuencia decidido por el servidor: respuesta incorrecta, regla violada o tiempo agotado. */
type Failure = {
  title: string
  message: string
  violations: Violation[]
}

type Scoreboard = {
  totalPoints: number
  streak: number
  nextMultiplier: string
}

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainingSeconds}`
}

/** Solo presentación: el servidor usa `*` y `/`, pero también acepta `×` y `÷`. */
const formatExpression = (expression: string) => expression.replace(/\*/g, '×').replace(/\//g, '÷')

const describeFailure = (result: AnswerResult): Failure => ({
  title: result.outcome === 'TIMEOUT' ? '¡Tiempo agotado!' : '¡Secuencia terminada!',
  message: result.message,
  violations: result.violations,
})

const platformRoute = [
  { side: 'left', x: 29, top: 84 },
  { side: 'right', x: 71, top: 68 },
  { side: 'left', x: 29, top: 52 },
  { side: 'right', x: 71, top: 36 },
  { side: 'left', x: 29, top: 24 },
] as const

const platformForPosition = (position: number) => Math.min(Math.max(position - 1, 0), platformRoute.length - 1)

const backgroundFiles = import.meta.glob('../../../assets/backgrounds/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})
const backgroundUrl = Object.entries(backgroundFiles)
  .find(([path]) => path.endsWith('arithmetic-background.png'))?.[1] as string | undefined

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Ocurrió un error inesperado. Inténtalo de nuevo.'

export function GamePage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState<ChallengeAttempt | null>(null)
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [isRestarting, setIsRestarting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingNext, setIsLoadingNext] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [playerPlatform, setPlayerPlatform] = useState(0)
  const [jumpTargetIndex, setJumpTargetIndex] = useState<number | null>(null)
  const [hasJumped, setHasJumped] = useState(false)
  const [answer, setAnswer] = useState('')
  const answerInputRef = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const [discoveredRule, setDiscoveredRule] = useState<Rule | null>(null)
  const [isRuleToastLeaving, setIsRuleToastLeaving] = useState(false)
  const [hasExpiredNotice, setHasExpiredNotice] = useState(false)
  const [isExpiredNoticeLeaving, setIsExpiredNoticeLeaving] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const runRef = useRef(0)
  const isSubmittingRef = useRef(false)
  const completedRef = useRef(false)

  const isGameOver = failure !== null
  const isBusy = isSubmitting || isLoadingNext || isRestarting

  /** Carga en pantalla un reto devuelto por el servidor (el tiempo restante lo fija el servidor). */
  const applyAttempt = useCallback((next: ChallengeAttempt, syncPlatform: boolean) => {
    setAttempt(next)
    setDeadline(Date.now() + next.remainingMs)
    setRemainingSeconds(Math.ceil(next.remainingMs / 1000))
    setAnswer('')
    setFeedback('idle')
    setFailure(null)
    setSubmitError(null)
    setHasJumped(false)
    if (syncPlatform) setPlayerPlatform(platformForPosition(next.position))
    if (next.newRule) {
      setIsRuleToastLeaving(false)
      setDiscoveredRule(next.newRule)
    } else {
      setDiscoveredRule(null)
    }
  }, [])

  const applyScore = useCallback((progress: Scoreboard) => {
    setScoreboard({
      totalPoints: progress.totalPoints,
      streak: progress.streak,
      nextMultiplier: progress.nextMultiplier,
    })
  }, [])

  /** Abre (o reanuda) la sesión del mundo 1 y el reto actual. Devuelve `false` si una carga más reciente la reemplazó. */
  const startRun = useCallback(async () => {
    const runId = ++runRef.current
    const { session, expiredAttempt } = await api.startSession(ARITHMETIC_WORLD_SLUG)
    const first = await api.startAttempt(session.id)
    const progress = await api.worldProgress(ARITHMETIC_WORLD_SLUG)
    if (runRef.current !== runId) return false
    sessionIdRef.current = session.id
    completedRef.current = false
    applyAttempt(first, true)
    applyScore(progress)
    // Un reto que venció mientras el jugador estaba ausente lo cierra el servidor al entrar: se le avisa.
    setIsExpiredNoticeLeaving(false)
    setHasExpiredNotice(expiredAttempt !== null)
    return true
  }, [applyAttempt, applyScore])

  useEffect(() => {
    let cancelled = false
    startRun()
      .then((applied) => {
        if (!cancelled && applied) setPhase('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(errorMessage(error))
        setPhase('error')
      })
    return () => {
      cancelled = true
      runRef.current += 1
    }
  }, [startRun])

  useEffect(() => {
    if (phase === 'ready' && !isBusy && !isGameOver && feedback !== 'success') answerInputRef.current?.focus()
  }, [phase, attempt?.attemptId, isBusy, isGameOver, feedback])

  /** El reloj local solo es informativo: al llegar a 0 se consulta al servidor, que decide si venció. */
  const checkDeadlineWithServer = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    try {
      const current = await api.currentAttempt(sessionId)
      if (current === null) {
        // El servidor cerró el reto por tiempo y reinició la secuencia.
        setDeadline(null)
        setRemainingSeconds(0)
        setFailure({
          title: '¡Tiempo agotado!',
          message: 'El mundo comenzará de nuevo.',
          violations: [],
        })
        return
      }
      setDeadline(Date.now() + current.remainingMs)
    } catch {
      setDeadline(Date.now() + 2000)
    }
  }, [])

  useEffect(() => {
    if (deadline === null || phase !== 'ready' || isGameOver || feedback === 'success') return

    let expired = false
    const updateCountdown = () => {
      const millisecondsLeft = Math.max(deadline - Date.now(), 0)
      setRemainingSeconds(Math.ceil(millisecondsLeft / 1000))
      if (millisecondsLeft > 0 || expired || isSubmittingRef.current) return
      expired = true
      void checkDeadlineWithServer()
    }

    const interval = window.setInterval(updateCountdown, 250)
    return () => window.clearInterval(interval)
  }, [deadline, phase, isGameOver, feedback, checkDeadlineWithServer])

  useEffect(() => {
    if (feedback !== 'success' || jumpTargetIndex !== null || hasJumped) return

    const timer = window.setTimeout(() => {
      setHasJumped(true)
      setJumpTargetIndex(Math.min(playerPlatform + 1, platformRoute.length - 1))
    }, 350)

    return () => window.clearTimeout(timer)
  }, [feedback, jumpTargetIndex, hasJumped, playerPlatform])

  useEffect(() => {
    if (!discoveredRule) return

    const leaveTimer = window.setTimeout(() => setIsRuleToastLeaving(true), 2800)
    const removeTimer = window.setTimeout(() => setDiscoveredRule(null), 3100)

    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(removeTimer)
    }
  }, [discoveredRule])

  useEffect(() => {
    if (!hasExpiredNotice) return

    const leaveTimer = window.setTimeout(() => setIsExpiredNoticeLeaving(true), 6000)
    const removeTimer = window.setTimeout(() => setHasExpiredNotice(false), 6300)

    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(removeTimer)
    }
  }, [hasExpiredNotice])

  const checkAnswer = async () => {
    if (
      !attempt
      || feedback === 'success'
      || jumpTargetIndex !== null
      || isBusy
      || isGameOver
      || isSubmittingRef.current
    ) return

    if (!answer.trim()) {
      setFeedback('error')
      answerInputRef.current?.focus()
      return
    }

    isSubmittingRef.current = true
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const result = await api.answer(attempt.attemptId, answer.trim())
      applyScore(result.progress)
      setDeadline(null)
      if (result.outcome === 'CORRECT') {
        completedRef.current = result.worldCompleted
        setFeedback('success')
      } else {
        setFailure(describeFailure(result))
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // El reto ya se resolvió con otra respuesta (otra pestaña): se vuelve a sincronizar con el servidor.
        setIsLoadingNext(true)
        try {
          await startRun()
        } catch (syncError) {
          setSubmitError(errorMessage(syncError))
        } finally {
          setIsLoadingNext(false)
        }
      } else {
        setSubmitError(errorMessage(error))
        // Si el plazo local ya pasó, que el servidor lo confirme.
        setDeadline((current) => (current !== null && current <= Date.now() ? Date.now() : current))
      }
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  const loadNextChallenge = async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    setIsLoadingNext(true)
    try {
      applyAttempt(await api.startAttempt(sessionId), false)
    } catch (error) {
      setLoadError(errorMessage(error))
      setPhase('error')
    } finally {
      setIsLoadingNext(false)
    }
  }

  const handleJumpLanded = () => {
    if (jumpTargetIndex === null) return

    setPlayerPlatform(jumpTargetIndex)
    setJumpTargetIndex(null)

    if (completedRef.current) {
      navigate('/final')
      return
    }

    void loadNextChallenge()
  }

  const restartGame = async () => {
    if (isRestarting) return
    setIsRestarting(true)
    try {
      await startRun()
    } catch (error) {
      setFailure((current) => current && { ...current, message: errorMessage(error) })
    } finally {
      setIsRestarting(false)
    }
  }

  const retryLoad = () => {
    setPhase('loading')
    startRun()
      .then((applied) => {
        if (applied) setPhase('ready')
      })
      .catch((error: unknown) => {
        setLoadError(errorMessage(error))
        setPhase('error')
      })
  }

  if (phase === 'loading') return <ScreenMessage title="Preparando el mundo…" />

  if (phase === 'error' || !attempt) {
    return (
      <ScreenMessage title="No pudimos cargar el juego">
        <p>{loadError}</p>
        <button type="button" onClick={retryLoad}>Reintentar</button>
        <button type="button" onClick={() => navigate('/')}>Volver al inicio</button>
      </ScreenMessage>
    )
  }

  const timeLimit = attempt.timeLimitSeconds
  const timerLevel = remainingSeconds <= 5 ? 'red' : remainingSeconds <= 10 ? 'yellow' : 'green'
  const operation = formatExpression(attempt.expression)

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo compact />
        <div className={styles.worldName}>
          <span className={styles.worldDot} />
          <span>MUNDO 1</span>
          <strong>Aritmética</strong>
        </div>
        <div className={styles.challengeMeta}>
          <span>Desafío <strong>{attempt.position}</strong> de {attempt.challengeCount}</span>
          <div className={styles.progressBar} aria-label={`Progreso ${attempt.position} de ${attempt.challengeCount}`}>
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
            {platformRoute.map((platform, index) => (
              <FloatingIsland
                key={`${platform.side}-${index}`}
                className={`${styles.stagePlatform} ${styles[`${platform.side}Island`]}`}
                top={platform.top}
              />
            ))}
            <Grasshopper
              position={platformRoute[playerPlatform]}
              destination={jumpTargetIndex === null ? null : platformRoute[jumpTargetIndex]}
              onLand={handleJumpLanded}
            />
          </div>
        </aside>

        <article className={styles.challengeCard}>
          <div className={styles.challengeTopline}>
            <span className={styles.challengeBadge}><Sparkles size={16} /> DESAFÍO</span>
          </div>
          <h1 data-long={operation.length > 8} aria-label={`Operación ${operation}`}>{operation}</h1>
          <p>Escribe una expresión con el mismo resultado que cumpla todas las reglas</p>

          <form onSubmit={(event) => { event.preventDefault(); void checkAnswer() }}>
            <label htmlFor="answer">Tu respuesta</label>
            <div className={`${styles.answerRow} ${feedback === 'error' ? styles.answerError : ''}`}>
              <input
                id="answer"
                ref={answerInputRef}
                inputMode="text"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={200}
                value={answer}
                aria-invalid={feedback === 'error'}
                onChange={(event) => {
                  setAnswer(event.target.value)
                  if (feedback !== 'idle') setFeedback('idle')
                }}
                placeholder="Tu respuesta"
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
            {submitError && <p className={styles.formError} role="alert">{submitError}</p>}
          </form>

          <ul className={styles.rules} aria-label="Reglas activas">
            {attempt.rules.map((rule) => (
              <li key={rule.key} className={rule.key === attempt.newRule?.key ? styles.ruleNew : ''}>
                {rule.description}
              </li>
            ))}
          </ul>
        </article>
      </section>

      {scoreboard && (
        <div className={styles.scoreboard} aria-label="Puntuación">
          <span>PUNTOS <strong>{scoreboard.totalPoints}</strong></span>
          <span>RACHA <strong>{scoreboard.streak}</strong></span>
          <span>PRÓXIMO <strong>×{scoreboard.nextMultiplier}</strong></span>
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
            <p>Tu reto anterior venció mientras no estabas. La secuencia se reinició; conservas tus puntos y tus reglas.</p>
          </div>
        </aside>
      )}

      {failure && (
        <div className={styles.pauseOverlay} role="dialog" aria-modal="true" aria-labelledby="failure-title">
          <div className={styles.pauseNote}>
            <h2 id="failure-title">{failure.title}</h2>
            <p>{failure.message}</p>
            {failure.violations.length > 0 && (
              <ul className={styles.violations}>
                {failure.violations.map((violation) => (
                  <li key={violation.ruleKey}>{violation.message}</li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => void restartGame()} disabled={isRestarting}>
              <RotateCcw size={16} /> {isRestarting ? 'Reiniciando…' : 'Reiniciar mundo'}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
