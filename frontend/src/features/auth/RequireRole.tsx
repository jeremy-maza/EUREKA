import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

type RequireRoleProps = {
  role: 'STUDENT' | 'TEACHER'
}

/** Complementa a `RequireAuth`: la API ya responde 403 a otros roles; esto evita mostrarles una pantalla rota. */
export function RequireRole({ role }: RequireRoleProps) {
  const { user } = useAuth()
  if (user?.role !== role) return <Navigate to="/" replace />
  return <Outlet />
}
