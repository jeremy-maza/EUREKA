# Frontend — Matemática bajo reglas (`apps/web`)

La aplicación del juego: React 19 + TypeScript + Vite. Es el workspace de npm `@mbr/web` del monorepo y se instala y se
verifica desde la raíz. El servidor decide todo (mundos desbloqueados, secuencia y sus reglas, dificultad, reto, plazo,
puntos, racha); este frontend solo lo muestra y nunca calcula nada del juego. El contrato HTTP está en §5.2 de
[`EUREKA_MASTER_PLAN.md`](../../EUREKA_MASTER_PLAN.md).

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
    home/                 Inicio = mapa de los cinco mundos (bloqueado / disponible / en curso / completado)
    game/                 Partida por mundo (GamePage), redirección de /juego (PlayRedirect), pantalla final,
                          feedback.ts (textos de resultado) y el grillo
    progress/             «Mi progreso» por mundo (/progreso/:slug): puntos, rachas, reglas dominadas, historial
    leaderboard/          Clasificación por mundo entre compañeros de grupo (/clasificaciones/:slug)
    teacher/              Panel docente (solo lectura)
  components/
    ui/                   Piezas visuales sin conocimiento de la app: Logo, ScreenMessage, FloatingIsland
    common/               Compartidos que conocen la app: InsightsHeader (navegación según rol y sesión),
                          WorldTabs (selector de mundo) y DifficultyBadge («Suave / Normal / Intensa»)
  services/
    api/                  `client.ts` (fetch, errores, 401) y `types.ts` (contratos de la API, a mano)
    storage/              `token-store.ts` (token de acceso en localStorage)
  lib/                    `worlds.ts` (estado de un mundo, mundo por defecto, acentos de color, etiquetas de
                          dificultad) y `useWorldCatalog.ts` (mundos + progreso, con reintento)
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

| Ruta                      | Quién       | Contenido                                                                                        |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `/acceso`, `/registro`    | público     | Inicio de sesión y alta de estudiante                                                            |
| `/`                       | autenticado | Mapa de mundos (los docentes se redirigen a `/docente`)                                          |
| `/juego`                  | estudiante  | Redirige al mundo más indicado: el primero desbloqueado y sin completar; si no hay, `arithmetic` |
| `/juego/:slug`            | estudiante  | Partida en ese mundo                                                                             |
| `/final/:slug`            | estudiante  | Mundo completado (`/final` sin mundo vuelve a `/`)                                               |
| `/progreso/:slug?`        | estudiante  | Mi progreso, con selector de mundo (sin slug: el mundo más jugado)                               |
| `/clasificaciones/:slug?` | estudiante  | Clasificación por mundo (sin slug: el más jugado)                                                |
| `/docente`                | docente     | Panel docente                                                                                    |

`RequireAuth` redirige a `/acceso` sin sesión (y avisa si el servidor rechazó un token guardado); `RequireRole` evita
mostrar a cada rol pantallas que la API le rechazaría con 403. Cualquier otra ruta redirige a `/`. Un slug que no está
en `GET /worlds` muestra «No encontramos ese mundo» con un camino de vuelta.

## Comportamiento del juego (lo decide el servidor)

- **Mundos y desbloqueo.** `GET /worlds` da los cinco mundos (se ordenan por `position`); `GET /progress` dice si cada
  uno está desbloqueado (`unlocked`, `unlockRequirement`) y cuántas veces se completó (`completionsCount`). El mapa
  solo lo refleja. Si se entra en un mundo bloqueado, el servidor responde **403** con su mensaje; la partida lo
  muestra y ofrece ir al primer mundo desbloqueado de la cadena de requisitos (leída de `GET /progress`).
- **El cronómetro no empieza solo.** Al entrar en un mundo se abre la sesión y se lee el progreso: si hay un reto en
  curso (`pendingAttemptId`) se reanuda; si no, se muestra una tarjeta de inicio y el reto (`POST /sessions/:id/attempts`)
  solo empieza al pulsar «Empezar desafío». Tras un acierto el siguiente reto empieza solo; tras un fallo, «Nueva
  secuencia» es una decisión explícita. Si `startSession` informa de un `expiredAttempt`, se avisa una vez (no se repite
  tras un «tiempo agotado» ya mostrado en la partida).
- **Secuencias.** Cada secuencia sortea un subconjunto y un orden de reglas y una dificultad (`EASIER/BASELINE/HARDER`
  → «Suave / Normal / Intensa»); su longitud (`attempt.challengeCount`) varía y la ruta de islas del grillo se adapta
  (una isla por reto más la de llegada).
- **Fallo = reglas descartadas.** Respuesta incorrecta, regla incumplida, sintaxis inválida o tiempo agotado terminan
  la secuencia: el diálogo lista `answer.discardedRules`, explica que la racha vuelve a 0, que **los puntos y las
  reglas dominadas se conservan** y que la próxima secuencia hará un nuevo sorteo de reglas. Acciones: «Nueva secuencia» y «Volver al mapa»; el foco queda
  atrapado en el diálogo y Escape vuelve al mapa (sin empezar ningún reto).
- **Reglas dominadas.** `progress.unlockedRules` son las reglas superadas alguna vez (colección permanente), no las
  activas. Se muestran como «x / ruleCount».
- **Enunciado.** Se muestra `attempt.instruction` encima de la respuesta. `statementKind: 'EQUATION'` se presenta como
  «Resuelve: 3 × x + 4 = 19» con el prefijo «x =» en la respuesta. La x se muestra en cursiva y color. Los símbolos
  permitidos (`attempt.syntax`) se muestran como fichas. En los mundos con decimales `/` se muestra tal cual (fracciones);
  en el resto, como `÷`. **Única validación local:** en una ecuación, una respuesta con la letra x no se envía (sería un
  error de sintaxis que terminaría la secuencia) y se explica cómo responder; todo lo demás lo valida el servidor. Nunca se muestra el resultado esperado.
- **Mundo completado.** `worldCompleted` lleva a `/final/:slug`; si `nextWorldUnlocked` viene informado se celebra y
  se ofrece «Ir al Mundo N».

## Pruebas

Vitest + Testing Library sobre jsdom. La API se simula a nivel de `fetch` con `mockApi({ 'MÉTODO /ruta': handler })`
(`src/test/utils.tsx`); una ruta no simulada responde 599 con su nombre para que ninguna prueba pase por casualidad con
una llamada inesperada. `renderApp('/ruta')` monta la aplicación real con sus rutas y un `data-testid="location"` con la
ruta actual. Cubren: registro, acceso y errores, rutas protegidas por sesión y rol, sesión caducada, mapa de mundos (bloqueado,
disponible, en curso, completado), partida por slug (acierto, reglas que se acumulan, fallo con reglas descartadas y
nueva secuencia, tiempo agotado, conflictos 409, errores de red/API, mundo bloqueado 403, mundo inexistente, ecuaciones
y fichas de sintaxis, secuencias de longitud variable), mundo completado con desbloqueo del siguiente, redirección de
`/juego`, «Mi progreso» y clasificación con cambio de mundo, panel docente (carga, cambio de grupo/estudiante, retos
identificados por mundo) y el cliente HTTP. Los fixtures de los cinco mundos están en `src/test/utils.tsx`
(`allWorlds`, `worldsProgress`, `lockedProgress`).

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
