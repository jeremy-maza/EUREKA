import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

/** Protege rutas: sin sesión redirige al login y vuelve a la página pedida tras entrar. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <p role="status">Cargando tu sesión…</p>;
  if (status === 'anonymous') return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
