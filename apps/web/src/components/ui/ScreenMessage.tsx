import type { ReactNode } from 'react';
import { Logo } from './Logo';
import styles from './ScreenMessage.module.css';

type ScreenMessageProps = {
  title: string;
  children?: ReactNode;
};

/** Pantalla completa con un mensaje breve (carga o error) en el estilo de la aplicación. */
export function ScreenMessage({ title, children }: ScreenMessageProps) {
  return (
    <main className={styles.page}>
      <Logo compact />
      <div className={styles.note} role="status" aria-live="polite">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
