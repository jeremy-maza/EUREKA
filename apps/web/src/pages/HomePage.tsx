import { Link } from 'react-router';
import { ApiStatus } from '../features/health/ApiStatus';

export function HomePage() {
  return (
    <section>
      <h1>Matemática bajo reglas</h1>
      <p className="lead">
        Resuelve cada reto escribiendo una expresión matemática. Con cada reto aparece una regla nueva… y
        todas las anteriores siguen vigentes.
      </p>
      <p>
        <Link to="/mundos" className="button">
          Ver mundos
        </Link>
      </p>
      <ApiStatus />
    </section>
  );
}
