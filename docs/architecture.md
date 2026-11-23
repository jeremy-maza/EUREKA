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
| `modules/challenges`                   | Implementado | Parser con sintaxis por mundo, evaluador exacto, resolutor de ecuaciones lineales, 9 tipos de regla, `RuleEngine`, `ChallengeEngine` y generador determinista (`generation/`)      |
| `modules/sequences`                    | Implementado | `planSequence` (puro): sortea subconjunto y orden de reglas con semilla y genera un reto verificado por posición                                                                   |
| `modules/worlds`                       | Implementado | Catálogo de los 5 mundos (`catalog/`), validador de catálogos (compatibilidad + planificación), `WorldsRepository` (catálogo en código + ids de BD)                                |
| `modules/scoring`                      | Implementado | `StreakManager`, `ScoringEngine` (aritmética entera), `ScoreService` (libro de puntos)                                                                                             |
| `modules/statistics`                   | Implementado | `StatisticsService`: agregados por jugador y mundo (misma transacción que el intento)                                                                                              |
| `modules/auth`, `modules/users`        | Implementado | Registro/login, JWT HS256 con sesiones revocables, hash `scrypt`, cambio/recuperación de contraseña, limitador de login, guards global y de roles ([detalle](./authentication.md)) |
| `modules/mail`                         | Implementado | Puerto `Mailer` independiente del proveedor (`disabled` y `console` solo para desarrollo); sin proveedor real todavía                                                              |
| `modules/progression`                  | Implementado | `ProgressionManager` (puro) y `ProgressionService` (persistencia con bloqueo de fila)                                                                                              |
| `modules/game`                         | Implementado | `TimerManager`, `GameEngine` (fachada pura), `GameService` (capa de aplicación), `SequenceStore`, `WorldUnlockService`, política de dificultad, controladores                      |
| `prisma`, `health`, `common`, `config` | Implementado | BD, health, `Clock` y `SeedSource` inyectables, filtro de errores/Swagger, decoradores, entorno                                                                                    |
| `modules/groups`, `modules/admin`      | Implementado | Grupos, asignaciones docentes, membresías, `GroupAccessService` (autorización) y aprovisionamiento de docentes ([detalle](./groups-and-teachers.md))                               |
| `modules/teacher-dashboard`            | Implementado | API del panel docente (actividad, estadísticas y estudiantes por grupo asignado); reutiliza `statistics` y `progression`                                                           |
| `rewards`                              | Pendiente    | Derivados de `ScoreTransaction` y del historial de intentos (la clasificación por grupo ya existe en `game`)                                                                       |

Dependencias entre módulos (acíclicas): `challenges ← worlds ← sequences ← game`, `challenges ← worlds ← progression ← game`,
`scoring ← game`, `statistics ← game`;
`auth → users, mail`; `groups ← admin`; `groups + statistics + progression + worlds ← teacher-dashboard`. Las lecturas del estado del jugador (progreso/puntos/historial) viven en `game` porque deben cerrar por
tiempo los intentos vencidos antes de leer (así evitan una dependencia circular `progression ↔ game`).

### Capa de aplicación del juego (`GameService`)

Orquesta el motor puro con la persistencia. Flujo de un reto:

```
POST /worlds/:slug/sessions        → sesión abierta (idempotente: reanuda la existente); 403 si el mundo está bloqueado
POST /sessions/:id/attempts        → sin secuencia ACTIVE: dificultad (política) + semilla (SeedSource) → planSequence →
                                     GameSequence + SequenceChallenge[]; después, fila ChallengeAttempt PENDING con plazo del SERVIDOR
POST /attempts/:id/answer {expr}   → transacción única: bloqueo de progreso → motor → persistencia atómica
                                     (fallo/timeout ⇒ secuencia FAILED; último reto ⇒ secuencia COMPLETED y mundo completado)
```

Cada operación que cambia el estado de un (jugador, mundo) abre **una transacción** que primero **bloquea la fila de
`student_world_progress`** (`SELECT … FOR UPDATE`; la fila se crea con `INSERT … ON CONFLICT DO NOTHING`). Dentro se
escribe todo o nada: intento resuelto, progreso/racha/compleciones, regla dominada, `ScoreTransaction`, estadísticas,
cierre de secuencia y cierre de sesión. Dentro de la transacción solo se usa el cliente transaccional — también para leer
mundos y desbloqueos (`WorldsRepository`/`WorldUnlockService` reciben el cliente del llamador); con un pool de 1 conexión
una consulta fuera de ella se bloquearía, y las pruebas de integración lo detectan.

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

