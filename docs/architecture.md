# Arquitectura — Matemática bajo reglas

## Visión general

Monolito modular (sin microservicios):

```
apps/web (React + Vite) ──HTTP /api──▶ apps/api (NestJS) ──Prisma──▶ PostgreSQL
```

Dos workspaces de npm, sin código compartido entre ellos (ver ADR 13): `apps/web` (`@mbr/web`, puerto 5173, llama a la
API con `VITE_API_URL`; CORS) y `apps/api` (`@mbr/api`, puerto 3000). Ver el [README](../README.md#frontend-appsweb).

### Frontend (`apps/web/src`)

Organizado por **funcionalidades** (`features/`) más unas pocas capas compartidas. El detalle de cada carpeta, rutas y
pruebas está en [`apps/web/README.md`](../apps/web/README.md).

```
app/            Shell: App (BrowserRouter) y router/AppRoutes (tabla de rutas y guards)
features/       auth · game · home · progress · leaderboard · teacher (páginas, componentes y lógica propios)
components/ui   Piezas visuales sin conocimiento de la app (Logo, ScreenMessage, FloatingIsland)
components/common  Componentes compartidos que conocen la app (InsightsHeader: navegación y sesión)
services/api    Cliente HTTP (`client.ts`) y contratos de la API (`types.ts`)
services/storage  Persistencia del token en `localStorage`
lib/            Constantes de dominio compartidas (`worlds.ts`)
styles/         Estilos globales y variables de la identidad visual
assets/         Imágenes por propósito (grillo, fondos)
```

Reglas de dependencia (sin ciclos; comprobado al consolidar el monorepo):

- `app → features → components / services / lib`. Las capas compartidas no importan de `features/` ni de `app/`.
- Una funcionalidad no importa de otra, con **una** excepción explícita: `features/auth` expone la sesión (`AuthProvider`,
  `useAuth`), que es estado global y la consumen `home` y `components/common/InsightsHeader`.
- El frontend no importa nada de `apps/api`: solo habla con él por HTTP.

El backend se organiza por **dominios**, no por capas genéricas. Las clases del motor del juego son TypeScript
**puro** (sin decoradores de Nest, sin Prisma, sin reloj propio) y Nest solo las cablea en los módulos mediante
`useFactory`. Esto permite probar el motor de forma aislada y reutilizarlo desde cualquier capa.

### Módulos del backend (`apps/api/src`)

| Módulo / carpeta                       | Estado       | Responsabilidad                                                                                                                                                                    |
| -------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/challenges`                   | Implementado | Parser, evaluador, reglas, `RuleEngine`, `RuleAccumulator`, `ChallengeEngine`                                                                                                      |
| `modules/worlds`                       | Implementado | Catálogo de mundos (Mundo 1) y validador de catálogos (garantía de resolubilidad)                                                                                                  |
| `modules/scoring`                      | Implementado | `StreakManager`, `ScoringEngine` (aritmética entera), `ScoreService` (libro de puntos)                                                                                             |
| `modules/statistics`                   | Implementado | `StatisticsService`: agregados por jugador y mundo (misma transacción que el intento)                                                                                              |
| `modules/auth`, `modules/users`        | Implementado | Registro/login, JWT HS256 con sesiones revocables, hash `scrypt`, cambio/recuperación de contraseña, limitador de login, guards global y de roles ([detalle](./authentication.md)) |
| `modules/mail`                         | Implementado | Puerto `Mailer` independiente del proveedor (`disabled` y `console` solo para desarrollo); sin proveedor real todavía                                                              |
| `modules/progression`                  | Implementado | `ProgressionManager` (puro) y `ProgressionService` (persistencia con bloqueo de fila)                                                                                              |
| `modules/game`                         | Implementado | `TimerManager`, `GameEngine` (fachada pura), `GameService` (capa de aplicación), controladores de juego y de estado del jugador                                                    |
| `prisma`, `health`, `common`, `config` | Implementado | BD, health, `Clock` inyectable, filtro de errores/Swagger, decoradores, entorno                                                                                                    |
| `modules/groups`, `modules/admin`      | Implementado | Grupos, asignaciones docentes, membresías, `GroupAccessService` (autorización) y aprovisionamiento de docentes ([detalle](./groups-and-teachers.md))                               |
| `modules/teacher-dashboard`            | Implementado | API del panel docente (actividad, estadísticas y estudiantes por grupo asignado); reutiliza `statistics` y `progression`                                                           |
| `rankings`, `rewards`                  | Pendiente    | Derivados de `ScoreTransaction` y del historial de intentos                                                                                                                        |

Dependencias entre módulos (acíclicas): `challenges ← worlds ← progression ← game`, `scoring ← game`, `statistics ← game`;
`auth → users, mail`; `groups ← admin`; `groups + statistics + progression + worlds ← teacher-dashboard`. Las lecturas del estado del jugador (progreso/puntos/historial) viven en `game` porque deben cerrar por
tiempo los intentos vencidos antes de leer (así evitan una dependencia circular `progression ↔ game`).

### Capa de aplicación del juego (`GameService`)

Orquesta el motor puro con la persistencia. Flujo de un reto:

```
POST /worlds/:slug/sessions        → sesión abierta (idempotente: reanuda la existente)
POST /sessions/:id/attempts        → fila ChallengeAttempt PENDING con plazo fijado por el SERVIDOR
POST /attempts/:id/answer {expr}   → transacción única: bloqueo de progreso → motor → persistencia atómica
```

Cada operación que cambia el estado de un (jugador, mundo) abre **una transacción** que primero **bloquea la fila de
`student_world_progress`** (`SELECT … FOR UPDATE`; la fila se crea con `INSERT … ON CONFLICT DO NOTHING`). Dentro se
escribe todo o nada: intento resuelto, progreso/racha, regla desbloqueada, `ScoreTransaction`, estadísticas y cierre de
sesión. Dentro de la transacción solo se usa el cliente transaccional (con un pool de 1 conexión una consulta fuera de ella
se bloquearía: las pruebas lo detectan).

Por qué no se puede puntuar dos veces:

1. El bloqueo de fila serializa a las peticiones del mismo jugador y mundo; el intento se relee **tras** el bloqueo.
2. La resolución es `UPDATE … WHERE outcome = 'PENDING'` (si afecta a 0 filas, se aborta con 409).
3. `ScoreTransaction.attemptId` es único.
4. **Reenvío idempotente**: repetir la misma expresión en un intento ya resuelto devuelve el resultado original
   (`replayed: true`); una expresión distinta da 409 (un solo intento por reto).

**Tiempo.** `startedAt`/`deadlineAt` los fija el servidor al iniciar el reto (`Clock`) y se guardan; el cliente solo envía la
expresión (`forbidNonWhitelisted` rechaza cualquier otro campo con 400). Un envío tardío es `TIMEOUT` y no se evalúa. Un reto
abandonado se cierra como `TIMEOUT` de forma **perezosa y determinista** cuando el servidor vuelve a tocar el estado del
jugador (iniciar reto/sesión o cualquier consulta de su estado); no hay trabajos en segundo plano.

**Reglas.** El reto presenta como activas las reglas acumuladas **más la que introduce**; la nueva regla solo se **guarda al
completar el reto con éxito**. Fallar o agotar el tiempo conserva las reglas ya guardadas y reinicia la secuencia.

### Motor del juego

```
respuesta (texto)
   │  ExpressionParser ── tokeniza y construye el AST (error de sintaxis → fallo)
   ▼
   MathEvaluator ── valor exacto (Fraction/BigInt); división entre cero → fallo
   ▼
   RuleEngine ── valida el AST contra las reglas activas (un RuleHandler por tipo)
   ▼
ChallengeEngine.evaluateSubmission → { isCorrect, failureReason, violations, value }

GameEngine.submitAnswer:  TimerManager (plazo) → ChallengeEngine → ScoringEngine/StreakManager → ProgressionManager
```

- **Matemática y reglas están separadas**: el evaluador no conoce las reglas; las reglas inspeccionan el AST,
  no el texto (no se evaden con espacios o paréntesis).
- **Respuesta con `= resultado`**: el ejemplo `41 + 1 = 42` con el dígito 2 prohibido exige que el resultado declarado
  quede fuera de las reglas. Se admite solo un literal entero tras `=`; una expresión ahí abriría una evasión.
- **Reglas**: `RuleDefinition { id, type, description, config }`. Nuevos tipos = nuevo `RuleHandler` registrado
  (`parseConfig` + `check`); el motor no cambia. El catálogo se valida al arrancar y en el seed.
- **Resolubilidad garantizada**: cada reto lleva una `referenceSolution` que debe cumplir **todas** las reglas del mundo.
  Como cada regla es una restricción independiente, eso cubre cualquier subconjunto acumulado y también el reinicio
  de secuencia con todas las reglas activas. `validateWorldDefinition` lo comprueba (y también posiciones, referencias
  y reglas huérfanas). Un generador futuro de retos debe pasar por el mismo validador.
- **Progreso inmutable**: las operaciones devuelven estados nuevos; la capa de aplicación futura cargará el
  estado, llamará al motor y persistirá el resultado en una transacción.

### Reinicio de secuencia vs. reinicio de mundo

| Operación                         | Reto actual | Racha | Reglas desbloqueadas | Puntos       |
| --------------------------------- | ----------- | ----- | -------------------- | ------------ |
| Fallo / timeout (`recordFailure`) | → 1         | → 0   | **se conservan**     | se conservan |
| `resetWorldProgress` (admin)      | → 1         | → 0   | **se borran**        | se conservan |

### Puntuación y precisión numérica

`M(n) = min(1 + 0.5·(n−1), 5)` se calcula en **milésimas enteras** (`1500` = 1.5x) y
`points = ⌊basePoints · multiplierMilli / 1000⌋` con enteros. En BD: `multiplierMilli Int`, `points Int`.
No hay `float` en ningún punto del flujo de puntuación.

### Tiempo

`timeLimit = base + (reglasActivas − 1) · extraPorRegla` (60 s y 15 s por defecto, configurables vía entorno).
`TimerManager` es puro y recibe instantes explícitos; la capa de aplicación debe pasar **siempre** marcas del
servidor (`startedAt`/`deadlineAt` se guardan en `ChallengeAttempt`). Una respuesta tardía es `TIMEOUT` y no se evalúa.

### Dificultad adaptativa

Solo extensión: `modules/game/difficulty.ts` define `DifficultyPolicy`, `DifficultyContext` (racha + rendimiento
histórico) y una política estática por defecto. La implementación real llegará con `statistics`.

## Modelo de datos

Entidades (Prisma, `apps/api/prisma/schema.prisma`): `User`, `Group`, `GroupMembership`, `TeacherGroupAssignment`,
`World`, `Rule`, `Challenge`, `StudentWorldProgress`, `UnlockedRule`, `GameSession`, `ChallengeAttempt`,
`ScoreTransaction`, `WorldStatistics`, `AuthSession`, `PasswordResetToken`, `AuthThrottle` (ver [authentication.md](./authentication.md#9-base-de-datos-y-mantenimiento)).

| Requisito                                             | Cómo se cubre                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Estudiante en varios grupos                           | `GroupMembership` (única **activa** por `(userId, groupId)`: índice parcial; historial por filas `REMOVED`)               |
| Docente con varios grupos / grupo con varios docentes | `TeacherGroupAssignment` (N:M, única **activa** por par; historial `REVOKED`); autorización solo desde sus filas `ACTIVE` |
| Estudiante en varios mundos, racha independiente      | `StudentWorldProgress` único por `(userId, worldId)` con su propia racha/puntos                                           |
| Reglas acumuladas por jugador y mundo                 | `UnlockedRule` ligada al progreso; sobrevive a fallos y nuevas sesiones                                                   |
| Historial incluyendo fallos y timeouts                | `ChallengeAttempt` (`outcome`, `failureReason`, `submission`, tiempos, reglas activas)                                    |
| Puntos auditables                                     | `ScoreTransaction` solo-inserción, 1:1 con el intento (`attemptId` único)                                                 |
| Reglas separadas de los retos                         | `Rule` propia; `Challenge.introducesRuleId` (único) solo la referencia                                                    |

Decisiones y omisiones deliberadas:

- **`ChallengeRule` no existe**: cada reto introduce a lo sumo una regla, así que basta una FK única
  (`Challenge.introducesRuleId`). Si algún día un reto introduce varias, se migra a una tabla de unión.
- **`WorldStatistics` es un agregado materializado** (contadores, tiempo total de aciertos y reglas incumplidas). Es
  derivable de `ChallengeAttempt`, pero se actualiza en la misma transacción que cada intento para consultas rápidas y
  como entrada de la futura dificultad adaptativa; el historial sigue siendo la fuente de verdad.
- `Rule.type` es `String` (no enum) para añadir tipos sin migración. `config` es `Json` validado por el `RuleHandler`.
- `Challenge.referenceSolution` es sensible: ningún DTO de estudiante debe exponerlo.
- IDs `uuid(7)` (ordenables por tiempo). Tiempos `timestamp` en UTC.
- `StudentWorldProgress.totalPoints` es una caché; la fuente auditable es la suma de `ScoreTransaction.points`.
- Un único intento por reto presentado: `ChallengeAttempt` se crea `PENDING` al iniciar el reto y se resuelve una sola vez.
- Invariantes de rol: `TeacherGroupAssignment.teacherId` debe ser `TEACHER` y `GroupMembership.userId` debe ser `STUDENT`; se validan en la
  aplicación (422) y se refuerzan con triggers `BEFORE INSERT` (migración `…_groups_and_teachers`). Los grupos no se borran: se desactivan.

### Integridad en la base de datos (migración `…_game_persistence`, SQL manual)

Prisma no expresa estos objetos; viven en el SQL de la migración (las pruebas de integración los ejercitan):

- Índice único parcial: **un solo intento `PENDING` por (usuario, mundo)**.
- Índice único parcial: **una sola sesión abierta por (usuario, mundo)**.
- CHECKs: coherencia `outcome ↔ failureReason`, puntos solo en aciertos, valores de progreso/puntos no negativos y
  `bestStreak >= currentStreak`.
- **Libro de puntos solo-inserción**: un trigger rechaza `UPDATE`/`DELETE` en `score_transactions`. Los ajustes manuales
  se registran como nuevas filas (`MANUAL_ADJUSTMENT`), nunca modificando las existentes.
- `ChallengeAttempt.worldId` denormalizado (necesario para el índice parcial) y `Challenge.key` (id estable del catálogo).

### Integridad de la puntuación y autorización

- El cliente **nunca** envía puntos, tiempos ni rachas: solo la respuesta. Todo se calcula y persiste en el servidor.
- Los docentes solo acceden a grupos con asignación activa y a estudiantes con membresía activa en ellos (`GroupAccessService`;
  404 uniforme fuera de alcance). Ver [groups-and-teachers.md](./groups-and-teachers.md#4-reglas-de-autorización).
- Autenticación: JWT HS256 de acceso (`JWT_SECRET`, `JWT_EXPIRES_IN_SECONDS`) **ligado a una sesión revocable** (`jti` =
  `AuthSession.id`). Guard **global** que deniega por defecto (`@Public()` para excepciones), exige sesión vigente y recarga
  al usuario de la BD en cada petición (cuentas eliminadas, sesiones revocadas o cambios de rol surten efecto al instante);
  `@Roles(...)` para restringir. Los endpoints de juego son **solo para estudiantes**.
- Propiedad: todas las consultas filtran por el `userId` del token; una sesión/intento ajeno responde **404** (no filtra
  su existencia). El autorregistro solo crea estudiantes; los docentes los crea un administrador (`POST /admin/teachers`) y los administradores, el script `npm run admin:create`.
- Nada de lo que el cliente envía determina puntos, racha, reglas, resultado esperado ni tiempos. La solución de
  referencia y el resultado esperado jamás salen en ninguna respuesta.

## Registro de decisiones (ADR)

1. **npm workspaces (`apps/*`), sin `packages/` por ahora.** No hay código compartido que lo justifique; se evita
   infraestructura (Turborepo/Nx) innecesaria. Un único frontend: `apps/web` (el antiguo `frontend/` de la raíz se movió
   ahí y el primer prototipo, que ocupaba `apps/web`, se retiró porque la app actual cubre todas sus funciones).
2. **NestJS 11 (CJS) y no 12.** La serie 12 es ESM-first y su plantilla usa Vitest; el requisito fija **Jest**, y Jest con ESM
   es experimental. Nest 11 + Jest 30 + ts-jest es el camino estable. Migrar a 12 será una tarea acotada (ESM + runner de tests).
3. **TypeScript 6.0.** TS 7 (compilador nativo) aún no es compatible con `ts-jest` (`<7`) ni `typescript-eslint` (`<6.1`).
4. **Prisma 7** con adaptador `pg` y generador `prisma-client` (salida en `src/generated`, `moduleFormat = "cjs"`).
   Configuración en `prisma.config.ts`; la conexión es perezosa para que la API arranque sin BD.
5. **Fracciones `BigInt` en vez de `number`.** Evita errores de coma flotante y permite comparar resultados racionales
   exactos (necesario para el Mundo 3 sin reescribir el motor).
6. **Motor sin decoradores de Nest.** Testabilidad y desacoplamiento; los módulos solo cablean con `useFactory`.
7. **Vitest + Testing Library en el frontend** (Jest en el backend, según requisito): es el runner natural de Vite.
8. **JWT y contraseñas con `node:crypto`, sin dependencias.** `scrypt` (N=2^15, r=8, p=1, sal aleatoria) evita módulos
   nativos (bcrypt) y `TokenService` implementa solo HS256 con verificación estricta (`alg`, firma en tiempo constante,
   `exp`, `jti`). Se aisló tras `issue`/`verify` para sustituirlo por `@nestjs/jwt` o `jose` sin tocar el resto. La
   revocación es server-side (tabla de sesiones), no depende de que el cliente borre el token. _Pendiente:_ refresco de tokens.
9. **Pruebas de integración con PGlite.** Postgres real en WASM con las migraciones del repo: sin Docker y deterministas.
   Se ejecuta en serie con un pool de 1 conexión (ver limitaciones en el README).
10. **Grupos: baja lógica con historial y autorización centralizada.** Membresías y asignaciones nunca se borran (`REMOVED`/`REVOKED`
    con quién y cuándo) y la unicidad vigente se garantiza con índices únicos parciales. Todo acceso por grupo pasa por
    `GroupAccessService` (404 uniforme). El administrador (`ADMIN`, ya existente en `UserRole`) se aprovisiona solo con un script
    operativo; no hay ruta HTTP para crearlo. El panel docente solo lee agregados existentes (sin duplicar lógica de puntuación).
11. **Dependencias evitadas:** `concurrently`, `bcrypt`, `passport`, librerías de matemáticas/parsers (`mathjs`, `expr-eval`), `@nestjs/terminus`,
    `@nestjs/throttler` (el limitador de login es propio: ver ADR 12). Se reevaluarán cuando exista una necesidad real.
12. **Sesiones revocables y limitador de intentos en PostgreSQL.** Cada JWT lleva un `jti` que referencia una fila de
    `auth_sessions` (el JWT no se guarda); el guard valida la sesión en cada petición. El limitador (`auth_throttles`) cuenta el
    intento _antes_ de verificar, bajo `SELECT … FOR UPDATE`, con bloqueo temporal progresivo (nunca permanente) y sin Redis ni
    `@nestjs/throttler` (en memoria, sin contador por correo ni conteo atómico previo). Las recuperaciones usan tokens de 256 bits
    guardados solo como SHA-256 y reclamados con un `UPDATE` atómico en la misma transacción que el cambio de contraseña.
    Detalle y limitaciones: [authentication.md](./authentication.md).
13. **Contratos de la API duplicados a mano, no en un paquete compartido.** Los DTO del backend son clases de Nest con
    decoradores de `class-validator`/Swagger (CommonJS, `nodenext`), y el frontend es ESM para un bundler. Compartirlos
    obligaría a extraer tipos planos, añadir un paquete con su propia compilación y acoplar el despliegue de ambas apps,
    para unas ~280 líneas de tipos. Se mantienen en `apps/web/src/services/api/types.ts` y se revisan al cambiar un DTO.
    Se reevaluará (p. ej. generando los tipos desde el OpenAPI de `/api/docs-json`) si los contratos crecen o divergen.

## Supuestos (a confirmar)

- **Tiempo con 0 reglas.** La fórmula usa `activeRulesCount − 1`; el reto 1 del ejemplo no muestra regla, así que el conteo
  se acota a ≥ 1 (reto 1 y reto 2, ambos con ≤ 1 regla, reciben el tiempo base).
- **La regla nueva se guarda al COMPLETAR con éxito el reto** (requisito explícito). Mientras se juega ese reto ya aplica y cuenta para el tiempo, pero si se falla o vence el plazo no se acumula y volverá a presentarse como nueva al reintentar.
- **Completar todos los retos** marca el progreso `COMPLETED` y cierra la sesión. Iniciar una sesión nueva reinicia la
  secuencia conservando reglas, puntos **y racha** (completar no es fallar). Consecuencia: rejugar el mundo permite mantener
  el multiplicador máximo; si no se desea, se resetea la racha al completar (decisión de producto pendiente).
- **Iniciar sesión es idempotente**: si hay una sesión abierta se reanuda (200); no hay más de una abierta por jugador y mundo.
  No se permite terminar la sesión con un reto vigente (el plazo corre igualmente).
- **Expiración perezosa**: un reto abandonado se registra como `TIMEOUT` la próxima vez que el jugador toca su estado
  (con `elapsedMs` = límite), no en el instante exacto del vencimiento.
- **`REQUIRED_OPERATION` compara literales**: `7 * 1` exige un nodo `*` con operandos literales 7 y 1 (conmutativo en `+`/`*`).
  `2 * 7 * 1` se lee como `(2 * 7) * 1` y no la contiene. Es una limitación documentada y testeada.
- **Solo enteros** en el Mundo 1 (sin decimales ni multiplicación implícita). Resultados intermedios racionales sí se permiten.
- **Reiniciar el mundo** conserva puntos y mejor racha (los puntos ganados nunca se borran).
- Longitud máxima de respuesta: 200 caracteres (acota la recursión del parser).
