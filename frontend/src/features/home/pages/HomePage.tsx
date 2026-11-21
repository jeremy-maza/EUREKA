import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Flame, LogOut, Play, Sparkles, Trophy } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthContext'
import { api, ApiError } from '@/shared/api/client'
import type { WorldProgress, WorldSummary } from '@/shared/api/types'
import { Logo } from '@/shared/components/Logo'
import { ScreenMessage } from '@/shared/components/ScreenMessage'
import { ARITHMETIC_WORLD_SLUG } from '@/features/game/constants'
import styles from './HomePage.module.css'

type HomeData = {
  worlds: WorldSummary[]
  progress: WorldProgress[]
}

const formatSeconds = (milliseconds: number | null) =>
  milliseconds === null ? '—' : `${(milliseconds / 1000).toFixed(1)} s`

export function HomePage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const isStudent = user?.role === 'STUDENT'
  const [data, setData] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [worlds, progress] = await Promise.all([api.worlds(), api.progress()])
      setData({ worlds, progress })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo cargar tu información.')
    }
  }, [])

  useEffect(() => {
    if (!isStudent) return
    void load()
  }, [isStudent, load])

  // Los docentes no juegan: su pantalla principal es el panel.
  if (user?.role === 'TEACHER') return <Navigate to="/docente" replace />

  if (isStudent && error) {
    return (
      <ScreenMessage title="No pudimos cargar tu aventura">
        <p>{error}</p>
        <button type="button" onClick={() => void load()}>Reintentar</button>
      </ScreenMessage>
    )
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo compact />
        <div className={styles.account}>
          {isStudent && <Link to="/clasificaciones" className={styles.accountLink}><Trophy size={15} /> Clasificaciones</Link>}
          <span>{user?.displayName}</span>
          <button type="button" onClick={() => void logout()} aria-label="Cerrar sesión">
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <section className={styles.content}>
        <span className={styles.label}>TU AVENTURA</span>
        <h1>¡Hola, {user?.displayName}!</h1>

        {!isStudent && (
          <p className={styles.empty}>El juego es solo para cuentas de estudiante.</p>
        )}

        {isStudent && !data && <p className={styles.empty} role="status">Cargando tus mundos…</p>}

        {isStudent && data && data.worlds.length === 0 && (
          <p className={styles.empty}>Todavía no hay mundos disponibles.</p>
        )}

        {isStudent && data && (
          <div className={styles.worlds}>
            {data.worlds.map((world) => {
              const progress = data.progress.find((item) => item.worldSlug === world.slug)
              const playable = world.slug === ARITHMETIC_WORLD_SLUG
              const started = !!progress && progress.statistics.attemptsCount > 0
              const stats = progress?.statistics
              return (
                <article key={world.slug} className={styles.world}>
                  <div className={styles.worldHead}>
                    <span className={styles.worldNumber}>MUNDO {world.position}</span>
                    <h2>{world.name}</h2>
                    <p>{world.description}</p>
                  </div>

                  {progress && (
                    <>
                      <div className={styles.metrics}>
                        <div>
                          <small><Trophy size={13} /> Puntos</small>
                          <strong>{progress.totalPoints}</strong>
                        </div>
                        <div>
                          <small><Flame size={13} /> Racha</small>
                          <strong>{progress.streak}</strong>
                        </div>
                        <div>
                          <small>Mejor racha</small>
                          <strong>{progress.bestStreak}</strong>
                        </div>
                        <div>
                          <small>Desafío</small>
                          <strong>
                            {progress.status === 'COMPLETED'
                              ? `${world.challengeCount}/${world.challengeCount}`
                              : `${progress.currentPosition}/${world.challengeCount}`}
                          </strong>
                        </div>
                      </div>

                      {progress.unlockedRules.length > 0 && (
                        <div className={styles.rules}>
                          <small>REGLAS DESCUBIERTAS</small>
                          <ul>
                            {progress.unlockedRules.map((rule) => (
                              <li key={rule.key}><Sparkles size={13} aria-hidden="true" /> {rule.description}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {stats && started && (
                        <dl className={styles.stats}>
                          <div><dt>Intentos</dt><dd>{stats.attemptsCount}</dd></div>
                          <div><dt>Aciertos</dt><dd>{stats.correctCount}</dd></div>
                          <div><dt>Fallos</dt><dd>{stats.incorrectCount}</dd></div>
                          <div><dt>Sin tiempo</dt><dd>{stats.timeoutCount}</dd></div>
                          <div><dt>Tiempo medio</dt><dd>{formatSeconds(stats.averageCorrectElapsedMs)}</dd></div>
                        </dl>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    className={styles.play}
                    disabled={!playable}
                    onClick={() => navigate('/juego')}
                  >
                    <Play size={17} fill="currentColor" />
                    {!playable
                      ? 'Próximamente'
                      : progress?.status === 'COMPLETED'
                        ? 'Jugar de nuevo'
                        : started
                          ? 'Continuar'
                          : 'Jugar'}
                  </button>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