**Secuencias y reglas.** Una secuencia (`GameSequence`) es un subconjunto aleatorio de las reglas del mundo
(`ruleCount[dificultad]` reglas) en orden aleatorio, más un reto generado por posición (`SequenceChallenge`); se planifica una
vez y se guarda entera (auditable, reproducible por su semilla, sobrevive a recargas y sesiones). El reto _p_ presenta como
activas las reglas ya superadas en la secuencia (`ruleKeys[0 … p−3]`) **más la que introduce** (`ruleKeys[p−2]`); la nueva
solo se acumula al completar el reto con éxito. **Fallar o agotar el tiempo descarta todas las reglas de la secuencia**
(queda `FAILED`, racha a 0, vuelta al reto 1) y el siguiente reto sortea una secuencia nueva. Los puntos nunca se pierden.
`UnlockedRule` registra las reglas **dominadas** (superadas alguna vez): es una colección permanente, no reglas activas.

**Desbloqueo.** El mundo _n_ (por posición) se juega si `completionsCount > 0` en el mundo _n − 1_ (`WorldUnlockService`,
403 si no). Completar la secuencia suma una compleción; la primera fija `firstCompletedAt` y la respuesta incluye
`nextWorldUnlocked` (se reconstruye de datos guardados, así que el reenvío idempotente devuelve lo mismo).

### Motor del juego

