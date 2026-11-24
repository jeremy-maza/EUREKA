import { WorldDefinition } from '../world.types';
import { algebraWorld } from './algebra.world';
import { arithmeticWorld } from './arithmetic.world';
import { chaosWorld } from './chaos.world';
import { fractionsWorld } from './fractions.world';
import { signsWorld } from './signs.world';

export * from './algebra.world';
export * from './arithmetic.world';
export * from './chaos.world';
export * from './fractions.world';
export * from './signs.world';

/** Los cinco mundos del juego, en orden de posición (= orden de desbloqueo). */
export const ALL_WORLDS: readonly WorldDefinition[] = [
  arithmeticWorld,
  signsWorld,
  fractionsWorld,
  algebraWorld,
  chaosWorld,
];
