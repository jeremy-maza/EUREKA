import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../features/auth/AuthContext';

const navLinkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link');

export function Layout() {
  const { status, user, logout } = useAuth();
  const navigate = useNavigate();
  const loggedIn = status === 'authenticated';

  return (
    <div className="app">
      <header className="app-header">
        <NavLink to="/" className="brand">
          Matemática bajo reglas
        </NavLink>
        <nav aria-label="Navegación principal">
          <NavLink to="/" end className={navLinkClass}>
            Inicio
          </NavLink>
          <NavLink to="/mundos" className={navLinkClass}>
            Mundos
          </NavLink>
          {loggedIn && (
            <NavLink to="/progreso" className={navLinkClass}>
              Mi progreso
            </NavLink>
          )}
          {loggedIn ? (
            <>
              <span className="nav-user">{user?.displayName}</span>
              <button
                type="button"
                className="nav-button"
                onClick={() => void logout().then(() => navigate('/'))}
              >
                Salir
              </button>
            </>
          ) : (
            status === 'anonymous' && (
              <>
                <NavLink to="/entrar" className={navLinkClass}>
                  Entrar
                </NavLink>
                <Link to="/registro" className="nav-cta">
                  Crear cuenta
                </Link>
              </>
            )
          )}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">Cada reto suma una regla nueva. Todas siguen activas.</footer>
    </div>
  );
}
