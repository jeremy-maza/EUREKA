import type { AnimationEvent } from 'react'
import grasshopperIdle from '@/assets/grillo/grillo1.png'
import grasshopperJumpingLeft from '@/assets/grillo/grillo3.png'
import grasshopperJumpingRight from '@/assets/grillo/grillo2.png'
import styles from './Grasshopper.module.css'

type JumpState = 'idle' | 'jumpingRight' | 'jumpingLeft'

export type PlatformPosition = {
  side: 'left' | 'right'
  x: number
  top: number
}

type GrasshopperProps = {
  position: PlatformPosition
  destination: PlatformPosition | null
  onLand: () => void
}

const imageForState: Record<JumpState, string> = {
  idle: grasshopperIdle,
  jumpingRight: grasshopperJumpingRight,
  jumpingLeft: grasshopperJumpingLeft,
}

export function Grasshopper({ position, destination, onLand }: GrasshopperProps) {
  const state: JumpState = destination
    ? destination.x > position.x ? 'jumpingRight' : 'jumpingLeft'
    : 'idle'
  const image = imageForState[state]

  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && destination) onLand()
  }

  return (
    <div
      className={`${styles.grasshopper} ${styles[`${destination?.side ?? position.side}Island`]} ${state === 'idle' ? '' : styles[state]}`}
      style={{ top: `${destination?.top ?? position.top}%` }}
      onAnimationEnd={handleAnimationEnd}
    >
      <img
        key={image}
        src={image}
        alt={`Grillo ${state === 'idle' ? 'en reposo' : 'saltando'}`}
        draggable={false}
      />
    </div>
  )
}
