import { Sparkles } from 'lucide-react'
import grasshopperIdle from '@/assets/grillo/grillo1.png'
import { FloatingIsland } from '@/features/game/components/FloatingIsland'
import { InsightsHeader } from '@/shared/components/InsightsHeader'
import { demoClassifications } from '@/features/classifications/data/demoClassifications'
import styles from './ClassificationsPage.module.css'

const rankedStudents = [...demoClassifications].sort((a, b) => b.points - a.points)
const podium = [rankedStudents[1], rankedStudents[0], rankedStudents[2]]
const podiumStyles = [styles.secondPlace, styles.firstPlace, styles.thirdPlace]
const placeNames = ['Segundo lugar', 'Primer lugar', 'Tercer lugar']

export function ClassificationsPage() {
  return (
    <main className={styles.page}>
      <InsightsHeader activePage="classifications" />
      <div className={styles.content}>
        <header className={styles.intro}>
          <div>
            <span className={styles.eyebrow}><Sparkles size={14} /> RUTA DE EXPLORADORES</span>
            <h1>Clasificaciones</h1>
            <p>Un salto más, un nuevo lugar en el mapa.</p>
          </div>
          <p className={styles.demoNotice}>
            <span /> Muestra de demostración · puntuaciones ficticias
          </p>
        </header>

        <section className={styles.worldScene} aria-label="Islas de los primeros lugares">
          <div className={styles.sceneLabel}>
            <span className={styles.sceneMark} />
            <span>RUTA DEL BOSQUE</span>
            <span className={styles.sceneMark} />
          </div>
          <div className={`${styles.cloud} ${styles.cloudOne}`} aria-hidden="true" />
          <div className={`${styles.cloud} ${styles.cloudTwo}`} aria-hidden="true" />
          <div className={styles.sceneSun} aria-hidden="true" />
          <div className={styles.leaderRoute} aria-hidden="true" />
          {podium.map((student, index) => {
            const place = index === 1 ? 1 : index === 0 ? 2 : 3
            return (
              <article
                key={student.id}
                className={`${styles.leader} ${podiumStyles[index]}`}
                aria-label={`${placeNames[index]}: ${student.name}, ${student.points.toLocaleString('es')} puntos`}
              >
                <div className={styles.leaderSign}>
                  <span>{placeNames[index]}</span>
                  <strong>{student.name}</strong>
                  <b>{student.points.toLocaleString('es')} <small>puntos</small></b>
                </div>
                {place === 1 && <img className={styles.grasshopper} src={grasshopperIdle} alt="" />}
                <FloatingIsland className={styles.leaderIsland} top={48} />
                <span className={styles.islandNumber} aria-hidden="true">{place}</span>
              </article>
            )
          })}
          <div className={styles.sceneGround} aria-hidden="true">
            <span /><span /><span /><span />
          </div>
        </section>

        <section className={styles.rankingSection} aria-labelledby="ranking-title">
          <div className={styles.listHeading}>
            <div>
              <span className={styles.eyebrow}>MÁS ADELANTE EN EL CAMINO</span>
              <h2 id="ranking-title">Exploradores del mundo</h2>
            </div>
            <span className={styles.studentCount}>{rankedStudents.length} en la ruta</span>
          </div>
          <ol className={styles.rankingList}>
            {rankedStudents.map((student, index) => (
              <li
                key={student.id}
                className={`${styles.rankingRow} ${student.isCurrentStudent ? styles.currentStudent : ''}`}
              >
                <span className={styles.rankNumber}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.studentName}>
                  {student.name}
                  {student.isCurrentStudent && <small>Tu recorrido · demo</small>}
                </span>
                <strong className={styles.studentPoints}>{student.points.toLocaleString('es')} <small>pts</small></strong>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  )
}
