# Frontend — Matemática bajo reglas (`apps/web`)

La aplicación del juego: React 19 + TypeScript + Vite. Es el workspace de npm `@mbr/web` del monorepo y se instala y se
verifica desde la raíz. El servidor decide todo (reto, reglas activas, plazo, puntos, racha); este frontend solo lo
muestra y nunca calcula nada del juego.

## Arranque

Desde la **raíz** del repositorio (la API y la base de datos deben estar arriba; ver el [README](../../README.md)):

```bash
npm install              # una sola vez, para todo el monorepo (no se usa pnpm)
npm run dev:web          # → http://localhost:5173
```

- **Puerto 5173**, con `strictPort`: si está ocupado, Vite falla en lugar de moverse a otro puerto, porque la API solo
  acepta por CORS el origen `CORS_ORIGIN` (por defecto `http://localhost:5173`). Si necesitas otro puerto, cambia
  `CORS_ORIGIN` en el `.env` de la raíz y arranca con `npm run dev -w apps/web -- --port <puerto>`.
- `VITE_API_URL` (por defecto `http://localhost:3000/api`): copia `apps/web/.env.example` a `apps/web/.env.local` para
  cambiarla. Es la única variable del frontend (tipada en `src/vite-env.d.ts`).
- Cuentas de prueba: `npm run db:seed:demo` (ver [docs/demo.md](../../docs/demo.md)).

## Comandos

Todos se pueden ejecutar desde la raíz con `-w apps/web` o con `npm run <comando>` dentro de `apps/web/`.

| Comando                          | Qué hace                                                 |
| -------------------------------- | -------------------------------------------------------- |
| `npm run dev -w apps/web`        | Servidor de desarrollo (5173)                            |
| `npm run typecheck -w apps/web`  | `tsc -b` (app, pruebas y configuración de Vite)          |
| `npm run lint -w apps/web`       | ESLint con la configuración de la raíz (reglas de React) |
| `npm run test -w apps/web`       | Pruebas (Vitest + Testing Library)                       |
| `npm run test:watch -w apps/web` | Pruebas en modo observación                              |
| `npm run build -w apps/web`      | `tsc -b` + `vite build` → `apps/web/dist`                |
| `npm run preview -w apps/web`    | Sirve el build en <http://localhost:4173>                |

`npm run verify` en la raíz ejecuta typecheck, lint, formato, pruebas y build de **todo** el monorepo, incluido este
workspace. El formato lo comprueba Prettier desde la raíz (`npm run format:check`).

## Estructura

```
src/
  main.tsx                Punto de entrada: monta <App /> y los estilos globales
  vite-env.d.ts           Tipos de Vite y de `import.meta.env` (VITE_API_URL)
  app/
    App.tsx               BrowserRouter + AppRoutes
    router/AppRoutes.tsx  Tabla de rutas y guards (se exporta sin router para montarla en las pruebas)
  features/
    auth/                 AuthContext (sesión y token), components/ (RequireAuth, RequireRole), pages/ (acceso/registro)
    home/                 Inicio: mundos, progreso, reglas descubiertas y estadísticas
    game/                 Partida (GamePage), pantalla final, feedback.ts (textos de resultado) y el grillo
    progress/             «Mi progreso» (/progreso): puntos, rachas, reglas, estadísticas e historial
    leaderboard/          Clasificación entre compañeros de grupo (/clasificaciones)
    teacher/              Panel docente (solo lectura)
  components/
    ui/                   Piezas visuales sin conocimiento de la app: Logo, ScreenMessage, FloatingIsland
    common/               Compartidos que conocen la app: InsightsHeader (navegación según rol y sesión)
  services/
    api/                  `client.ts` (fetch, errores, 401) y `types.ts` (contratos de la API, a mano)
    storage/              `token-store.ts` (token de acceso en localStorage)
  lib/                    `worlds.ts` (slug del Mundo 1, usado por varias funcionalidades)
  styles/                 `global.css` (reset y variables de la identidad visual)
  assets/                 grillo/ (sprites del personaje) y backgrounds/ (fondo opcional de la partida)
  test/                   `setup.ts` y `utils.tsx` (fixtures, API simulada, `renderApp`)
```

Cada funcionalidad agrupa sus `pages/`, sus `components/` y su lógica; solo se crean subcarpetas cuando hay algo que
poner en ellas. Las pruebas viven junto a lo que prueban (`*.test.ts(x)`). El alias `@/` apunta a `src/` (Vite y
`tsconfig.app.json`).

Reglas de dependencia:

- `app → features → components / services / lib`; las capas compartidas nunca importan de `features/` ni de `app/`.
- Una funcionalidad no importa de otra. Única excepción: la sesión (`useAuth` de `features/auth/AuthContext`), que es
  estado global.
- Si algo empieza a usarse en dos funcionalidades, se mueve a `components/`, `services/` o `lib/`.
- Nada se importa de `apps/api`: el contrato con el backend es HTTP y `services/api/types.ts`.

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
mostrar a cada rol pantallas que la API le rechazaría con 403. Cualquier otra ruta redirige a `/`.

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
- Los tipos de `services/api/types.ts` reflejan los DTO de `apps/api` y se mantienen **a mano**: al cambiar un DTO,
  actualiza este archivo (por qué no hay un paquete compartido: ADR 13 en [docs/architecture.md](../../docs/architecture.md)).
- Estilos con CSS Modules y las variables de `src/styles/global.css`; no se cambia la identidad visual sin acordarlo.
- El estado de «cargando/error/reintentar» usa `ScreenMessage`; los efectos de carga no llaman a `setState` de forma
  síncrona (regla `react-hooks/set-state-in-effect`): para reintentar se incrementa un contador de recarga.
