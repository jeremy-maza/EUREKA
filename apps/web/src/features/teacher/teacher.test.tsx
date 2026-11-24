import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allWorlds, type Handler, mockApi, ok, renderApp, sequence, signIn, teacher } from '@/test/utils';
import type { StudentOverview, TeacherGroup } from '@/services/api/types';

const totals = {
  points: 0,
  attempts: 0,
  correct: 0,
  incorrect: 0,
  timeouts: 0,
  accuracyPercent: null,
  averageCorrectResponseTimeMs: null,
};

const group = (id: string, name: string): TeacherGroup => ({
  id,
  name,
  description: null,
  status: 'ACTIVE',
  activeStudentCount: 1,
  activeTeacherCount: 1,
});

const overview = (id: string, displayName: string): StudentOverview => ({
  student: { id, displayName, email: `${id}@example.com` },
  joinedAt: '2026-11-01T10:00:00.000Z',
  totals: { ...totals, challengesCompleted: 0, lastActivityAt: null },
});

const dashboard = (...groups: TeacherGroup[]) => ({
  generatedAt: '2026-11-21T10:00:00.000Z',
  groups: groups.map((item) => ({
    group: item,
    activity: {
      studentCount: 1,
      studentsWithActivity: 0,
      activeStudentsLast7Days: 0,
      lastActivityAt: null,
      totals,
    },
  })),
});

/** Rutas del panel para un grupo con sus estudiantes. */
function groupRoutes(groupId: string, students: StudentOverview[]): Record<string, Handler> {
  const routes: Record<string, Handler> = {
    [`GET /teacher/groups/${groupId}/statistics`]: () =>
      ok({
        generatedAt: '2026-11-21T10:00:00.000Z',
        studentCount: students.length,
        commonErrors: [],
        frequentlyViolatedRules: [],
        challengesNeedingReinforcement: [],
        studentsNeedingAttention: [],
      }),
    [`GET /teacher/groups/${groupId}/dashboard/students?limit=100`]: () =>
      ok({ items: students, nextCursor: null }),
  };
  for (const { student } of students) {
    routes[`GET /teacher/groups/${groupId}/students/${student.id}/statistics`] = () =>
      ok({
        generatedAt: '2026-11-21T10:00:00.000Z',
        student: { id: student.id, displayName: student.displayName },
        worlds: [],
      });
    routes[`GET /teacher/groups/${groupId}/students/${student.id}/attempts?limit=100`] = () =>
      ok({ items: [], nextCursor: null });
  }
  return routes;
}

const luis = overview('s1', 'Luis');
const ana = overview('s2', 'Ana');
const marta = overview('s3', 'Marta');

function panel(extra: Record<string, Handler> = {}) {
  return mockApi({
    'GET /users/me': () => ok(teacher),
    'GET /worlds': () => ok(allWorlds),
    'GET /teacher/dashboard': () => ok(dashboard(group('g1', 'Grupo 1'), group('g2', 'Grupo 2'))),
    ...groupRoutes('g1', [luis, ana]),
    ...groupRoutes('g2', [marta]),
    ...extra,
  });
}

/** El recorrido del estudiante es un <article> etiquetado con su nombre. */
const journey = (name: string) => screen.findByRole('article', { name });
const roster = () => within(screen.getByRole('navigation', { name: 'Aprendices del grupo' }));
const studentRequests = (api: ReturnType<typeof panel>) =>
  api.calls
    .map((call) => call.key)
    .filter((key) => key.includes('/students/') && key.endsWith('/statistics'));