```
respuesta (texto) + sintaxis del mundo
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
  quede fuera de las reglas. Se admite solo un literal tras `=` (entero, o decimal en los mundos con decimales); una
  expresión ahí abriría una evasión.
- **Sintaxis por mundo** (`MathSyntax { decimals, powers }`): decimales como racionales exactos (`2.5` ≡ 5/2); potencias
  `^` asociativas a la derecha y por encima del `-` unario (`-2^2 = -4`), con exponente entero |e| ≤ 12 y resultado acotado
  (si no, error de sintaxis claro). Los paréntesis que cambian la estructura se marcan en el AST (`grouped`). El Mundo 1
  conserva exactamente su comportamiento original.
- **Ecuaciones** (`statementKind: 'EQUATION'`): el enunciado es una ecuación lineal en `x` y el resultado esperado su
  solución exacta (`solveLinearEquation`); la respuesta debe valer `x` y no puede contener `x`.
- **Reglas**: `RuleDefinition { id, type, description, config }`. Tipos: `FORBIDDEN_DIGIT`, `REQUIRED_OPERATION`,
  `REQUIRED_OPERATOR`, `FORBIDDEN_OPERATOR`, `MIN_NUMBERS`, `MAX_NUMBER`, `REQUIRED_NEGATIVE`, `REQUIRED_DECIMAL`,
  `REQUIRED_PARENTHESES` (solo cuentan los paréntesis necesarios). Nuevos tipos = nuevo `RuleHandler` registrado
  (`parseConfig` + `check`); el motor no cambia. Catálogo: [plan maestro §9](../EUREKA_MASTER_PLAN.md#9-catálogo-final-de-reglas).
- **Generación y resolubilidad garantizada**: los retos los genera `ChallengeGenerator` (familias de enunciados por mundo:
  multiplicativa, con signos, fraccionaria, decimal, potencias, ecuaciones; perfiles que suben con la posición y la
  dificultad). El resultado esperado lo calcula siempre el evaluador/resolutor. Un reto solo se acepta si su
  `referenceSolution` pasa `ChallengeEngine.verifySolvable` con **exactamente** sus reglas activas y la sintaxis del mundo, y
  si "muerde": desde el reto 2, enviar el enunciado o el resultado literal viola alguna regla. `planSequence` reintenta con
  sub-semillas y re-sorteos acotados; `validateWorldDefinition` comprueba al arrancar y en el seed el repertorio, la
  compatibilidad demostrable de las reglas y que se planifica con una muestra de semillas. Las pruebas recorren TODOS los
  órdenes de TODOS los subconjuntos de cada mundo.
- **Progreso inmutable**: las operaciones devuelven estados nuevos; la capa de aplicación carga el estado, llama al
  motor y persiste el resultado en una transacción.

### Reinicio de secuencia vs. reinicio de mundo

| Operación                                    | Reto actual | Racha       | Reglas activas (secuencia)      | Reglas dominadas | Puntos       |
| -------------------------------------------- | ----------- | ----------- | ------------------------------- | ---------------- | ------------ |
| Fallo / timeout (`recordFailure`)            | → 1         | → 0         | **se descartan** (nuevo sorteo) | se conservan     | se conservan |
| Completar la secuencia (`recordCorrect`)     | → fin       | sigue       | secuencia `COMPLETED`           | se conservan     | se conservan |
| Nueva partida tras completar (`startNewRun`) | → 1         | se conserva | nuevo sorteo                    | se conservan     | se conservan |
| `resetWorldProgress` (admin)                 | → 1         | → 0         | se borran                       | —                | se conservan |

### Puntuación y precisión numérica

`M(n) = min(1 + 0.5·(n−1), 5)` se calcula en **milésimas enteras** (`1500` = 1.5x) y
`points = ⌊basePoints · multiplierMilli / 1000⌋` con enteros. En BD: `multiplierMilli Int`, `points Int`.
No hay `float` en ningún punto del flujo de puntuación.

### Tiempo

`timeLimit = base + (reglasActivas − 1) · extraPorRegla + extraDelMundo` (60 s y 15 s por defecto, configurables vía
entorno; `extraDelMundo` = `WorldDefinition.sequence.extraTimeSeconds`: 0 / 5 / 10 / 20 / 25 s del Mundo 1 al 5).
`TimerManager` es puro y recibe instantes explícitos; la capa de aplicación debe pasar **siempre** marcas del
servidor (`startedAt`/`deadlineAt` se guardan en `ChallengeAttempt`). Una respuesta tardía es `TIMEOUT` y no se evalúa.

### Dificultad adaptativa

`modules/game/difficulty.ts`: `adaptiveDifficultyPolicy` (pura) elige `EASIER`/`BASELINE`/`HARDER` **al empezar cada
secuencia** con los últimos 12 intentos resueltos del jugador en ese mundo, su racha y sus compleciones: `EASIER` con 3+
fallos seguidos o precisión < 35 % o la mitad de timeouts (con ≥ 4 intentos); `HARDER` si ya completó el mundo y lleva racha
≥ 3, o con precisión ≥ 80 % sin fallos recientes; `BASELINE` en otro caso (y para jugadores nuevos). La dificultad cambia
cuántas reglas se sortean (`ruleCount`) y el perfil de los enunciados; **nunca** suaviza la mecánica (fallar sigue siendo
fallo directo). Se guarda con la secuencia y se inyecta (`DIFFICULTY_POLICY`), así que las pruebas pueden fijarla.

## Modelo de datos

Entidades (Prisma, `apps/api/prisma/schema.prisma`): `User`, `Group`, `GroupMembership`, `TeacherGroupAssignment`,
`World`, `Rule`, `Challenge` (histórico), `StudentWorldProgress`, `UnlockedRule`, `GameSequence`, `SequenceChallenge`,
`GameSession`, `ChallengeAttempt`,
`ScoreTransaction`, `WorldStatistics`, `AuthSession`, `PasswordResetToken`, `AuthThrottle` (ver [authentication.md](./authentication.md#9-base-de-datos-y-mantenimiento)).

| Requisito                                             | Cómo se cubre                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Estudiante en varios grupos                           | `GroupMembership` (única **activa** por `(userId, groupId)`: índice parcial; historial por filas `REMOVED`)               |
| Docente con varios grupos / grupo con varios docentes | `TeacherGroupAssignment` (N:M, única **activa** por par; historial `REVOKED`); autorización solo desde sus filas `ACTIVE` |
| Estudiante en varios mundos, racha independiente      | `StudentWorldProgress` único por `(userId, worldId)` con su propia racha/puntos                                           |
| Reglas sorteadas por secuencia                        | `GameSequence.ruleKeys` (orden de introducción) + `SequenceChallenge` por posición; una sola `ACTIVE` por jugador y mundo |
| Reglas dominadas por jugador y mundo                  | `UnlockedRule` ligada al progreso; colección permanente (superadas alguna vez)                                            |
| Desbloqueo de mundos                                  | `StudentWorldProgress.completionsCount` / `firstCompletedAt` del mundo anterior                                           |
| Historial incluyendo fallos y timeouts                | `ChallengeAttempt` (`outcome`, `failureReason`, `submission`, tiempos, reglas activas)                                    |
| Puntos auditables                                     | `ScoreTransaction` solo-inserción, 1:1 con el intento (`attemptId` único)                                                 |
| Reglas separadas de los retos                         | `Rule` propia; `SequenceChallenge.introducesRuleKey` solo la referencia                                                   |

Decisiones y omisiones deliberadas:

- **Catálogo en código, ids en BD**: mundos y reglas se definen en `worlds/catalog/` y se siembran (`npm run db:seed`,
  idempotente, nunca borra). Los retos ya no se siembran: se generan por secuencia. La tabla `challenges` conserva el
  catálogo fijo original del Mundo 1 porque los intentos antiguos la referencian (`ChallengeAttempt.challengeId`, ahora
  opcional); los nuevos referencian `sequenceChallengeId` y un CHECK exige uno de los dos. Cada intento guarda además una
  instantánea (`position`, `expression`) para el historial y las analíticas, que agrupan por posición.
- Cada reto introduce a lo sumo una regla (`SequenceChallenge.introducesRuleKey`; CHECK: solo la posición 1 no introduce).
- **`WorldStatistics` es un agregado materializado** (contadores, tiempo total de aciertos y reglas incumplidas). Es
  derivable de `ChallengeAttempt`, pero se actualiza en la misma transacción que cada intento para consultas rápidas y
  como entrada de la futura dificultad adaptativa; el historial sigue siendo la fuente de verdad.
- `Rule.type` es `String` (no enum) para añadir tipos sin migración. `config` es `Json` validado por el `RuleHandler`.
- `SequenceChallenge.referenceSolution`/`expectedResult` (y los de `Challenge`) son sensibles: ningún DTO de estudiante los
  expone (las pruebas lo comprueban). Tampoco se exponen las reglas de la secuencia aún no presentadas.
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

### Integridad de las secuencias (migración `…_world_sequences`, aditiva)

- Índice único parcial: **una sola secuencia `ACTIVE` por (usuario, mundo)**.
- CHECKs: `ACTIVE` ⇔ sin `endedAt`; semilla ≥ 0; posición ≥ 1, `EXPRESSION|EQUATION` y solo la posición 1 sin regla;
  todo intento con reto (`challengeId` o `sequenceChallengeId`); `completionsCount ≥ 0` y `= 0` ⇔ sin `firstCompletedAt`.
- `challenge_attempts → sequence_challenges` es `NO ACTION` (no `RESTRICT`): se comprueba al final de la sentencia, así el
  borrado en cascada de un usuario no falla.
- Backfill: posición/enunciado de los intentos desde `challenges`; compleciones = aciertos en el último reto del catálogo
  fijo. Transición: los intentos `PENDING` del catálogo fijo se cierran como `TIMEOUT` y las secuencias en curso vuelven al
  reto 1 (no se pueden evaluar contra el catálogo nuevo); puntos, rachas, reglas dominadas e historial se conservan.
  `test/integration/world-sequences-migration.int-spec.ts` lo prueba sobre datos antiguos.

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

14. **Secuencias persistidas en vez de generar reto a reto.** Al empezar una secuencia se planifica y se guarda entera
    (reglas en orden + retos con su solución). Así la generación nunca falla a mitad de secuencia, el sorteo es auditable y
    reproducible (semilla guardada) y el estado sobrevive a recargas y sesiones. Las reglas activas se derivan de la
    secuencia `ACTIVE` y de la posición; `UnlockedRule` pasa a ser la colección de reglas dominadas.
15. **Catálogo de mundos en código.** Reglas, sintaxis, `ruleCount` y perfiles del generador viven en `worlds/catalog/` y se
    validan al arrancar; la BD solo guarda filas de mundos y reglas (FK de intentos, estadísticas y reglas dominadas).
16. **Tamaño del subconjunto por mundo y dificultad** (`ruleCount` suave/normal/intensa): 2/3/4 en los mundos 1–4 y 3/4/5 en
    el Caos. Con 3 reglas en dificultad normal, la secuencia tiene 4 retos como el Mundo 1 original; el subconjunto deja
    reglas fuera en cada sorteo (variedad) y la política adaptativa lo ajusta sin tocar la mecánica de fallo.
17. **`FORBIDDEN_OPERATOR` implementado pero fuera de los catálogos**: por sí sola nunca rechaza el resultado literal (un
    literal no tiene operadores), así que un orden que la introdujera primero no "mordería". El validador detecta ese caso.

## Supuestos (a confirmar)

- **Tiempo con 0 reglas.** La fórmula usa `activeRulesCount − 1`; el reto 1 del ejemplo no muestra regla, así que el conteo
  se acota a ≥ 1 (reto 1 y reto 2, ambos con ≤ 1 regla, reciben el tiempo base).
- **La regla nueva se acumula al COMPLETAR con éxito el reto** (requisito explícito). Mientras se juega ese reto ya aplica y
  cuenta para el tiempo; si se falla o vence el plazo, la secuencia entera se descarta.
- **Completar todos los retos** marca el progreso `COMPLETED`, suma una compleción y cierra la sesión. Iniciar una sesión
  nueva sortea otra secuencia conservando puntos **y racha** (completar no es fallar). Consecuencia: rejugar el mundo
  permite mantener el multiplicador máximo; si no se desea, se resetea la racha al completar (decisión de producto pendiente).
- **Desbloqueo por compleción, no por puntos**: basta completar una secuencia (de cualquier dificultad) del mundo anterior.
- **Iniciar sesión es idempotente**: si hay una sesión abierta se reanuda (200); no hay más de una abierta por jugador y mundo.
  No se permite terminar la sesión con un reto vigente (el plazo corre igualmente).
- **Expiración perezosa**: un reto abandonado se registra como `TIMEOUT` la próxima vez que el jugador toca su estado
  (con `elapsedMs` = límite), no en el instante exacto del vencimiento.
- **`REQUIRED_OPERATION` compara literales**: `7 * 1` exige un nodo `*` con operandos literales 7 y 1 (conmutativo en `+`/`*`).
  `2 * 7 * 1` se lee como `(2 * 7) * 1` y no la contiene. Es una limitación documentada y testeada.
- **Solo enteros** en los Mundos 1, 2 y 4 (sin multiplicación implícita); decimales en el 3 y el 5; potencias en el 4 y el 5.
  Resultados intermedios racionales sí se permiten en todos.
- **Los mensajes de fallo nunca muestran el valor esperado** (`WRONG_RESULT`: «Tu expresión vale 22, pero no es el
  resultado de la operación»).
- **Las reglas se cumplen literalmente**: `REQUIRED_OPERATOR /` se satisface con `n / 1` (sí hay una división). Es la
  filosofía del juego (cumplir la letra de la regla). `REQUIRED_NEGATIVE` exige un valor realmente negativo (`-0` no vale).
- **La regla nueva no siempre "muerde" sola**: el generador exige que el reto muerda con el conjunto de reglas activas;
  en ~5–10 % de las introducciones la regla nueva por sí sola no rechazaría el enunciado (lo rechaza una anterior).
- **Estado no jugable**: si un despliegue cambia el catálogo y una secuencia ACTIVE (o un intento abierto) referencia
  reglas que ya no existen, el servidor la retira sin culpa del jugador (intento `TIMEOUT` con mensaje explicativo, sin
  efecto en racha, puntos ni estadísticas; secuencia `FAILED`; vuelta al reto 1). La migración `…_world_sequences` hace lo
  mismo con los intentos abiertos del catálogo fijo (por eso conserva la racha: no fue un fallo del jugador).
- **Despliegue de `…_world_sequences`**: no admite despliegue en caliente (los procesos antiguos no rellenan
  `position`/`expression`). Orden: detener la API antigua → `npm run db:migrate:deploy -w apps/api` → `npm run db:seed` →
  arrancar la nueva.
- **Reiniciar el mundo** conserva puntos y mejor racha (los puntos ganados nunca se borran).
- Longitud máxima de respuesta: 200 caracteres (acota la recursión del parser).
