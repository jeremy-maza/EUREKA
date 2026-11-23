import { useEffect, useRef } from 'react';
import { Check, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { WorldProgress, WorldSummary } from '@/services/api/types';
import { isCompleted, isLocked, progressOf, worldAccentStyle } from '@/lib/worlds';
import styles from './WorldTabs.module.css';

type WorldTabsProps = {
  worlds: WorldSummary[];
  progress: WorldProgress[];
  activeSlug: string;
  /** Ruta base: cada pestaña enlaza con `${basePath}/${slug}`. */
  basePath: string;
  label?: string;
};

/** Selector de mundo (control segmentado). Son enlaces: cada mundo tiene su propia URL. */
export function WorldTabs({ worlds, progress, activeSlug, basePath, label = 'Mundos' }: WorldTabsProps) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  // En pantallas estrechas la lista se desplaza: la pestaña activa siempre queda a la vista.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeSlug]);

  return (
    <nav className={styles.tabs} aria-label={label}>
      {worlds.map((world) => {
        const item = progressOf(progress, world.slug);
        const locked = isLocked(item);
        const completed = isCompleted(item);
        const active = world.slug === activeSlug;
        return (
          <Link
            key={world.slug}
            ref={active ? activeRef : undefined}
            to={`${basePath}/${world.slug}`}
            className={`${styles.tab} ${active ? styles.active : ''} ${locked ? styles.locked : ''}`}
            style={worldAccentStyle(world.slug, world.position)}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.number} aria-hidden="true">
              {world.position}
            </span>
            <span className="sr-only">Mundo {world.position}:</span>{' '}
            <span className={styles.name}>{world.name}</span>
            {locked && (
              <>
                {' '}
                <Lock size={13} aria-hidden="true" />
                <span className="sr-only">(bloqueado)</span>
              </>
            )}
            {!locked && completed && (
              <>
                {' '}
                <Check size={13} aria-hidden="true" className={styles.done} />
                <span className="sr-only">(completado)</span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