beforeEach(() => signIn());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('panel docente', () => {
  it('carga el primer grupo y abre el recorrido de su primer estudiante', async () => {
    const api = panel();
    renderApp('/docente');

    expect(await screen.findByRole('heading', { name: 'Mapa de conocimientos' })).toBeInTheDocument();
    expect(screen.getByLabelText('Grupo')).toHaveValue('g1');
    await waitFor(() => expect(roster().getAllByRole('button')).toHaveLength(2));
    await waitFor(() => expect(studentRequests(api)).toHaveLength(1));
    expect(studentRequests(api)[0]).toMatch(/^GET \/teacher\/groups\/g1\/students\/s\d\/statistics$/);
    expect(await journey('Luis')).toBeInTheDocument();
  });

  it('al cambiar de grupo reinicia la selección y nunca pide un estudiante con el grupo equivocado', async () => {
    const api = panel();
    renderApp('/docente');
    await waitFor(() => expect(roster().getAllByRole('button')).toHaveLength(2));
    await waitFor(() => expect(studentRequests(api)).toHaveLength(1));

    await userEvent.selectOptions(screen.getByLabelText('Grupo'), 'g2');

    expect(await journey('Marta')).toBeInTheDocument();
    expect(roster().getAllByRole('button')).toHaveLength(1);
    expect(api.count('GET /teacher/groups/g2/statistics')).toBe(1);
    // Los estudiantes de g1 solo se pidieron con g1 y el de g2 solo con g2 (sin combinaciones cruzadas).
    const requests = studentRequests(api);
    expect(requests.filter((key) => key.includes('/g2/') && /s[12]\//.test(key))).toEqual([]);
    expect(requests.filter((key) => key.includes('/g1/') && key.includes('s3'))).toEqual([]);
    expect(requests.at(-1)).toBe('GET /teacher/groups/g2/students/s3/statistics');
  });

  it('elegir otro estudiante pide su detalle una sola vez; pulsar el ya elegido no repite la petición', async () => {
    const api = panel();
    renderApp('/docente');
    await waitFor(() => expect(roster().getAllByRole('button')).toHaveLength(2));
    await waitFor(() => expect(studentRequests(api)).toHaveLength(1));
    const selected = roster()
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-pressed') === 'true') as HTMLElement;
    const other = roster()
      .getAllByRole('button')
      .find((button) => button !== selected) as HTMLElement;

    await userEvent.click(selected);
    expect(studentRequests(api)).toHaveLength(1);

    await userEvent.click(other);
    await waitFor(() => expect(studentRequests(api)).toHaveLength(2));
    expect(other).toHaveAttribute('aria-pressed', 'true');
  });

  it('muestra el error y permite reintentar', async () => {
    const api = panel({
      'GET /teacher/dashboard': sequence(
        { status: 500, body: { message: 'Error interno del servidor.' } },
        ok(dashboard(group('g1', 'Grupo 1'))),
      ),
    });
    renderApp('/docente');

    expect(await screen.findByText('No pudimos cargar tu panel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('heading', { name: 'Mapa de conocimientos' })).toBeInTheDocument();
    expect(api.count('GET /teacher/dashboard')).toBe(2);
  });

  it('sin grupos asignados lo explica y no pide datos de ningún grupo', async () => {
    const api = panel({ 'GET /teacher/dashboard': () => ok(dashboard()) });
    renderApp('/docente');

    expect(await screen.findByText(/Todavía no tienes grupos activos asignados/)).toBeInTheDocument();
    expect(api.calls.some((call) => call.key.includes('/teacher/groups/'))).toBe(false);
  });

  it('con varios mundos y secuencias de distinta longitud, cada reto se identifica por su mundo', async () => {
    const challenge = (worldSlug: string, position: number, expression: string, failures: number) => ({
      worldSlug,
      position,
      expression,
      attempts: failures + 1,
      correct: 1,
      failures,
      failureRatePercent: null,
    });
    panel({
      'GET /teacher/dashboard': () => ok(dashboard(group('g1', 'Grupo 1'))),
      'GET /teacher/groups/g1/statistics': () =>
        ok({
          generatedAt: '2026-11-21T10:00:00.000Z',
          studentCount: 1,
          commonErrors: [{ worldSlug: 'signs', reason: 'WRONG_RESULT', count: 5, sharePercent: 100 }],
          frequentlyViolatedRules: [],
          challengesNeedingReinforcement: [
            challenge('signs', 6, '-3 * 4', 4),
            challenge('arithmetic', 2, '3 * 7', 1),
          ],
          studentsNeedingAttention: [],
        }),
      'GET /teacher/groups/g1/dashboard/students?limit=100': () => ok({ items: [luis], nextCursor: null }),
      'GET /teacher/groups/g1/students/s1/statistics': () =>
        ok({
          generatedAt: '2026-11-21T10:00:00.000Z',
          student: { id: 's1', displayName: 'Luis' },
          worlds: [
            {
              worldSlug: 'signs',
              worldName: 'Números y signos',
              consecutiveFailures: 0,
              commonErrors: [],
              violatedRules: [],
              challenges: [challenge('signs', 6, '-3 * 4', 2), challenge('signs', 1, '-2 + 5', 0)],
            },
            {
              worldSlug: 'arithmetic',
              worldName: 'Aritmética',
              consecutiveFailures: 0,
              commonErrors: [],
              violatedRules: [],
              challenges: [challenge('arithmetic', 1, '3 * 7', 0)],
            },
          ],
        }),
      'GET /teacher/groups/g1/students/s1/attempts?limit=100': () => ok({ items: [], nextCursor: null }),
    });
    renderApp('/docente');

    expect(await screen.findByText('Mundo 2 · Posición 6 de la secuencia · -3 * 4')).toBeInTheDocument();
    expect(screen.getByText('Mundo 1 · Posición 2 de la secuencia · 3 * 7')).toBeInTheDocument();
    const article = await journey('Luis');
    const mastered = within(
      (await within(article).findByRole('heading', { name: /Islas dominadas/ })).parentElement as HTMLElement,
    );
    // Ordenados por mundo (posición) y por reto; un mismo número de reto en dos mundos no se confunde.
    expect(mastered.getAllByText(/· Posición/).map((item) => item.textContent)).toEqual([
      'Aritmética · Posición 1 de la secuencia',
      'Números y signos · Posición 1 de la secuencia',
    ]);
    expect(within(article).getByText('Números y signos · Posición 6 de la secuencia')).toBeInTheDocument();
    expect(article).toHaveTextContent('Las reglas y los retos se sortean en cada secuencia');
    expect(
      screen.getByText('Por posición en la secuencia: las reglas varían en cada secuencia.'),
    ).toBeInTheDocument();
  });
});
