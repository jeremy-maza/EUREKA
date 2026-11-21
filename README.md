# Matemática bajo reglas

Juego educativo de matemáticas inspirado en _The Password Game_. El jugador resuelve retos escribiendo
**expresiones matemáticas completas**; cada reto añade una **regla nueva** y todas las anteriores siguen activas.

> Estado: **backend del juego del Mundo 1 (Aritmética) funcional**: motor, autenticación JWT, sesiones, retos con
> temporizador del servidor, reglas acumuladas, puntuación auditable y API REST documentada con Swagger.
> La interfaz de juego aún no existe; ver [Alcance actual](#alcance-actual).

## Mundos

1. Aritmética ← _MVP, único mundo implementado en el motor_
2. Números y signos
3. Fracciones y decimales
4. Álgebra
5. Caos matemático

## Estructura del repositorio

```
apps/
  api/   NestJS + Prisma 7 + PostgreSQL (REST, Swagger)
  web/   React + Vite + TypeScript
docs/    Arquitectura y decisiones (ADR)
```

Monorepo con **npm workspaces**. No hay `packages/` compartidos porque todavía no hay código reutilizable
entre frontend y backend (se creará cuando haya tipos/contratos que lo justifiquen).

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
npm run dev:api               # API   → http://localhost:3000/api
npm run dev:web               # Web   → http://localhost:5173
```

- Health check: <http://localhost:3000/api/health> (liveness) y `/api/health/ready` (comprueba la BD).
- Swagger / OpenAPI: <http://localhost:3000/api/docs> (JSON en `/api/docs-json`).
- El frontend llama a `/api/*`; Vite lo reenvía al backend (proxy) para evitar CORS en desarrollo.

> La API arranca aunque la base de datos no esté disponible (la conexión es perezosa); solo
> `/api/health/ready` devolverá 503.

### Sin Docker

Cualquier PostgreSQL sirve: ajusta `DATABASE_URL` en `.env` y omite `npm run db:up`.

## Variables de entorno

Se define todo en un único `.env` en la raíz (ver [`.env.example`](./.env.example)). La API y la CLI de Prisma lo
leen desde `apps/api`; Docker Compose, desde la raíz. **Nunca se commitea `.env`.**

| Variable                                | Obligatoria       | Por defecto             | Descripción                                                         |
| --------------------------------------- | ----------------- | ----------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                          | Sí (salvo `test`) | —                       | Cadena de conexión de PostgreSQL                                    |
| `POSTGRES_USER/PASSWORD/DB/PORT`        | Para Docker       | —                       | Credenciales del contenedor (deben casar con la URL)                |
| `NODE_ENV`                              | No                | `development`           | `development` \| `test` \| `production`                             |
| `PORT`                                  | No                | `3000`                  | Puerto de la API                                                    |
| `CORS_ORIGIN`                           | No                | `http://localhost:5173` | Origen permitido por CORS                                           |
| `GAME_BASE_TIME_SECONDS`                | No                | `60`                    | Tiempo base por reto                                                |
| `GAME_ADDITIONAL_TIME_PER_RULE_SECONDS` | No                | `15`                    | Segundos extra por regla activa adicional                           |
| `JWT_SECRET`                            | **Sí**            | —                       | Secreto HS256 (>= 32 chars; el de ejemplo se rechaza en producción) |
| `JWT_EXPIRES_IN_SECONDS`                | No                | `3600`                  | Validez del token de acceso                                         |
| `DATABASE_POOL_MAX`                     | No                | (`pg`: 10)              | Conexiones máximas del pool de PostgreSQL                           |
| `GAME_BASE_POINTS`                      | No                | `100`                   | Puntos base por acierto (entero)                                    |
| `GAME_STREAK_MULTIPLIER_STEP`           | No                | `0.5`                   | Incremento del multiplicador por acierto consecutivo                |
| `GAME_MAX_STREAK_MULTIPLIER`            | No                | `5`                     | Tope del multiplicador                                              |

Las variables se validan al arrancar (`class-validator`); si falta o es inválida alguna, la API falla con un mensaje claro.

## Scripts (desde la raíz)

| Comando                   | Qué hace                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| `npm run verify`          | typecheck + lint + format:check + tests + build (todo lo anterior) |
| `npm test`                | Tests del API (Jest) y del web (Vitest)                            |
| `npm run typecheck`       | `tsc --noEmit` en ambas apps                                       |
| `npm run lint`            | ESLint (flat config) en todo el monorepo                           |
| `npm run format[:check]`  | Prettier                                                           |
| `npm run build`           | Compila API (`apps/api/dist`) y web (`apps/web/dist`)              |
| `npm run db:up / db:down` | Levanta / detiene PostgreSQL con Docker Compose                    |
| `npm run db:generate`     | `prisma generate`                                                  |
| `npm run db:migrate`      | `prisma migrate dev` (crea/aplica migraciones en desarrollo)       |
| `npm run db:seed`         | Siembra mundo/reglas/retos (idempotente; valida resolubilidad)     |
| `npm run admin:create`    | Crea un administrador (script operativo; contraseña por consola)   |

En `apps/api` también: `npm run test:cov` (cobertura), `npm run db:studio`, `npm run db:migrate:deploy` (producción).

## Pruebas

```bash
npm test                          # todo: API (unitarias + integración) y web
npm run test:unit -w apps/api     # unitarias del backend (Jest + ts-jest), ~1 s
npm run test:integration -w apps/api  # integración HTTP + PostgreSQL real, ~7 s
npm run test:cov -w apps/api      # cobertura de las unitarias
```

- **Unitarias:** el motor (parser, evaluador, reglas, temporizador, puntuación, progresión, `GameEngine`),
  configuración y primitivas de seguridad (hash de contraseñas, JWT). No usan HTTP ni base de datos.
- **Integración:** la aplicación Nest COMPLETA (guards, pipes, filtros) sobre HTTP real y **PostgreSQL real**: un
  PGlite (Postgres en WASM) en proceso al que se aplican **las migraciones SQL del repositorio**. No necesitan Docker.
  El reloj del servidor es inyectable (`Clock`), así que los plazos se prueban sin esperas.
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
Todo endpoint exige `Authorization: Bearer <token>` salvo `/api/auth/*` y `/api/health*`. Los errores siempre tienen
la forma `{ statusCode, error, message, path, timestamp }`.

| Método | Ruta                                                                          | Descripción                                                    |
| ------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| POST   | `/auth/register`                                                              | Registra un estudiante                                         |
| POST   | `/auth/login`                                                                 | Devuelve un JWT                                                |
| GET    | `/users/me`                                                                   | Perfil propio                                                  |
| GET    | `/worlds`                                                                     | Mundos disponibles                                             |
| GET    | `/progress`                                                                   | Progreso y racha en todos los mundos                           |
| GET    | `/worlds/:slug/progress`                                                      | Progreso, racha, reglas, estadísticas en un mundo              |
| GET    | `/worlds/:slug/rules`                                                         | Reglas acumuladas                                              |
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
- **Persistencia y API**: auth JWT (estudiantes/docentes/admin con guards por rol), sesiones, intentos con plazo del
  servidor, resolución transaccional e idempotente, libro de puntos solo-inserción, estadísticas, historial.
- **Grupos y docentes (solo backend)**: grupos con baja lógica, asignaciones docente↔grupo y membresías con historial, aprovisionamiento
  de docentes por administradores, autorización por grupo con 404 uniforme y API del panel docente (actividad, estadísticas,
  estudiantes, intentos). Sin vistas.
- Esquema Prisma con 3 migraciones (incluye índices únicos parciales, CHECKs y trigger de solo-inserción) y seed.
- Frontend React mínimo (sin cambios en esta fase).

**No** implementado (módulos previstos): `rankings`, `rewards`, cambio/recuperación de contraseña,
refresco/revocación de tokens, límite de peticiones (login),
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
