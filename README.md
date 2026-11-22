# Matemática bajo reglas

Juego educativo de matemáticas inspirado en _The Password Game_. El jugador resuelve retos escribiendo
**expresiones matemáticas completas**; cada reto añade una **regla nueva** y todas las anteriores siguen activas.

> Estado: **MVP jugable del Mundo 1 (Aritmética)**: registro/login, partida con temporizador, reglas acumuladas,
> puntuación con multiplicador de racha, «Mi progreso», clasificación entre compañeros y panel docente de solo lectura,
> sobre el backend (motor, JWT con sesiones revocables, puntuación auditable y API REST con Swagger). El frontend
> principal es `frontend/`. Ver [Demo jugable](#demo-jugable) y [Alcance actual](#alcance-actual).

## Mundos

1. Aritmética ← _MVP, único mundo implementado en el motor_
2. Números y signos
3. Fracciones y decimales
4. Álgebra
5. Caos matemático

## Estructura del repositorio

```
apps/
  api/        NestJS + Prisma 7 + PostgreSQL (REST, Swagger)
  web/        Frontend HEREDADO (React + Vite). Conservado, pero ya no es la app de la demo: ver más abajo
frontend/     Frontend PRINCIPAL (React 19 + Vite + TypeScript): es el que se usa en la demo
docs/         Arquitectura y decisiones (ADR)
```

Monorepo con **npm workspaces** (`apps/*` y `frontend`): una sola instalación (`npm install` en la raíz) y un solo
`package-lock.json`. No hay `packages/` compartidos porque todavía no hay código reutilizable entre frontend y backend
(los tipos de la API del frontend se mantienen a mano en `frontend/src/shared/api/types.ts`).

## Requisitos

- Node.js **>= 22.12** (se recomienda 24 LTS; ver `.nvmrc`)
- npm >= 10
- Docker (para PostgreSQL local) **o** un PostgreSQL 15+ propio

## Puesta en marcha local

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env          # ajusta las credenciales si quieres

# 3. Base de datos
npm run db:up                 # PostgreSQL en Docker (docker compose)
npm run db:generate           # genera el cliente de Prisma
npm run db:migrate            # aplica las migraciones (prisma migrate dev)
npm run db:seed               # siembra el catálogo del Mundo 1 (OBLIGATORIO: la API lee los mundos de la BD)

# 4. Arrancar (en dos terminales)
npm run dev:api               # API      → http://localhost:3000/api
npm run dev:web               # Frontend → http://localhost:5173   (frontend/, el principal)
```

- Abre <http://localhost:5173> y sigue la [demo jugable](#demo-jugable).
- Health check: <http://localhost:3000/api/health> (liveness) y `/api/health/ready` (comprueba la BD).
- Swagger / OpenAPI: <http://localhost:3000/api/docs> (JSON en `/api/docs-json`).
- El frontend principal llama a la API directamente (`VITE_API_URL`, por defecto `http://localhost:3000/api`), así que el
  origen del frontend debe coincidir con `CORS_ORIGIN` de la API (por defecto `http://localhost:5173`).

> La API arranca aunque la base de datos no esté disponible (la conexión es perezosa); solo
> `/api/health/ready` devolverá 503.

## Frontend principal (`frontend/`)

`frontend/` (React 19 + Vite + TypeScript, **workspace de npm**) es la aplicación de la demo. Usa la API real para
registro/login, mundos, progreso, sesión de juego, reto, reglas, puntuación, racha, cronómetro, clasificación y panel
docente: el servidor decide todo y el frontend solo lo muestra. Detalle de su estructura y pruebas:
[`frontend/README.md`](./frontend/README.md).

```bash
# API + BD como arriba (incluido `npm run db:seed`), y luego, desde la raíz:
npm run dev:web               # → http://localhost:5173
# opcional: `cp frontend/.env.example frontend/.env.local` para cambiar VITE_API_URL
```

**Puerto:** el frontend principal usa **5173** (`strictPort`: si está ocupado, Vite falla en voz alta en lugar de
cambiar de puerto, porque la API rechazaría por CORS cualquier otro origen). El heredado `apps/web` usa **5174**.

| Variable       | Dónde    | Por defecto                 | Descripción                                            |
| -------------- | -------- | --------------------------- | ------------------------------------------------------ |
| `VITE_API_URL` | frontend | `http://localhost:3000/api` | URL base de la API (con `/api`)                        |
| `CORS_ORIGIN`  | API      | `http://localhost:5173`     | Origen del frontend permitido por CORS (un solo valor) |

Rutas: `/acceso`, `/registro`, `/` (inicio: mundos, progreso y estadísticas), `/juego`, `/final`, `/progreso` («Mi
progreso»: puntos, rachas, reglas, estadísticas e historial), `/clasificaciones` (estudiantes; solo compañeros de grupo)
y `/docente` (docentes; panel con estadísticas reales de sus grupos). Sin botón de pausa: el cronómetro es del servidor y
no se puede detener.

### Frontend heredado (`apps/web`)

`apps/web` es el primer frontend (React + Vite, con proxy `/api` a la API). **Se conserva** —sigue en los workspaces, con
sus pruebas— pero ya no es la app de la demo y no recibe funcionalidad nueva. Se arranca con `npm run dev:web:legacy`
(<http://localhost:5174>). Su retirada está pendiente de aprobación explícita.

## Datos de demostración

`npm run db:seed:demo` (tras `npm run db:seed`) crea cuentas con escenarios listos —jugador nuevo, progreso, secuencia
fallida, avanzado (racha 8, ×5) y reto expirado— más un docente demo y su grupo. Se generan jugando contra el motor real,
son deterministas, no tocan usuarios reales y se niegan a ejecutarse en producción. Contraseña: `demo-eureka-2026`.
Detalle, tabla de escenarios y reinicio: [docs/demo.md](./docs/demo.md).

## Demo jugable

1. **Crear cuenta** (`/registro`: nombre, correo y contraseña de 8+ caracteres) → entras automáticamente.
2. **Mundos → Jugar** (Mundo 1: Aritmética). La pantalla muestra puntos, racha y multiplicador del próximo acierto.
3. **Reto**: una operación (p. ej. `3 * 7`). Escribe una **expresión** con el mismo valor que cumpla TODAS las reglas
   activas (p. ej. `7 * 1 * 3`). El cronómetro es el del servidor; al llegar a 0 el servidor cierra el reto por tiempo.
4. **Acierto**: suma `100 × multiplicador` (×1, ×1.5, ×2… hasta ×5 con la racha), desbloquea la regla del reto y pasa al siguiente.
5. **Fallo** (resultado erróneo, sintaxis, regla rota o tiempo agotado): racha a 0 y la secuencia vuelve al reto 1;
   los puntos y las reglas ya desbloqueadas se conservan (el aviso de fin permite reiniciar la secuencia).
6. Completar los 4 retos cierra el mundo; **Jugar de nuevo** inicia otra tanda conservando reglas y puntos.
7. **Mi progreso** (`/progreso`, enlace en el inicio): puntos, racha actual/mejor, multiplicador, reglas descubiertas,
   estadísticas, historial de intentos y libro de puntos recientes; todo viene de la API.

Secuencia de referencia del Mundo 1 (soluciones válidas con todas las reglas acumuladas): `21` → `7*1*6` → `7*1` → `7*1*4+3*4`.
El frontend no calcula nada del juego: solo muestra lo que devuelve la API (reto, reglas, plazo, puntos, racha).

### Sin Docker

Cualquier PostgreSQL sirve: ajusta `DATABASE_URL` en `.env` y omite `npm run db:up`.

## Variables de entorno

Se define todo en un único `.env` en la raíz (ver [`.env.example`](./.env.example)). La API y la CLI de Prisma lo
leen desde `apps/api`; Docker Compose, desde la raíz. **Nunca se commitea `.env`.**

| Variable                                     | Obligatoria       | Por defecto                    | Descripción                                                          |
| -------------------------------------------- | ----------------- | ------------------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`                               | Sí (salvo `test`) | —                              | Cadena de conexión de PostgreSQL                                     |
| `POSTGRES_USER/PASSWORD/DB/PORT`             | Para Docker       | —                              | Credenciales del contenedor (deben casar con la URL)                 |
| `NODE_ENV`                                   | No                | `development`                  | `development` \| `test` \| `production`                              |
| `PORT`                                       | No                | `3000`                         | Puerto de la API                                                     |
| `CORS_ORIGIN`                                | No                | `http://localhost:5173`        | Origen permitido por CORS                                            |
| `GAME_BASE_TIME_SECONDS`                     | No                | `60`                           | Tiempo base por reto                                                 |
| `GAME_ADDITIONAL_TIME_PER_RULE_SECONDS`      | No                | `15`                           | Segundos extra por regla activa adicional                            |
| `JWT_SECRET`                                 | **Sí**            | —                              | Secreto HS256 (>= 32 chars; el de ejemplo se rechaza en producción)  |
| `JWT_EXPIRES_IN_SECONDS`                     | No                | `3600`                         | Validez del token de acceso                                          |
| `DATABASE_POOL_MAX`                          | No                | (`pg`: 10)                     | Conexiones máximas del pool de PostgreSQL                            |
| `GAME_BASE_POINTS`                           | No                | `100`                          | Puntos base por acierto (entero)                                     |
| `GAME_STREAK_MULTIPLIER_STEP`                | No                | `0.5`                          | Incremento del multiplicador por acierto consecutivo                 |
| `GAME_MAX_STREAK_MULTIPLIER`                 | No                | `5`                            | Tope del multiplicador                                               |
| `TRUST_PROXY`                                | No                | `false`                        | Saltos de proxy (`1`), `loopback`, CIDR… Determina la IP del cliente |
| `PASSWORD_MIN_LENGTH`                        | No                | `8`                            | Longitud mínima de contraseña (8–64; recomendado 12)                 |
| `LOGIN_MAX_ATTEMPTS_IP_EMAIL / _EMAIL / _IP` | No                | `5` / `20` / `100`             | Intentos de login por ventana (IP+correo / correo / IP)              |
| `LOGIN_WINDOW_SECONDS`                       | No                | `900`                          | Ventana del limitador de login                                       |
| `LOGIN_LOCK_BASE_SECONDS / _MAX_SECONDS`     | No                | `60` / `900`                   | Bloqueo temporal progresivo (se duplica; con tope)                   |
| `PASSWORD_CHANGE_MAX_ATTEMPTS`               | No                | `5`                            | Fallos con la contraseña actual antes de bloquear                    |
| `PASSWORD_RESET_TTL_MINUTES`                 | No                | `30`                           | Validez del enlace de recuperación                                   |
| `PASSWORD_RESET_COOLDOWN_SECONDS`            | No                | `60`                           | Espera mínima entre correos de recuperación de una cuenta            |
| `PASSWORD_RESET_MAX_REQUESTS_PER_IP`         | No                | `10`                           | Solicitudes de recuperación por IP y hora                            |
| `PASSWORD_RESET_URL`                         | No                | `<CORS_ORIGIN>/reset-password` | URL del frontend para el enlace del correo (`#token=…`)              |
| `MAIL_TRANSPORT`                             | No                | `disabled`                     | `disabled` \| `console` (solo desarrollo, prohibido en producción)   |
| `AUTH_RETENTION_DAYS`                        | No                | `30`                           | Días que se conserva lo caducado antes de purgarlo                   |
| `AUTH_CLEANUP_INTERVAL_MINUTES`              | No                | `360`                          | Purga periódica en proceso (0 = desactivada)                         |
| `DEMO_PASSWORD`                              | No                | `demo-eureka-2026`             | Contraseña de las cuentas demo (solo `db:seed:demo`)                 |

Las variables se validan al arrancar (`class-validator`); si falta o es inválida alguna, la API falla con un mensaje claro.
Detalle de las de autenticación (límites, correo, proxies): [docs/authentication.md](./docs/authentication.md#10-variables-de-entorno).

## Scripts (desde la raíz)

| Comando                   | Qué hace                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| `npm run dev:api`         | API en desarrollo (<http://localhost:3000/api>)                      |
| `npm run dev:web`         | Frontend principal `frontend/` (<http://localhost:5173>)             |
| `npm run dev:web:legacy`  | Frontend heredado `apps/web` (<http://localhost:5174>)               |
| `npm run verify`          | typecheck + lint + format:check + tests + build (todo lo anterior)   |
| `npm test`                | Tests del API (Jest), del frontend principal y del heredado (Vitest) |
| `npm run typecheck`       | TypeScript en API, `frontend/` y `apps/web`                          |
| `npm run lint`            | ESLint (flat config) en todo el monorepo, incluido `frontend/`       |
| `npm run format[:check]`  | Prettier (todo el repositorio, incluido `frontend/`)                 |
| `npm run build`           | Compila API (`apps/api/dist`), `frontend/dist` y `apps/web/dist`     |
| `npm run db:up / db:down` | Levanta / detiene PostgreSQL con Docker Compose                      |
| `npm run db:generate`     | `prisma generate`                                                    |
| `npm run db:migrate`      | `prisma migrate dev` (crea/aplica migraciones en desarrollo)         |
| `npm run db:seed`         | Siembra mundo/reglas/retos (idempotente; valida resolubilidad)       |
| `npm run db:seed:demo`    | (Re)crea cuentas y escenarios demo (solo desarrollo)                 |
| `npm run db:demo:reset`   | Elimina SOLO las cuentas demo (`@demo.eureka.local`)                 |
| `npm run admin:create`    | Crea un administrador (script operativo; contraseña por consola)     |
| `npm run auth:cleanup`    | Purga sesiones/tokens/contadores de autenticación caducados          |

En `apps/api` también: `npm run test:cov` (cobertura), `npm run db:studio`, `npm run db:migrate:deploy` (producción).
En `frontend/`: `npm run test:watch -w frontend` (pruebas en modo observación).

## Pruebas

```bash
npm test                          # todo: API (unitarias + integración), frontend principal y heredado
npm run test -w frontend          # solo el frontend principal (Vitest + Testing Library), ~3 s
npm run test:unit -w apps/api     # unitarias del backend (Jest + ts-jest), ~1 s
npm run test:integration -w apps/api  # integración HTTP + PostgreSQL real, ~7 s
npm run test:cov -w apps/api      # cobertura de las unitarias
```

- **Unitarias:** el motor (parser, evaluador, reglas, temporizador, puntuación, progresión, `GameEngine`),
  configuración y primitivas de seguridad (hash de contraseñas, JWT, política de contraseñas, lógica pura del limitador,
  normalización de IP, transportes de correo). No usan HTTP ni base de datos.
- **Integración:** la aplicación Nest COMPLETA (guards, pipes, filtros) sobre HTTP real y **PostgreSQL real**: un
  PGlite (Postgres en WASM) en proceso al que se aplican **las migraciones SQL del repositorio**. No necesitan Docker.
  El reloj del servidor es inyectable (`Clock`), así que los plazos se prueban sin esperas.
- **Frontend (`frontend/`):** Vitest + Testing Library sobre jsdom, con la API simulada a nivel de `fetch`
  (`src/test/utils.tsx`; una ruta sin simular falla la prueba). Montan las rutas reales de la app y cubren registro,
  acceso, rutas protegidas por sesión y rol, sesión caducada, partida (acierto, progresión de reglas, fallo, reinicio,
  tiempo agotado, conflictos y errores de la API), «Mi progreso», inicio, clasificación, panel docente (carga y cambio de
  grupo/estudiante) y el cliente HTTP.
- Limitación: PGlite comparte una sola sesión, por lo que la CI ejecuta las pruebas con un pool de 1 conexión. La
  serialización entre peticiones concurrentes (`FOR UPDATE`) se prueba de forma lógica, no con paralelismo real de
  conexiones; conviene un smoke test adicional contra un PostgreSQL de verdad (Docker) antes de producción.

## Base de datos

- PostgreSQL + **Prisma 7** (adaptador `pg`). Esquema: [`apps/api/prisma/schema.prisma`](./apps/api/prisma/schema.prisma).
- Migraciones versionadas en `apps/api/prisma/migrations`. Tras cambiar el esquema: `npm run db:migrate`.
- El cliente se genera en `apps/api/src/generated/prisma` (ignorado por git); `build`, `typecheck` y `test`
  lo regeneran automáticamente.
- Modelo y decisiones: [docs/architecture.md](./docs/architecture.md#modelo-de-datos).

## API

Swagger UI en `/api/docs` (JSON en `/api/docs-json`). Referencia y ejemplos: [docs/api.md](./docs/api.md).
Todo endpoint exige `Authorization: Bearer <token>` (de una sesión vigente) salvo `/api/auth/{register,login,password/*}` y `/api/health*`. Los errores siempre tienen
la forma `{ statusCode, error, message, path, timestamp }`.

| Método | Ruta                                                                          | Descripción                                                    |
| ------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| POST   | `/auth/register`                                                              | Registra un estudiante                                         |
| POST   | `/auth/login`                                                                 | Crea una sesión revocable y devuelve su JWT (limita intentos)  |
| POST   | `/auth/change-password`                                                       | Cambia la contraseña propia (revoca todas las sesiones)        |
| POST   | `/auth/password/forgot` · `/auth/password/reset`                              | Recuperación por correo (respuesta genérica; token de un uso)  |
| GET    | `/auth/sessions`                                                              | Mis sesiones (vigentes o historial)                            |
| DELETE | `/auth/sessions/:sessionId`                                                   | Revoca una de mis sesiones                                     |
| POST   | `/auth/logout` · `/auth/logout-all`                                           | Cierra la sesión actual / todas las mías                       |
| GET    | `/users/me`                                                                   | Perfil propio                                                  |
| GET    | `/worlds`                                                                     | Mundos disponibles                                             |
| GET    | `/progress`                                                                   | Progreso y racha en todos los mundos                           |
| GET    | `/worlds/:slug/progress`                                                      | Progreso, racha, reglas, estadísticas en un mundo              |
| GET    | `/worlds/:slug/rules`                                                         | Reglas acumuladas                                              |
| GET    | `/worlds/:slug/leaderboard`                                                   | Clasificación entre compañeros de grupo (nombre y puntos)      |
| GET    | `/worlds/:slug/score`                                                         | Puntos, racha, multiplicador y libro de puntos reciente        |
| GET    | `/worlds/:slug/attempts`                                                      | Historial de intentos (cursor)                                 |
| POST   | `/worlds/:slug/sessions`                                                      | Inicia (201) o reanuda (200) la sesión                         |
| POST   | `/sessions/:id/end`                                                           | Termina la sesión                                              |
| POST   | `/sessions/:id/attempts`                                                      | Inicia el reto actual (arranca el plazo) o devuelve el abierto |
| GET    | `/sessions/:id/attempts/current`                                              | Reto en curso                                                  |
| POST   | `/attempts/:id/answer`                                                        | Envía la expresión (única entrada del cliente)                 |
| GET    | `/users/me/groups`                                                            | Grupos del estudiante (con sus docentes)                       |
| POST   | `/admin/teachers`                                                             | Crea un docente (solo `ADMIN`)                                 |
| \*     | `/admin/groups…`                                                              | Grupos, asignaciones docentes y membresías (solo `ADMIN`)      |
| \*     | `/teacher/groups…`                                                            | Mis grupos y membresías (solo `TEACHER`, grupos asignados)     |
| GET    | `/teacher/dashboard`, `/teacher/groups/:id/{dashboard,statistics,students/…}` | Panel docente (datos)                                          |

Grupos, docentes, autorización y métricas del panel: [docs/groups-and-teachers.md](./docs/groups-and-teachers.md).
Primer administrador: `ADMIN_EMAIL=… ADMIN_NAME=… npm run admin:create` (ver el documento anterior, sección 3).

## Alcance actual

Implementado y verificado:

- Monorepo, TypeScript, ESLint, Prettier, variables de entorno validadas, Docker Compose para PostgreSQL.
- **Motor del juego** (TypeScript puro) del Mundo 1: parser seguro, evaluación exacta, reglas extensibles y acumulativas,
  temporizador, racha/puntuación en enteros, progresión y garantía de resolubilidad del catálogo.
- **Cuentas y autenticación (solo backend)**: sesiones JWT revocables (`jti` ↔ `auth_sessions`; logout, logout-all, revocar una
  sesión, listado propio), cambio de contraseña, recuperación por correo (token de 256 bits guardado como SHA-256, un solo uso),
  limitador de login persistente en PostgreSQL (IP, correo e IP+correo; bloqueo temporal progresivo), política de
  contraseñas y abstracción de correo. Detalle, flujos, configuración y limitaciones: [docs/authentication.md](./docs/authentication.md).
- **Persistencia y API**: auth JWT (estudiantes/docentes/admin con guards por rol), sesiones, intentos con plazo del
  servidor, resolución transaccional e idempotente, libro de puntos solo-inserción, estadísticas, historial.
- **Grupos y docentes (backend)**: grupos con baja lógica, asignaciones docente↔grupo y membresías con historial, aprovisionamiento
  de docentes por administradores, autorización por grupo con 404 uniforme y API del panel docente (actividad, estadísticas,
  estudiantes, intentos). En el frontend solo existe el panel docente **de solo lectura**: crear grupos, asignar docentes o
  añadir estudiantes se hace por API (ver [docs/groups-and-teachers.md](./docs/groups-and-teachers.md)).
- Esquema Prisma con 4 migraciones (incluye índices únicos parciales, CHECKs y trigger de solo-inserción) y seed.
- **Frontend principal** (`frontend/`, React 19 + Vite): registro y login (token en `localStorage`, rutas protegidas por
  sesión y rol), pantalla de juego (reto, reglas activas con la nueva resaltada, cuenta atrás del servidor, resultado,
  reinicio de secuencia), inicio con mundos y progreso, «Mi progreso», clasificación entre compañeros de grupo y panel
  docente de solo lectura. Solo el Mundo 1; los demás aparecen como «Próximamente». Sin pantallas de administración,
  de recuperación ni de cambio de contraseña (la API sí existe). Pruebas automáticas en `npm test`.

**No** implementado (módulos previstos): `rankings`, `rewards`, refresco de tokens, entrega real de correo (no hay proveedor
configurado: ver [docs/authentication.md](./docs/authentication.md#6-correo-electrónico)), MFA,
dificultad adaptativa (solo la interfaz `DifficultyPolicy`), mundos 2-5.

## Motor matemático (resumen)

- Parser de descenso recursivo → AST (sin `eval`/`new Function`); alfabeto cerrado: dígitos, `+ - * / ( ) =`
  (también `× ÷ −`). Sin decimales ni multiplicación implícita.
- Evaluación con fracciones exactas (`BigInt`): `7 / 2 * 2` vale exactamente `7`; división entre cero detectada.
- Una respuesta es `expresión` o `expresión = resultado` (p. ej. `41 + 1 = 42`). El resultado declarado debe coincidir
  con el valor, pero **no** está sujeto a las reglas.
- Reglas estructuradas (`id`, `type`, `description`, `config`) separadas de los retos; tipos implementados:
  `FORBIDDEN_DIGIT` y `REQUIRED_OPERATION`. Se añaden tipos nuevos registrando un `RuleHandler`.
- Tiempo, puntuación y racha configurables; el reloj siempre es del servidor.

Más detalle en [docs/architecture.md](./docs/architecture.md).
