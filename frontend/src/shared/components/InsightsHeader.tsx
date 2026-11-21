import { BarChart3, Gamepad2, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Logo } from '@/shared/components/Logo'
import styles from './InsightsHeader.module.css'

type InsightsHeaderProps = {
  activePage: 'classifications' | 'teacher'
}

export function InsightsHeader({ activePage }: InsightsHeaderProps) {
  return (
    <header className={styles.header}>
      <Link to="/" aria-label="EUREKA, ir al juego">
        <Logo compact />
      </Link>
      <nav className={styles.navigation} aria-label="Navegación principal">
        <Link to="/" className={styles.navLink}>
          <Gamepad2 size={17} /> <span>Jugar</span>
        </Link>
        <Link
          to="/clasificaciones"
          className={`${styles.navLink} ${activePage === 'classifications' ? styles.active : ''}`}
          aria-current={activePage === 'classifications' ? 'page' : undefined}
        >
          <Trophy size={17} /> <span>Clasificaciones</span>
        </Link>
        <Link
          to="/docente"
          className={`${styles.navLink} ${activePage === 'teacher' ? styles.active : ''}`}
          aria-current={activePage === 'teacher' ? 'page' : undefined}
        >
          <BarChart3 size={17} /> <span>Panel docente</span>
        </Link>
      </nav>
    </header>
  )
}
