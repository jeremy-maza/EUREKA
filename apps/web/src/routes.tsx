import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { AuthProvider } from './features/auth/AuthContext';
import { LoginPage, RegisterPage } from './features/auth/AuthPages';
import { RequireAuth } from './features/auth/RequireAuth';
import { PlayPage } from './features/game/PlayPage';
import { ProgressPage } from './features/progress/ProgressPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { WorldsPage } from './pages/WorldsPage';

/** Definición de rutas separada del router para poder reutilizarla en tests (memory router). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <AuthProvider>
        <Layout />
      </AuthProvider>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'mundos', element: <WorldsPage /> },
      { path: 'entrar', element: <LoginPage /> },
      { path: 'registro', element: <RegisterPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: 'mundos/:slug/jugar', element: <PlayPage /> },
          { path: 'progreso', element: <ProgressPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
