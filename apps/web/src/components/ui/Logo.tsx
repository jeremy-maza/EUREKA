import styles from './Logo.module.css';

type LogoProps = {
  compact?: boolean;
};

export function Logo({ compact = false }: LogoProps) {
  return (
    <div className={`${styles.logo} ${compact ? styles.compact : ''}`} aria-label="Eureka">
      <span className={styles.mark} aria-hidden="true">
        E
      </span>
      <span>
        EUR<span>EK</span>A
      </span>
    </div>
  );
}
