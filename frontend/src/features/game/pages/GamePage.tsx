import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, Send, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { arithmeticChallenges, type ChallengeRule } from '@/features/arithmetic/data/challenges'
import { FloatingIsland } from '@/features/game/components/FloatingIsland'
import { Grasshopper } from '@/features/game/components/Grasshopper'
import { Logo } from '@/shared/components/Logo'
import styles from './GamePage.module.css'

type Feedback = 'idle' | 'success' | 'error'

const getTimeLimit = (questionNumber: number) => Math.max(30 - ((questionNumber - 1) * 2), 8)

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0')
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${remainingSeconds}`
}

const platformRoute = [
  { side: 'left', x: 29, top: 84 },
  { side: 'right', x: 71, top: 68 },
  { side: 'left', x: 29, top: 52 },
  { side: 'right', x: 71, top: 36 },
  { side: 'left', x: 29, top: 24 },
] as const

const backgroundFiles = import.meta.glob('../../../assets/backgrounds/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})
const backgroundUrl = Object.entries(backgroundFiles)
  .find(([path]) => path.endsWith('arithmetic-background.png'))?.[1] as string | undefined

export function GamePage() {
  const navigate = useNavigate()
  const [challengeIndex, setChallengeIndex] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(getTimeLimit(1))
  const [isGameOver, setIsGameOver] = useState(false)
  const [playerPlatform, setPlayerPlatform] = useState(0)
  const [jumpTargetIndex, setJumpTargetIndex] = useState<number | null>(null)
  const [answer, setAnswer] = useState('')
  const answerInputRef = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState<Feedback>('idle')
  const [discoveredRule, setDiscoveredRule] = useState<ChallengeRule | null>(null)
  const [isRuleToastLeaving, setIsRuleToastLeaving] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const remainingSecondsRef = useRef(remainingSeconds)
  const remainingMillisecondsRef = useRef(remainingSeconds * 1000)
  const countdownDeadlineRef = useRef<number | null>(null)
  const countdownIntervalRef = useRef<number | null>(null)
  const hasAnsweredRef = useRef(false)
  const isGameOverRef = useRef(false)
  const challenge = arithmeticChallenges[challengeIndex]
  const timeLimit = getTimeLimit(challenge.number)

  const clearCountdown = useCallback(() => {
    if (countdownIntervalRef.current !== null) {
      window.clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
  }, [])

  const stopCountdown = useCallback(() => {
    clearCountdown()
    if (countdownDeadlineRef.current !== null) {
      remainingMillisecondsRef.current = Math.max(countdownDeadlineRef.current - Date.now(), 0)
      countdownDeadlineRef.current = null
    }
  }, [clearCountdown])

  const expireGame = useCallback(() => {
    if (isGameOverRef.current || hasAnsweredRef.current) return

    isGameOverRef.current = true
    remainingSecondsRef.current = 0
    remainingMillisecondsRef.current = 0
    countdownDeadlineRef.current = null
    clearCountdown()
    setRemainingSeconds(0)
    setIsGameOver(true)
    setIsPaused(false)
  }, [clearCountdown])

  useEffect(() => {
    if (!isPaused && !isGameOver) answerInputRef.current?.focus()
  }, [challengeIndex, isGameOver, isPaused])

  useEffect(() => {
    if (isPaused || isGameOver || hasAnsweredRef.current) return

    const deadline = Date.now() + remainingMillisecondsRef.current
    countdownDeadlineRef.current = deadline
    const updateCountdown = () => {
      if (hasAnsweredRef.current || isGameOverRef.current) return

      const millisecondsLeft = Math.max(deadline - Date.now(), 0)
      const secondsLeft = Math.ceil(millisecondsLeft / 1000)
      remainingMillisecondsRef.current = millisecondsLeft

      if (secondsLeft !== remainingSecondsRef.current) {
        remainingSecondsRef.current = secondsLeft
        setRemainingSeconds(secondsLeft)
      }

      if (millisecondsLeft === 0) expireGame()
    }

    const interval = window.setInterval(updateCountdown, 250)
    countdownIntervalRef.current = interval

    return () => {
      window.clearInterval(interval)
      if (countdownIntervalRef.current === interval) countdownIntervalRef.current = null
      if (countdownDeadlineRef.current === deadline) {
        remainingMillisecondsRef.current = Math.max(deadline - Date.now(), 0)
        countdownDeadlineRef.current = null
      }
    }
  }, [challengeIndex, expireGame, isGameOver, isPaused])

  useEffect(() => {
    if (feedback !== 'success' || jumpTargetIndex !== null) return

    const timer = window.setTimeout(() => {
      setJumpTargetIndex(Math.min(playerPlatform + 1, platformRoute.length - 1))
    }, 350)

    return () => window.clearTimeout(timer)
  }, [feedback, jumpTargetIndex, playerPlatform])

  useEffect(() => {
    if (!discoveredRule) return

    const leaveTimer = window.setTimeout(() => setIsRuleToastLeaving(true), 2800)
    const removeTimer = window.setTimeout(() => setDiscoveredRule(null), 3100)

    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(removeTimer)
    }
  }, [discoveredRule])

  const checkAnswer = () => {
    if (
      feedback === 'success'
      || jumpTargetIndex !== null
      || isPaused
      || isGameOverRef.current
      || hasAnsweredRef.current
    ) return

    if (
      remainingSecondsRef.current === 0
      || (countdownDeadlineRef.current !== null && Date.now() >= countdownDeadlineRef.current)
    ) {
      expireGame()
      return
    }

    if (!answer.trim() || answer.trim() === '0') {
      setFeedback('error')
      answerInputRef.current?.focus()
      return
    }

    hasAnsweredRef.current = true
    stopCountdown()
    setFeedback('success')
  }

  const handleJumpLanded = () => {
    if (jumpTargetIndex === null) return

    setPlayerPlatform(jumpTargetIndex)
    setJumpTargetIndex(null)

    if (challengeIndex === arithmeticChallenges.length - 1) {
      navigate('/final')
      return
    }

    const nextChallenge = arithmeticChallenges[challengeIndex + 1]
    const newRule = nextChallenge.rules.find(
      (rule) => !challenge.rules.some((previousRule) => previousRule.id === rule.id),
    )
    if (newRule) {
      setIsRuleToastLeaving(false)
      setDiscoveredRule(newRule)
    }

    const nextTimeLimit = getTimeLimit(nextChallenge.number)
    remainingSecondsRef.current = nextTimeLimit
    remainingMillisecondsRef.current = nextTimeLimit * 1000
    countdownDeadlineRef.current = null
    setRemainingSeconds(nextTimeLimit)
    hasAnsweredRef.current = false
    setChallengeIndex((current) => current + 1)
    setAnswer('')
    setFeedback('idle')
  }

  const restartGame = () => {
    clearCountdown()
    const initialTimeLimit = getTimeLimit(1)
    remainingSecondsRef.current = initialTimeLimit
    remainingMillisecondsRef.current = initialTimeLimit * 1000
    countdownDeadlineRef.current = null
    hasAnsweredRef.current = false
    isGameOverRef.current = false
    setRemainingSeconds(initialTimeLimit)
    setIsGameOver(false)
    setIsPaused(false)
    setChallengeIndex(0)
    setPlayerPlatform(0)
    setJumpTargetIndex(null)
    setAnswer('')
    setFeedback('idle')
    setDiscoveredRule(null)
    setIsRuleToastLeaving(false)
  }

  const timerLevel = remainingSeconds <= 5 ? 'red' : remainingSeconds <= 10 ? 'yellow' : 'green'

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
          <span>Desafío <strong>{challenge.number}</strong> de {arithmeticChallenges.length}</span>
          <div className={styles.progressBar} aria-label={`Progreso ${challengeIndex + 1} de ${arithmeticChallenges.length}`}>
            {arithmeticChallenges.map((item, index) => (
              <i key={item.number} className={index <= challengeIndex ? styles.complete : ''} />
            ))}
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => setIsPaused(true)}
            aria-label="Pausar juego"
            disabled={feedback === 'success' || isGameOver}
          >
            <Pause size={18} />
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
            style={{ width: `${(remainingSeconds / timeLimit) * 100}%` }}
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
          <h1 aria-label={`Operación ${challenge.operation}`}>{challenge.operation}</h1>
          <p>{challenge.instruction}</p>

          <form onSubmit={(event) => { event.preventDefault(); checkAnswer() }}>
            <label htmlFor="answer">Tu respuesta</label>
            <div className={`${styles.answerRow} ${feedback === 'error' ? styles.answerError : ''}`}>
              <input
                id="answer"
                ref={answerInputRef}
                inputMode="numeric"
                value={answer}
                aria-invalid={feedback === 'error'}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    checkAnswer()
                  }
                }}
                onChange={(event) => {
                  setAnswer(event.target.value)
                  if (feedback !== 'idle') setFeedback('idle')
                }}
                placeholder="Tu respuesta"
                autoComplete="off"
                disabled={feedback === 'success' || isPaused || isGameOver}
              />
              <button
                type="submit"
                aria-label="Enviar respuesta"
                disabled={feedback === 'success' || isPaused || isGameOver}
              >
                <Send size={18} />
              </button>
            </div>
          </form>

        </article>
      </section>

      {discoveredRule && (
        <aside
          key={discoveredRule.id}
          className={`${styles.ruleToast} ${isRuleToastLeaving ? styles.ruleToastLeaving : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <Sparkles size={19} aria-hidden="true" />
          <div>
            <strong>NUEVA REGLA</strong>
            <p>{discoveredRule.text}</p>
          </div>
        </aside>
      )}

      {isPaused && (
        <div className={styles.pauseOverlay} role="dialog" aria-modal="true" aria-labelledby="pause-title">
          <div className={styles.pauseNote}>
            <h2 id="pause-title">¡Pausa!</h2>
            <p>Tu aventura te espera.</p>
            <button type="button" onClick={() => setIsPaused(false)}>
              <Play size={16} fill="currentColor" /> Seguir jugando
            </button>
          </div>
        </div>
      )}

      {isGameOver && (
        <div className={styles.pauseOverlay} role="dialog" aria-modal="true" aria-labelledby="timeout-title">
          <div className={styles.pauseNote}>
            <h2 id="timeout-title">¡Tiempo agotado!</h2>
            <p>El mundo comenzará de nuevo.</p>
            <button type="button" onClick={restartGame}>
              <RotateCcw size={16} /> Reiniciar mundo
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
