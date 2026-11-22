# Frontend principal — Matemática bajo reglas

Aplicación de la demo: React 19 + TypeScript + Vite. Es un **workspace de npm** del monorepo (`@mbr/frontend`): se
instala y se verifica desde la raíz. El servidor decide todo (reto, reglas activas, plazo, puntos, racha); este frontend
solo lo muestra y nunca calcula nada del juego.

> El primer frontend, `apps/web`, se conserva como **heredado** (`npm run dev:web:legacy`, puerto 5174). No recibe
> funcionalidad nueva.

## Arranque

Desde la **raíz** del repositorio (la API y la base de datos deben estar arriba; ver el [README](../README.md)):

```bash
npm install              # una sola vez, para todo el monorepo (no se usa pnpm)
npm run dev:web          # → http://localhost:5173
```

- **Puerto 5173**, con `strictPort`: si está ocupado, Vite falla en lugar de moverse a otro puerto, porque la API solo
  acepta por CORS el origen `CORS_ORIGIN` (por defecto `http://localhost:5173`). Si necesitas otro puerto, cambia
  `CORS_ORIGIN` en el `.env` de la raíz y arranca con `npm run dev -w frontend -- --port <puerto>`.
- `VITE_API_URL` (por defecto `http://localhost:3000/api`): copia `.env.example` a `.env.local` para cambiarla.
- Cuentas de prueba: `npm run db:seed:demo` (ver [docs/demo.md](../docs/demo.md)).

## Comandos

Todos se pueden ejecutar desde la raíz con `-w frontend` o con `npm run <comando>` dentro de `frontend/`.

| Comando                         | Qué hace                                                 |
| ------------------------------- | -------------------------------------------------------- |
| `npm run dev -w frontend`       | Servidor de desarrollo (5173)                            |
| `npm run typecheck -w frontend` | `tsc -b` (app, pruebas y configuración de Vite)          |
| `npm run lint -w frontend`      | ESLint con la configuración de la raíz (reglas de React) |
| `npm run test -w frontend`      | Pruebas (Vitest + Testing Library), ~3 s                 |
| `npm run build -w frontend`     | `tsc -b` + `vite build` → `frontend/dist`                |

`npm run verify` en la raíz ejecuta typecheck, lint, formato, pruebas y build de **todo** el monorepo, incluido este
workspace. El formato lo comprueba Prettier desde la raíz (`npm run format:check`).

## Estructura

```
src/
  App.tsx                 Rutas (`AppRoutes`, sin router, para poder probarlas) y `BrowserRouter`
  features/
    auth/                 AuthContext (sesión y token), RequireAuth, RequireRole, pantalla de acceso/registro
    home/                 Inicio: mundos, progreso, reglas descubiertas y estadísticas
    game/                 Partida (GamePage), pantalla final y componentes del grillo/islas
    progress/             «Mi progreso» (/progreso): puntos, rachas, reglas, estadísticas e historial
    classifications/      Clasificación entre compañeros de grupo
    teacher/              Panel docente (solo lectura)
  shared/
    api/                  `client.ts` (fetch + errores + token) y `types.ts` (contratos de la API, a mano)
    components/           Logo, ScreenMessage, InsightsHeader
  test/                   `setup.ts` y `utils.tsx` (fixtures, API simulada, `renderApp`)
```

Las pruebas viven junto a lo que prueban (`*.test.ts(x)`).

## Rutas

| Ruta                   | Quién       | Contenido                                       |
| ---------------------- | ----------- | ----------------------------------------------- |
| `/acceso`, `/registro` | público     | Inicio de sesión y alta de estudiante           |
| `/`                    | autenticado | Inicio (los docentes se redirigen a `/docente`) |
| `/juego`, `/final`     | estudiante  | Partida y pantalla de mundo completado          |
| `/progreso`            | estudiante  | Mi progreso                                     |
| `/clasificaciones`     | estudiante  | Clasificación entre compañeros de grupo         |
| `/docente`             | docente     | Panel docente                                   |

`RequireAuth` redirige a `/acceso` sin sesión (y avisa si el servidor rechazó un token guardado); `RequireRole` evita
mostrar a cada rol pantallas que la API le rechazaría con 403.

## Pruebas

Vitest + Testing Library sobre jsdom. La API se simula a nivel de `fetch` con `mockApi({ 'MÉTODO /ruta': handler })`
(`src/test/utils.tsx`); una ruta no simulada responde 599 con su nombre para que ninguna prueba pase por casualidad con
una llamada inesperada. `renderApp('/ruta')` monta la aplicación real con sus rutas y un `data-testid="location"` con la
ruta actual. Cubren: registro, acceso y errores, rutas protegidas por sesión y rol, sesión caducada, partida (acierto,
reglas que se acumulan, fallo y reinicio con las reglas conservadas, tiempo agotado, conflictos 409 y errores de red/API),
«Mi progreso», inicio, clasificación, panel docente (carga y cambio de grupo/estudiante) y el cliente HTTP.

Notas para escribir pruebas del juego:

- Tras un acierto el grillo salta y el siguiente reto se pide al **aterrizar** (`onAnimationEnd`). jsdom no ejecuta
  animaciones CSS: usa el helper `finishJump()` de `features/game/game.test.tsx` (emite `animationend` y
  `webkitAnimationEnd`, porque React escucha este último en jsdom).
- El panel docente tiene pruebas de carga, cambio de grupo/estudiante (sin peticiones cruzadas), error y estado vacío; no
  cubre todavía el detalle visual de sus gráficos.

## Convenciones

- **No se duplica lógica del juego.** Si una pantalla necesita un dato nuevo, se pide a la API.
- Los tipos de `shared/api/types.ts` reflejan los DTO de `apps/api` y se mantienen **a mano**: al cambiar un DTO,
  actualiza este archivo.
- Estilos con CSS Modules y las variables de `src/index.css`; no se cambia la identidad visual sin acordarlo.
- El estado de «cargando/error/reintentar» usa `ScreenMessage`; los efectos de carga no llaman a `setState` de forma
  síncrona (regla `react-hooks/set-state-in-effect`): para reintentar se incrementa un contador de recarga.
