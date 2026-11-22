import styles from './FloatingIsland.module.css';

type FloatingIslandProps = {
  className: string;
  top: number;
};

export function FloatingIsland({ className, top }: FloatingIslandProps) {
  return (
    <svg
      className={`${styles.island} ${className}`}
      style={{ top: `${top}%` }}
      viewBox="0 0 180 72"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 61c21-6 39-2 58-4 25-3 59-2 94 4-23 7-51 9-79 7-30-1-56-2-73-7Z"
        fill="#315d64"
        opacity=".2"
      />
      <path
        d="M8 35c6-6 13-5 19-10 6-7 14-6 20 1 7-5 15-4 22 1 8-9 17-9 25-2 8-7 17-4 24 2 8-7 17-6 24 0 8-6 17-4 24 2 7-3 14 2 14 8l-5 8c4 5 0 9-7 10-2 6-10 7-18 4-6 6-14 3-21 1-7 7-15 4-22 1-8 7-17 4-24 0-8 5-16 2-22-1-8 4-15 0-21-4-9 3-16-2-13-7-8-2-10-7-4-13Z"
        fill="#99613a"
        stroke="#70452e"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M28 49c9 3 15 2 21 0m35 7c7 3 13 3 19 0m30-5c7 3 13 2 19-1"
        fill="none"
        stroke="#c18450"
        strokeLinecap="round"
        strokeWidth="2"
        opacity=".8"
      />
      <path
        d="M8 35c6-6 13-5 19-10 6-7 14-6 20 1 7-5 15-4 22 1 8-9 17-9 25-2 8-7 17-4 24 2 8-7 17-6 24 0 8-6 17-4 24 2 7-3 14 2 14 8-7 4-14 2-21 3-8 3-16 1-24 1-9 4-17 2-25 1-9 4-17 2-25 0-9 4-17 2-25 0-9 3-17 1-25-1-8 3-15 1-21-1-5 0-8-2-8-6Z"
        fill="#74c864"
        stroke="#4e9a50"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M17 34c12-4 21-1 30-2 11-4 20-2 29-1 11-4 21-2 31-1 10-3 20-1 30 1 12-3 22 0 31 3"
        fill="none"
        stroke="#b3e780"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M48 57c3 5-1 7-5 10m91-10c-1 5 3 7 7 10"
        fill="none"
        stroke="#70452e"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d="m69 49 5-3 5 2-3 4-6 1Zm57 2 4-3 6 2-4 4-6-1Z"
        fill="#c49a72"
        stroke="#805438"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M33 32c-2-4-1-7 2-10 2 4 2 7 1 10m4 0c0-4 2-7 5-9 0 4-1 7-3 10m93-1c1-5 4-8 8-10 0 5-2 8-5 11"
        fill="#62b752"
        stroke="#4e9a50"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M55 33c-1-3 0-5 1-7m1 1c1-2 2-3 4-4m62 9c0-3 1-5 3-7m1 1c2-2 3-3 5-3"
        fill="none"
        stroke="#438e4a"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <g fill="#fff4cc">
        <circle cx="56" cy="25" r="2.2" />
        <circle cx="61" cy="23" r="2.2" />
        <circle cx="64" cy="27" r="2.2" />
        <circle cx="60" cy="30" r="2.2" />
        <circle cx="55" cy="29" r="2.2" />
        <circle cx="125" cy="25" r="2" />
        <circle cx="129" cy="23" r="2" />
        <circle cx="132" cy="27" r="2" />
        <circle cx="128" cy="30" r="2" />
        <circle cx="124" cy="29" r="2" />
      </g>
      <circle cx="60" cy="27" r="1.8" fill="#f1a83b" />
      <circle cx="128" cy="27" r="1.6" fill="#f1a83b" />
    </svg>
  );
}
