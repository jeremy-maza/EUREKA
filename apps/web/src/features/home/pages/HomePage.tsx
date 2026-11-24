import { Link, Navigate } from 'react-router-dom';
import { Check, Compass, Flame, Lock, LogOut, Play, Sparkles, Star, Trophy } from 'lucide-react';
import grasshopperIdle from '@/assets/grillo/grillo1.png';
import { useAuth } from '@/features/auth/AuthContext';
import type { WorldProgress, WorldSummary } from '@/services/api/types';
import { FloatingIsland } from '@/components/ui/FloatingIsland';
import { Logo } from '@/components/ui/Logo';
import { ScreenMessage } from '@/components/ui/ScreenMessage';
import { DifficultyBadge } from '@/components/common/DifficultyBadge';
import { useWorldCatalog } from '@/lib/useWorldCatalog';
import {
  pickDefaultWorld,
  progressOf,
  unlockHint,
  worldAccentStyle,
  worldStatus,
  type WorldStatus,
} from '@/lib/worlds';
import styles from './HomePage.module.css';

const STATUS_LABEL: Record<WorldStatus, string> = {
  locked: 'Bloqueado',
  available: 'Disponible',
  'in-progress': 'En curso',
  completed: 'Completado',
};

const STATUS_ICON: Record<WorldStatus, typeof Lock> = {
  locked: Lock,
  available: Star,
  'in-progress': Flame,
  completed: Check,
};

const PLAY_LABEL: Record<Exclude<WorldStatus, 'locked'>, string> = {
  available: 'Jugar',
  'in-progress': 'Continuar',
  completed: 'Jugar de nuevo',
};

type WorldCardProps = {
  world: WorldSummary;
  progress: WorldProgress | undefined;
  /** El mundo más indicado para jugar ahora (ahí espera el grillo). */
  isNext: boolean;
};

