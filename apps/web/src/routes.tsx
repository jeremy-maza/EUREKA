import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { WorldsPage } from './pages/WorldsPage';

/** Definición de rutas separada del router para poder reutilizarla en tests (memory router). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'mundos', element: <WorldsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
