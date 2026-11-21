import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, UserPlus } from 'lucide-react'
import { ApiError } from '@/shared/api/client'
import { Logo } from '@/shared/components/Logo'
import { useAuth } from '../AuthContext'
import styles from './AuthPage.module.css'

type AuthPageProps = {
  mode: 'login' | 'register'
}

const MIN_PASSWORD_LENGTH = 8

export function AuthPage({ mode }: AuthPageProps) {
  const isRegister = mode === 'register'
  const { status, sessionExpired, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (status === 'authenticated') return <Navigate to={from} replace />

  const validate = () => {
    if (isRegister && !displayName.trim()) return 'Escribe tu nombre.'
    if (!email.trim()) return 'Escribe tu correo electrónico.'
    if (!password) return 'Escribe tu contraseña.'
    if (isRegister && password.length < MIN_PASSWORD_LENGTH) {
      return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
    }
    return null
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return

    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      if (isRegister) await register(email.trim(), displayName.trim(), password)
      else await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No se pudo completar la solicitud.')
      setIsSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo compact />
      </header>
      <section className={styles.panel}>
        <span className={styles.label}>{isRegister ? 'NUEVA AVENTURA' : 'BIENVENIDO'}</span>
        <h1>{isRegister ? 'Crea tu cuenta' : 'Inicia sesión'}</h1>
        {sessionExpired && !isRegister && (
          <p className={styles.notice} role="status">Tu sesión expiró. Inicia sesión de nuevo.</p>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {isRegister && (
            <label>
              Nombre
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                maxLength={80}
                disabled={isSubmitting}
              />
            </label>
          )}
          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              maxLength={254}
              disabled={isSubmitting}
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              maxLength={128}
              disabled={isSubmitting}
            />
          </label>

          {error && <p className={styles.error} role="alert">{error}</p>}

          <button type="submit" disabled={isSubmitting}>
            {isRegister ? <UserPlus size={18} /> : <LogIn size={18} />}
            {isSubmitting ? 'Un momento…' : isRegister ? 'Crear cuenta' : 'Entrar'}
          </button>
        </form>

        <p className={styles.switch}>
          {isRegister ? '¿Ya tienes cuenta? ' : '¿Aún no tienes cuenta? '}
          <Link to={isRegister ? '/acceso' : '/registro'} state={location.state}>
            {isRegister ? 'Inicia sesión' : 'Regístrate'}
          </Link>
        </p>
      </section>
    </main>
  )
}
