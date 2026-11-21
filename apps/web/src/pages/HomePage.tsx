import { Link } from 'react-router';
import { ApiStatus } from '../features/health/ApiStatus';
import { useAuth } from '../features/auth/AuthContext';

export function HomePage() {
  const { status, user } = useAuth();
  return (
    <section>
      <h1>Matemática bajo reglas</h1>
      <p className="lead">
        Resuelve cada reto escribiendo una expresión matemática. Con cada reto aparece una regla nueva… y
        todas las anteriores siguen vigentes.
      </p>
      {status === 'authenticated' ? (
        <p>
          Hola, <strong>{user?.displayName}</strong>.{' '}
          <Link to="/mundos/arithmetic/jugar" className="button">
            Jugar
          </Link>{' '}
          <Link to="/progreso" className="button button--ghost">
            Mi progreso
          </Link>
        </p>
      ) : (
        <p>
          <Link to="/registro" className="button">
            Crear cuenta y jugar
          </Link>{' '}
          <Link to="/entrar" className="button button--ghost">
            Ya tengo cuenta
          </Link>
        </p>
      )}
      <ApiStatus />
    </section>
  );
}
