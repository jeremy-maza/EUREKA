import type { DifficultyLevel } from '@/services/api/types';
import { DIFFICULTY_LABEL } from '@/lib/worlds';
import styles from './DifficultyBadge.module.css';

const LEVEL: Record<DifficultyLevel, number> = { EASIER: 1, BASELINE: 2, HARDER: 3 };

/** Dificultad de la secuencia que eligió el servidor («Suave», «Normal», «Intensa»). */
export function DifficultyBadge({ level, className = '' }: { level: DifficultyLevel; className?: string }) {
  const filled = LEVEL[level] ?? 2;
  return (
    <span className={`${styles.badge} ${className}`} data-level={level}>
      <span className={styles.dots} aria-hidden="true">
        {[1, 2, 3].map((dot) => (
          <i key={dot} className={dot <= filled ? styles.on : ''} />
        ))}
      </span>
      <span className="sr-only">Dificultad: </span>
      {DIFFICULTY_LABEL[level] ?? DIFFICULTY_LABEL.BASELINE}
    </span>
  );
}
