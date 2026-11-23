import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { ScreenMessage } from '@/shared/components/ScreenMessage';

/** Protege las rutas privadas: sin sesión redirige al acceso; mientras se valida el token muestra una carga. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <ScreenMessage title="Cargando…" />;
  if (status === 'anonymous') return <Navigate to="/acceso" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
