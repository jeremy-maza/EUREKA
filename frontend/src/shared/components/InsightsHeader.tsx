import { BarChart3, Gamepad2, LogOut, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { Logo } from '@/shared/components/Logo'
import styles from './InsightsHeader.module.css'

type InsightsHeaderProps = {
  activePage: 'classifications' | 'teacher'
}

export function InsightsHeader({ activePage }: InsightsHeaderProps) {
  const { user, logout } = useAuth()
  // Los estudiantes juegan y ven la clasificación; los docentes solo ven su panel (la API responde 403 al resto).
  const isTeacher = user?.role === 'TEACHER'
  const isStudent = user?.role === 'STUDENT'

  return (
    <header className={styles.header}>
      <Link to="/" aria-label="EUREKA, ir al juego">
        <Logo compact />
      </Link>
      <nav className={styles.navigation} aria-label="Navegación principal">
        {isStudent && (
          <Link to="/" className={styles.navLink}>
            <Gamepad2 size={17} /> <span>Jugar</span>
          </Link>
        )}
        {isStudent && (
          <Link
            to="/clasificaciones"
            className={`${styles.navLink} ${activePage === 'classifications' ? styles.active : ''}`}
            aria-current={activePage === 'classifications' ? 'page' : undefined}
          >
            <Trophy size={17} /> <span>Clasificaciones</span>
          </Link>
        )}
        {isTeacher && (
          <Link
            to="/docente"
            className={`${styles.navLink} ${activePage === 'teacher' ? styles.active : ''}`}
            aria-current={activePage === 'teacher' ? 'page' : undefined}
          >
            <BarChart3 size={17} /> <span>Panel docente</span>
          </Link>
        )}
        <button type="button" className={styles.navLink} onClick={() => void logout()}>
          <LogOut size={17} /> <span>Salir</span>
        </button>
      </nav>
    </header>
  )
}
