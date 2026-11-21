# Arquitectura — Matemática bajo reglas

## Visión general

Monolito modular (sin microservicios):

```
apps/web  (React) ──HTTP /api──▶ apps/api (NestJS) ──Prisma──▶ PostgreSQL
```

El backend se organiza por **dominios**, no por capas genéricas. Las clases del motor del juego son TypeScript
**puro** (sin decoradores de Nest, sin Prisma, sin reloj propio) y Nest solo las cablea en los módulos mediante
`useFactory`. Esto permite probar el motor de forma aislada y reutilizarlo desde cualquier capa.

### Módulos del backend (`apps/api/src`)

| Módulo / carpeta                                         | Estado       | Responsabilidad                                                                   |
| -------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| `modules/challenges`                                     | Implementado | Parser, evaluador, reglas, `RuleEngine`, `RuleAccumulator`, `ChallengeEngine`     |
| `modules/worlds`                                         | Implementado | Catálogo de mundos (Mundo 1) y validador de catálogos (garantía de resolubilidad) |
| `modules/scoring`                                        | Implementado | `StreakManager`, `ScoringEngine` (aritmética entera)                              |
| `modules/progression`                                    | Implementado | `ProgressionManager`: estado por jugador y mundo, reinicio de secuencia vs. mundo |
| `modules/game`                                           | Implementado | `TimerManager`, `GameEngine` (fachada), punto de extensión de dificultad          |
| `prisma`, `health`, `common`, `config`                   | Implementado | Infraestructura: acceso a BD, health, filtro de errores/Swagger, entorno          |
| `auth`, `users`, `groups`                                | Pendiente    | JWT, usuarios, grupos y autorización de docentes                                  |
| `rankings`, `statistics`, `rewards`, `teacher-dashboard` | Pendiente    | Derivados del historial de intentos y de `ScoreTransaction`                       |

Dependencias entre módulos (acíclicas): `challenges ← worlds ← progression ← game`, `scoring ← game`.

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
`ScoreTransaction`.

| Requisito                                             | Cómo se cubre                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Estudiante en varios grupos                           | `GroupMembership` con `@@unique([userId, groupId])`                                    |
| Docente con varios grupos / grupo con varios docentes | `TeacherGroupAssignment` (N:M); la autorización se deriva solo de esta tabla           |
| Estudiante en varios mundos, racha independiente      | `StudentWorldProgress` único por `(userId, worldId)` con su propia racha/puntos        |
| Reglas acumuladas por jugador y mundo                 | `UnlockedRule` ligada al progreso; sobrevive a fallos y nuevas sesiones                |
| Historial incluyendo fallos y timeouts                | `ChallengeAttempt` (`outcome`, `failureReason`, `submission`, tiempos, reglas activas) |
| Puntos auditables                                     | `ScoreTransaction` solo-inserción, 1:1 con el intento (`attemptId` único)              |
| Reglas separadas de los retos                         | `Rule` propia; `Challenge.introducesRuleId` (único) solo la referencia                 |

Decisiones y omisiones deliberadas:

- **`ChallengeRule` no existe**: cada reto introduce a lo sumo una regla, así que basta una FK única
  (`Challenge.introducesRuleId`). Si algún día un reto introduce varias, se migra a una tabla de unión.
- **`WorldStatistics` no existe**: es derivable del historial de intentos; se creará (o se materializará) cuando se
  implemente `statistics`, evitando datos duplicados que se desincronicen.
- `Rule.type` es `String` (no enum) para añadir tipos sin migración. `config` es `Json` validado por el `RuleHandler`.
- `Challenge.referenceSolution` es sensible: ningún DTO de estudiante debe exponerlo.
- IDs `uuid(7)` (ordenables por tiempo). Tiempos `timestamp` en UTC.
- `StudentWorldProgress.totalPoints` es una caché; la fuente auditable es la suma de `ScoreTransaction.points`.
- Un único intento por reto presentado: `ChallengeAttempt` se crea `PENDING` al iniciar el reto y se resuelve una sola vez.
  _Pendiente_: índice único parcial en BD para "un solo intento `PENDING` por sesión" (Prisma no lo expresa; irá en SQL de migración).
- Invariante de aplicación: `TeacherGroupAssignment.teacherId` debe ser un usuario con rol `TEACHER`.

### Integridad de la puntuación y autorización (principio)

- El cliente **nunca** envía puntos, tiempos ni rachas: solo la respuesta. Todo se calcula y persiste en el servidor.
- Los docentes solo accederán a estudiantes de grupos que tengan en `TeacherGroupAssignment` (a aplicar en `teacher-dashboard`).
- Autenticación prevista: JWT de acceso de vida corta (`JWT_SECRET`, `JWT_EXPIRES_IN` ya reservadas) con guards de rol.

## Registro de decisiones (ADR)

1. **npm workspaces, sin `packages/` por ahora.** No hay código compartido que lo justifique; se evita infraestructura
   (Turborepo/Nx) innecesaria.
2. **NestJS 11 (CJS) y no 12.** La serie 12 es ESM-first y su plantilla usa Vitest; el requisito fija **Jest**, y Jest con ESM
   es experimental. Nest 11 + Jest 30 + ts-jest es el camino estable. Migrar a 12 será una tarea acotada (ESM + runner de tests).
3. **TypeScript 6.0.** TS 7 (compilador nativo) aún no es compatible con `ts-jest` (`<7`) ni `typescript-eslint` (`<6.1`).
4. **Prisma 7** con adaptador `pg` y generador `prisma-client` (salida en `src/generated`, `moduleFormat = "cjs"`).
   Configuración en `prisma.config.ts`; la conexión es perezosa para que la API arranque sin BD.
5. **Fracciones `BigInt` en vez de `number`.** Evita errores de coma flotante y permite comparar resultados racionales
   exactos (necesario para el Mundo 3 sin reescribir el motor).
6. **Motor sin decoradores de Nest.** Testabilidad y desacoplamiento; los módulos solo cablean con `useFactory`.
7. **Vitest + Testing Library en el frontend** (Jest en el backend, según requisito): es el runner natural de Vite.
8. **Dependencias evitadas:** `concurrently`, librerías de matemáticas/parsers (`mathjs`, `expr-eval`), `@nestjs/terminus`,
   gestores de estado. Se reevaluarán cuando exista una necesidad real.

## Supuestos (a confirmar)

- **Tiempo con 0 reglas.** La fórmula usa `activeRulesCount − 1`; el reto 1 del ejemplo no muestra regla, así que el conteo
  se acota a ≥ 1 (reto 1 y reto 2, ambos con ≤ 1 regla, reciben el tiempo base).
- **La regla del reto se desbloquea al presentarlo**, no al resolverlo; por eso persiste aunque el jugador falle ese reto.
- **Completar todos los retos** marca el progreso como `COMPLETED`; para volver a jugar se reinicia la secuencia (acción explícita).
- **`REQUIRED_OPERATION` compara literales**: `7 * 1` exige un nodo `*` con operandos literales 7 y 1 (conmutativo en `+`/`*`).
  `2 * 7 * 1` se lee como `(2 * 7) * 1` y no la contiene. Es una limitación documentada y testeada.
- **Solo enteros** en el Mundo 1 (sin decimales ni multiplicación implícita). Resultados intermedios racionales sí se permiten.
- **Reiniciar el mundo** conserva puntos y mejor racha (los puntos ganados nunca se borran).
- Longitud máxima de respuesta: 200 caracteres (acota la recursión del parser).
