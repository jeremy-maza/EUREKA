import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import grasshopperIdle from '@/assets/grillo/grillo1.png';
import { FloatingIsland } from '@/components/ui/FloatingIsland';
import { ARITHMETIC_WORLD_SLUG } from '@/lib/worlds';
import { api, ApiError } from '@/services/api/client';
import type { Leaderboard } from '@/services/api/types';
import { InsightsHeader } from '@/components/common/InsightsHeader';
import { ScreenMessage } from '@/components/ui/ScreenMessage';
import styles from './LeaderboardPage.module.css';

const podiumStyles = [styles.secondPlace, styles.firstPlace, styles.thirdPlace];
const placeNames = ['Segundo lugar', 'Primer lugar', 'Tercer lugar'];

export function LeaderboardPage() {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .leaderboard(ARITHMETIC_WORLD_SLUG)
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'No se pudo cargar la clasificación.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = () => {
    setError(null);
    setReloadKey((key) => key + 1);
  };

  if (error) {
    return (
      <ScreenMessage title="No pudimos cargar la clasificación">
        <p>{error}</p>
        <button type="button" onClick={retry}>
          Reintentar
        </button>
      </ScreenMessage>
    );
  }
  if (!board) return <ScreenMessage title="Cargando clasificación…" />;

  const rankedStudents = board.entries;
  // Si el jugador queda fuera del recorte de la lista, se añade al final para que siempre vea su lugar.
  const listedStudents = rankedStudents.some((student) => student.isCurrentUser)
    ? rankedStudents
    : [...rankedStudents, board.me];
  // Orden visual del podio: segundo, primero, tercero (solo los puestos que existen).
  const podium = [rankedStudents[1], rankedStudents[0], rankedStudents[2]];

  return (
    <main className={styles.page}>
      <InsightsHeader activePage="leaderboard" />
      <div className={styles.content}>
        <header className={styles.intro}>
          <div>
            <span className={styles.eyebrow}>
              <Sparkles size={14} /> RUTA DE EXPLORADORES
            </span>
            <h1>Clasificaciones</h1>
            <p>Un salto más, un nuevo lugar en el mapa.</p>
          </div>
          <p className={styles.demoNotice}>
            <span />{' '}
            {board.scope === 'GROUPS'
              ? 'Compañeros de tus grupos · Mundo 1'
              : 'Aún no perteneces a un grupo: pide a tu docente que te agregue para compararte con tus compañeros'}
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
            if (!student) return null;
            const place = index === 1 ? 1 : index === 0 ? 2 : 3;
            return (
              <article
                key={`${place}-${student.displayName}`}
                className={`${styles.leader} ${podiumStyles[index]}`}
                aria-label={`${placeNames[index]}: ${student.displayName}, ${student.points.toLocaleString('es')} puntos`}
              >
                <div className={styles.leaderSign}>
                  <span>{placeNames[index]}</span>
                  <strong>{student.displayName}</strong>
                  <b>
                    {student.points.toLocaleString('es')} <small>puntos</small>
                  </b>
                </div>
                {place === 1 && <img className={styles.grasshopper} src={grasshopperIdle} alt="" />}
                <FloatingIsland className={styles.leaderIsland} top={48} />
                <span className={styles.islandNumber} aria-hidden="true">
                  {place}
                </span>
              </article>
            );
          })}
          <div className={styles.sceneGround} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </section>

        <section className={styles.rankingSection} aria-labelledby="ranking-title">
          <div className={styles.listHeading}>
            <div>
              <span className={styles.eyebrow}>MÁS ADELANTE EN EL CAMINO</span>
              <h2 id="ranking-title">Exploradores del mundo</h2>
            </div>
            <span className={styles.studentCount}>{board.participants} en la ruta</span>
          </div>
          <ol className={styles.rankingList}>
            {listedStudents.map((student, index) => (
              <li
                key={`${student.rank}-${index}`}
                className={`${styles.rankingRow} ${student.isCurrentUser ? styles.currentStudent : ''}`}
              >
                <span className={styles.rankNumber}>{String(student.rank).padStart(2, '0')}</span>
                <span className={styles.studentName}>
                  {student.displayName}
                  {student.isCurrentUser && <small>Tu recorrido</small>}
                </span>
                <strong className={styles.studentPoints}>
                  {student.points.toLocaleString('es')} <small>pts</small>
                </strong>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
