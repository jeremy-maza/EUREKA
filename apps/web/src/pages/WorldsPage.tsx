import { Link } from 'react-router';
import { WORLDS } from '../features/worlds/worlds';

export function WorldsPage() {
  return (
    <section>
      <h1>Mundos</h1>
      <ol className="worlds">
        {WORLDS.map((world) => (
          <li key={world.slug} className={world.available ? 'world' : 'world world--locked'}>
            <h2>{world.name}</h2>
            <p>{world.description}</p>
            <p className="world-state">{world.available ? 'Disponible' : 'Próximamente'}</p>
            {world.available && (
              <Link to={`/mundos/${world.slug}/jugar`} className="button">
                Jugar
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
