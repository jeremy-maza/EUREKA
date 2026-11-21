import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('aplicación', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('la pantalla de inicio identifica el juego', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Matemática bajo reglas' })).toBeInTheDocument();
    expect(await screen.findByText('Servidor conectado')).toBeInTheDocument();
  });

  it('muestra que el servidor no está disponible si el health check falla', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    renderAt('/');
    expect(await screen.findByText('Servidor no disponible')).toBeInTheDocument();
  });

  it('navega a los mundos y solo Aritmética está disponible', async () => {
    renderAt('/');
    await userEvent.click(screen.getByRole('link', { name: 'Mundos' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Mundos' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(5);
    expect(screen.getAllByText('Disponible')).toHaveLength(1);
    expect(screen.getAllByText('Próximamente')).toHaveLength(4);
  });

  it('una ruta desconocida muestra la página 404 con enlace al inicio', () => {
    renderAt('/no-existe');
    expect(screen.getByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
  });
});
