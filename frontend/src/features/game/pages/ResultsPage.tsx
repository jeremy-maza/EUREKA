import { RotateCcw, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Logo } from '@/shared/components/Logo'
import styles from './ResultsPage.module.css'

export function ResultsPage() {
  const navigate = useNavigate()

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo compact />
      </header>
      <section className={styles.result}>
        <div className={styles.emblem}>
          <div className={styles.rays} />
          <Sparkles size={48} />
        </div>
        <span className={styles.label}>DEMO COMPLETADA</span>
        <h1>¡Descubrimiento logrado!</h1>
        <p>¡Completaste todos los desafíos! Sigue practicando y descubrirás aún más caminos con los números.</p>
        <div className={styles.stats}>
          <div>
            <small>Desafíos completados</small>
            <strong>4</strong>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => navigate('/juego')}>
            <RotateCcw size={18} /> Volver a jugar
          </button>
        </div>
      </section>
    </main>
  )
}
