import type { WorldProgress } from '../../api/types';

/** Puntos, racha y multiplicador siempre visibles durante la partida. */
export function ScoreBar({ progress }: { progress: WorldProgress }) {
  return (
    <dl className="scorebar">
      <div>
        <dt>Puntos</dt>
        <dd>{progress.totalPoints}</dd>
      </div>
      <div>
        <dt>Racha</dt>
        <dd>{progress.streak}</dd>
      </div>
      <div>
        <dt>Próximo acierto</dt>
        <dd>×{progress.nextMultiplier}</dd>
      </div>
      <div>
        <dt>Reglas ganadas</dt>
        <dd>{progress.unlockedRules.length}</dd>
      </div>
    </dl>
  );
}
