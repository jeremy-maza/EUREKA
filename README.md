# Matemática bajo reglas

Juego educativo de matemáticas inspirado en _The Password Game_. El jugador resuelve retos escribiendo
**expresiones matemáticas completas**; cada reto añade una **regla nueva** y todas las anteriores siguen activas.

> Estado: **fundación técnica + motor de juego del Mundo 1 (Aritmética)**. Aún no hay autenticación, endpoints de
> juego ni interfaz de juego; ver [Alcance actual](#alcance-actual).

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
npm run db:seed               # siembra el catálogo del Mundo 1

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

| Variable                                | Obligatoria       | Por defecto             | Descripción                                          |
| --------------------------------------- | ----------------- | ----------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                          | Sí (salvo `test`) | —                       | Cadena de conexión de PostgreSQL                     |
| `POSTGRES_USER/PASSWORD/DB/PORT`        | Para Docker       | —                       | Credenciales del contenedor (deben casar con la URL) |
| `NODE_ENV`                              | No                | `development`           | `development` \| `test` \| `production`              |
| `PORT`                                  | No                | `3000`                  | Puerto de la API                                     |
| `CORS_ORIGIN`                           | No                | `http://localhost:5173` | Origen permitido por CORS                            |
| `GAME_BASE_TIME_SECONDS`                | No                | `60`                    | Tiempo base por reto                                 |
| `GAME_ADDITIONAL_TIME_PER_RULE_SECONDS` | No                | `15`                    | Segundos extra por regla activa adicional            |
| `GAME_BASE_POINTS`                      | No                | `100`                   | Puntos base por acierto (entero)                     |
| `GAME_STREAK_MULTIPLIER_STEP`           | No                | `0.5`                   | Incremento del multiplicador por acierto consecutivo |
| `GAME_MAX_STREAK_MULTIPLIER`            | No                | `5`                     | Tope del multiplicador                               |
| `JWT_SECRET`, `JWT_EXPIRES_IN`          | No (reservadas)   | —                       | Para el futuro módulo `auth` (secreto >= 32 chars)   |

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

En `apps/api` también: `npm run test:cov` (cobertura), `npm run db:studio`, `npm run db:migrate:deploy` (producción).

## Pruebas

```bash
npm test                          # todo
npm test -w apps/api              # solo backend (Jest + ts-jest + supertest)
npm test -w apps/web              # solo frontend (Vitest + Testing Library)
npm run test:cov -w apps/api      # cobertura del backend
```

El motor de juego se prueba **sin** React, HTTP ni base de datos. El test `test/app.spec.ts` levanta la
pipeline HTTP real (validación, filtro de errores, Swagger) con Prisma simulado, por lo que no necesita BD.

## Base de datos

- PostgreSQL + **Prisma 7** (adaptador `pg`). Esquema: [`apps/api/prisma/schema.prisma`](./apps/api/prisma/schema.prisma).
- Migraciones versionadas en `apps/api/prisma/migrations`. Tras cambiar el esquema: `npm run db:migrate`.
- El cliente se genera en `apps/api/src/generated/prisma` (ignorado por git); `build`, `typecheck` y `test`
  lo regeneran automáticamente.
- Modelo y decisiones: [docs/architecture.md](./docs/architecture.md#modelo-de-datos).

## Documentación de la API

Swagger UI en `/api/docs` (bearer auth ya declarado; sin endpoints protegidos todavía). Para añadir un endpoint,
decora el controlador con `@ApiTags`, `@ApiOperation` y `@ApiOkResponse`; los DTO usan `class-validator` y
el `ValidationPipe` global rechaza propiedades desconocidas. Los errores siempre tienen la forma
`{ statusCode, error, message, path, timestamp }`.

## Alcance actual

Implementado y verificado:

- Monorepo, TypeScript, ESLint, Prettier, variables de entorno validadas, Docker Compose para PostgreSQL.
- API NestJS: Prisma, Swagger, health (`/api/health`, `/api/health/ready`), validación y manejo de errores centralizado.
- Esquema Prisma + migración inicial + seed del Mundo 1.
- **Motor del juego** (TypeScript puro, ver abajo) con 170+ pruebas.
- Frontend React: layout, inicio ("Matemática bajo reglas"), lista de mundos, 404 y estado del servidor.

**No** implementado (módulos previstos, ver arquitectura): `auth`, `users`, `groups`, endpoints de juego/sesión,
`rankings`, `statistics`, `rewards`, `teacher-dashboard`, adaptación de dificultad, mundos 2-5.

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