function WorldCard({ world, progress, isNext }: WorldCardProps) {
  const status = worldStatus(progress);
  const StatusIcon = STATUS_ICON[status];
  const ruleCount = progress?.ruleCount ?? world.ruleCount;
  const mastered = progress?.unlockedRules.length ?? 0;
  const sequence = progress?.activeSequence ?? null;
  const completions = progress?.completionsCount ?? (progress?.status === 'COMPLETED' ? 1 : 0);
  const titleId = `world-${world.slug}`;

  return (
    <article
      className={styles.world}
      data-status={status}
      style={worldAccentStyle(world.slug, world.position)}
      aria-labelledby={titleId}
    >
      <div className={styles.scene} aria-hidden="true">
        <FloatingIsland className={styles.sceneIsland} top={46} />
        <span className={styles.islandNumber}>{world.position}</span>
        {isNext && status !== 'locked' && <img className={styles.hopper} src={grasshopperIdle} alt="" />}
        {status === 'locked' && (
          <span className={styles.lockBadge}>
            <Lock size={20} />
          </span>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.worldHead}>
          <div className={styles.worldTopline}>
            <span className={styles.worldNumber}>MUNDO {world.position}</span>
            <span className={styles.status}>
              <StatusIcon size={12} aria-hidden="true" /> {STATUS_LABEL[status]}
            </span>
          </div>
          <h2 id={titleId}>{world.name}</h2>
          <p>{world.description}</p>
        </div>

        {world.concepts?.length > 0 && (
          <ul className={styles.concepts} aria-label={`Conceptos de ${world.name}`}>
            {world.concepts.map((concept) => (
              <li key={concept}>{concept}</li>
            ))}
          </ul>
        )}

        {status === 'locked' ? (
          <p className={styles.lockedHint}>
            <Lock size={14} aria-hidden="true" /> {unlockHint(progress?.unlockRequirement ?? null)}
          </p>
        ) : (
          <>
            {progress && status !== 'available' ? (
              <div className={styles.metrics}>
                <div>
                  <small>
                    <Trophy size={13} aria-hidden="true" /> Puntos
                  </small>
                  <strong>{progress.totalPoints}</strong>
                </div>
                <div>
                  <small>
                    <Flame size={13} aria-hidden="true" /> Racha
                  </small>
                  <strong>{progress.streak}</strong>
                </div>
                <div>
                  <small>Mejor racha</small>
                  <strong>{progress.bestStreak}</strong>
                </div>
                <div>
                  <small>
                    <Sparkles size={13} aria-hidden="true" /> Reglas dominadas
                  </small>
                  <strong>
                    {mastered}
                    <span> / {ruleCount}</span>
                  </strong>
                </div>
              </div>
            ) : (
              <p className={styles.note}>
                <Sparkles size={14} aria-hidden="true" /> {ruleCount} reglas por dominar
              </p>
            )}

            {(sequence || completions > 0) && (
              <div className={styles.facts}>
                {sequence && progress && (
                  <span>
                    Secuencia en curso: desafío <strong>{progress.currentPosition}</strong> de{' '}
                    {sequence.challengeCount} <DifficultyBadge level={sequence.difficulty} />
                  </span>
                )}
                {completions > 0 && (
                  <span className={styles.completions}>
                    <Trophy size={13} aria-hidden="true" /> Completado {completions}{' '}
                    {completions === 1 ? 'vez' : 'veces'}
                  </span>
                )}
              </div>
            )}

            <Link to={`/juego/${world.slug}`} className={styles.play}>
              <Play size={17} fill="currentColor" aria-hidden="true" />
              {PLAY_LABEL[status]}
              <span className="sr-only">: Mundo {world.position}</span>
            </Link>
          </>
        )}
      </div>
    </article>
  );
}

export function HomePage() {
  const { user, logout } = useAuth();
  const isStudent = user?.role === 'STUDENT';
  // Solo los estudiantes tienen progreso que cargar.
  const { catalog, error, retry } = useWorldCatalog('No se pudo cargar tu información.', isStudent);

  // Los docentes no juegan: su pantalla principal es el panel.
  if (user?.role === 'TEACHER') return <Navigate to="/docente" replace />;

  if (isStudent && error) {
    return (
      <ScreenMessage title="No pudimos cargar tu aventura">
        <p>{error}</p>
        <button type="button" onClick={retry}>
          Reintentar
        </button>
      </ScreenMessage>
    );
  }

  const nextSlug = catalog ? pickDefaultWorld(catalog.worlds, catalog.progress) : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Logo compact />
        <div className={styles.account}>
          {isStudent && (
            <Link to="/progreso" className={styles.accountLink}>
              <Compass size={15} aria-hidden="true" /> Mi progreso
            </Link>
          )}
          {isStudent && (
            <Link to="/clasificaciones" className={styles.accountLink}>
              <Trophy size={15} aria-hidden="true" /> Clasificaciones
            </Link>
          )}
          <span>{user?.displayName}</span>
          <button type="button" onClick={() => void logout()} aria-label="Cerrar sesión">
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <section className={styles.content}>
        <span className={styles.label}>TU AVENTURA</span>
        <h1>¡Hola, {user?.displayName}!</h1>

        {!isStudent && <p className={styles.empty}>El juego es solo para cuentas de estudiante.</p>}

        {isStudent && !catalog && (
          <p className={styles.empty} role="status">
            Cargando tus mundos…
          </p>
        )}

        {isStudent && catalog && catalog.worlds.length === 0 && (
          <p className={styles.empty}>Todavía no hay mundos disponibles.</p>
        )}

        {isStudent && catalog && catalog.worlds.length > 0 && (
          <>
            <p className={styles.lead}>
              Completa un mundo para desbloquear el siguiente. Cada secuencia sortea sus reglas: si fallas, se
              descartan, pero tus puntos y tus reglas dominadas se quedan contigo.
            </p>
            <ol className={styles.map} aria-label="Mapa de mundos">
              {catalog.worlds.map((world) => (
                <li key={world.slug}>
                  <WorldCard
                    world={world}
                    progress={progressOf(catalog.progress, world.slug)}
                    isNext={world.slug === nextSlug}
                  />
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </main>
  );
}
