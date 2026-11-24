# EUREKA — Plan maestro de desarrollo (5 mundos)

> Documento vivo. Registra arquitectura, decisiones, contratos entre equipos, hitos y estado real.
> Última actualización: 2026-11-22 · Rama: `dlomito-002/eureka-orchestrator-development`

## 1. Estado de partida (auditoría)

| Área                                                                  | Estado al empezar                                                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Consolidación `frontend/` → `apps/web`                                | **Hecha** en `back-002` (`1f33709`, `346cb68`); integrada en esta rama por fast-forward. `frontend/` ya no existe |
| Motor (parser, evaluador `Fraction`, `RuleEngine`, `ChallengeEngine`) | Implementado y probado. Solo enteros; 2 tipos de regla (`FORBIDDEN_DIGIT`, `REQUIRED_OPERATION`)                  |
| Generador determinista (`challenges/generation`)                      | Implementado y probado (`8298637`), **sin integrar** en el juego                                                  |
| Mundo 1                                                               | Secuencia **fija** de 4 retos y 3 reglas                                                                          |
| Mundos 2–5                                                            | **No existen** (solo nombres en el README)                                                                        |
| Reglas tras un fallo                                                  | Se **conservaban** (contradice el requisito: deben descartarse)                                                   |
| Desbloqueo de mundos                                                  | No existe                                                                                                         |
| Dificultad adaptativa                                                 | Solo interfaz (`staticDifficultyPolicy`)                                                                          |
| Auth, sesiones JWT revocables, grupos, panel docente, clasificación   | Implementado, integrado y probado                                                                                 |
| Pruebas de partida                                                    | API 413 unitarias + 227 integración, web 109: todas en verde                                                      |

## 2. Mecánica (requisitos del usuario, no negociables)

1. Una **secuencia** empieza eligiendo al azar un **subconjunto** de las reglas del mundo y un **orden** de introducción.
2. Reto 1 sin regla; el reto _i_ (i ≥ 2) introduce la regla _i − 1_ del orden; las anteriores siguen activas.
3. **Respuesta incorrecta = fallo directo. Tiempo agotado = fallo directo.** Se registran (intento, motivo, estadísticas).
4. Un fallo **descarta** las reglas de la secuencia, pone la racha a 0 y la próxima secuencia vuelve a sortear subconjunto y orden.
5. Los **puntos nunca se pierden** (libro de puntos solo-inserción). Multiplicador por racha sin cambios.
6. Completar todos los retos de la secuencia **completa el mundo** y desbloquea el siguiente.

## 3. Decisiones de arquitectura

- **D1 — Secuencias persistidas (`game_sequences` + `sequence_challenges`).** Al empezar el primer reto sin secuencia activa,
  el servidor planifica (semilla del servidor + dificultad) y guarda reglas en orden y TODOS los retos generados (con solución
  de referencia, nunca expuesta). Un fallo la marca `FAILED`; completarla, `COMPLETED`. Una sola `ACTIVE` por (jugador, mundo)
  (índice único parcial). Ventajas: el plan es auditable y reproducible, sobrevive a recargas/sesiones y la generación nunca
  falla a mitad de secuencia.
- **D2 — Migración aditiva.** `challenge_attempts.challengeId` pasa a ser opcional (los intentos antiguos lo conservan);
  los nuevos referencian `sequenceChallengeId`. CHECK: al menos uno de los dos. Se añaden `position` y `expression` al intento
  (instantánea; backfill desde `challenges`). `student_world_progress` gana `completionsCount` y `firstCompletedAt` (backfill).
  La tabla `challenges` queda como histórico del catálogo fijo del Mundo 1: no se borra.
- **D3 — `UnlockedRule` = reglas dominadas.** Se sigue insertando al superar un reto que introduce una regla y nunca se borra:
  ahora significa "reglas que ya superaste alguna vez" (colección), NO reglas activas. Las activas salen de la secuencia.
- **D4 — Tamaño del subconjunto.** `ruleCount` por mundo y nivel (`EASIER`/`BASELINE`/`HARDER`); crece de mundo en mundo
  (ver §4). La dificultad se elige al empezar cada secuencia con una política adaptativa pura (racha, precisión reciente,
  timeouts) y se guarda en la secuencia.
- **D5 — Desbloqueo.** El mundo _n_ se puede jugar si el mundo _n − 1_ tiene `completionsCount > 0`. El Mundo 1 siempre.
  El servidor lo impone (403 al iniciar sesión en un mundo bloqueado); el frontend solo lo refleja.
- **D6 — El catálogo vive en código**, la BD guarda filas de mundos y reglas para FKs. `WorldsRepository` combina ambos.
- **D7 — Sintaxis por mundo** (`MathSyntax`: decimales, potencias), pasada al parser en cada evaluación. El Mundo 1 queda igual.
- **D8 — Semillas inyectables** (`SeedSource`): aleatorias en producción, deterministas en pruebas y en el seed de demo.

## 4. Diseño de los cinco mundos

| #   | Mundo (slug)                         | Conceptos                                                    | Sintaxis            | Enunciados                                       | Reglas/secuencia (E/B/H) |
| --- | ------------------------------------ | ------------------------------------------------------------ | ------------------- | ------------------------------------------------ | ------------------------ |
| 1   | Aritmética (`arithmetic`)            | Cuatro operaciones, jerarquía de operaciones, descomposición | enteros             | productos, cocientes exactos, sumas de productos | 2 / 3 / 4                |
| 2   | Números y signos (`signs`)           | Negativos, regla de los signos, resta como suma del opuesto  | enteros             | operaciones con resultado negativo o con signos  | 2 / 3 / 4                |
| 3   | Fracciones y decimales (`fractions`) | Fracciones, decimales exactos, equivalencias                 | + decimales         | sumas/productos de fracciones, decimales         | 2 / 3 / 4                |
| 4   | Álgebra (`algebra`)                  | Ecuaciones lineales, potencias, paréntesis                   | + potencias         | `a * x + b = c` (responder x), potencias         | 2 / 3 / 4                |
| 5   | Caos matemático (`chaos`)            | Todo lo anterior combinado                                   | decimales+potencias | mezcla de todas las familias                     | 3 / 4 / 5                |

Repertorio de reglas por mundo (≥ ruleCount.HARDER, todas compatibles entre sí en cualquier subconjunto y orden):
ver los catálogos `apps/api/src/modules/worlds/catalog/*.world.ts` (fuente de verdad) y §9.

Nuevos tipos de regla (además de `FORBIDDEN_DIGIT` y `REQUIRED_OPERATION`): `REQUIRED_OPERATOR`, `FORBIDDEN_OPERATOR`,
`MIN_NUMBERS`, `MAX_NUMBER`, `REQUIRED_NEGATIVE`, `REQUIRED_DECIMAL`, `REQUIRED_PARENTHESES` (el especialista del motor puede
ajustar la lista; la tabla final se documenta en §9).

## 5. Contratos entre equipos

### 5.1 Motor ↔ backend (TypeScript, `apps/api/src/modules`)

- `worlds/world.types.ts`: `WorldDefinition { slug, name, description, position, concepts, rules, syntax, sequence: { ruleCount, extraTimeSeconds }, generation }`, `DifficultyLevel`.
- `challenges/math/syntax.ts`: `MathSyntax { decimals, powers }`, `DEFAULT_MATH_SYNTAX`.
- `ChallengeDefinition.statementKind?: 'EXPRESSION' | 'EQUATION'`.
- `ChallengeEngine.evaluateSubmission({ challenge, activeRules, submission, syntax? })` y `verifySolvable(challenge, rules, syntax?)`.
- `sequences/sequence.types.ts`: `SequencePlan`, `PlannedChallenge`, `SequencePlanningError`, `MAX_SEQUENCE_SEED`.
- `sequences/sequence-planner.ts`: `planSequence(world, { seed, difficulty }): SequencePlan` (puro, determinista, nunca devuelve un
  reto no verificado; reintenta con sub-semillas y lanza `SequencePlanningError` solo si el catálogo es defectuoso).
- `worlds/world-validator.ts`: `validateWorldDefinition(world, deps)` valida repertorio, `ruleCount`, compatibilidad y que se
  puede planificar (muestra de semillas).

### 5.2 API ↔ frontend (HTTP; ampliaciones compatibles)

`GET /worlds` → `WorldSummaryDto[]`:
`{ slug, name, description, position, challengeCount /* retos de una secuencia BASELINE */, ruleCount /* tamaño del repertorio */, concepts: string[], syntax: { decimals, powers } }`

`GET /progress`, `GET /worlds/:slug/progress` → `WorldProgressDto` (+ campos nuevos):

```
unlocked: boolean
unlockRequirement: { worldSlug, worldName, position } | null   // mundo que hay que completar; null si desbloqueado
completionsCount: number
firstCompletedAt: string | null
ruleCount: number                       // tamaño del repertorio del mundo
challengeCount: number                  // retos de la secuencia activa (o de una BASELINE si no hay)
activeSequence: { id, difficulty: 'EASIER'|'BASELINE'|'HARDER', challengeCount, rules: Rule[] /* activas ya superadas en esta secuencia */ } | null
unlockedRules: UnlockedRule[]           // SIGNIFICADO NUEVO: reglas dominadas (superadas alguna vez); no se pierden
```

`POST /sessions/:id/attempts`, `GET /sessions/:id/attempts/current` → `ChallengeAttemptDto` (+):
`{ sequenceId, difficulty, statementKind: 'EXPRESSION'|'EQUATION', instruction: string, syntax: { decimals, powers } }`
(`rules` = reglas activas de ESTA secuencia + la nueva; `challengeCount` = longitud de esta secuencia).

`POST /attempts/:id/answer` → `AnswerResultDto` (+):
`discardedRules: Rule[]` (reglas de la secuencia que el fallo descarta; `[]` si acierto),
`nextWorldUnlocked: { slug, name, position } | null` (si este acierto desbloqueó por primera vez el siguiente mundo).

`POST /worlds/:slug/sessions` en mundo bloqueado → **403** `{ message: 'Completa el Mundo N (Nombre) para desbloquear este mundo.' }`.

## 6. Reparto del trabajo (propiedad de archivos)

| Equipo                         | Propiedad                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orquestador (sesión principal) | Prisma (esquema/migración), `game/`, `progression/`, `worlds/{repository,catalog-sync,controller,module,service}`, DTOs, `teacher-dashboard/`, `statistics/`, seeds, pruebas de integración, documentación |
| Especialista del motor         | `challenges/**`, `sequences/sequence-planner*`, `worlds/catalog/**`, `worlds/world-validator.ts`, specs de catálogos                                                                                       |
| Especialista de frontend       | `apps/web/**`                                                                                                                                                                                              |
| QA y revisor independiente     | Solo lectura + informes; los arreglos los integra el orquestador                                                                                                                                           |

## 7. Hitos

- [x] H1 Motor: sintaxis por mundo, nuevos tipos de regla, familias de enunciados, planificador, catálogos de los 5 mundos
- [x] H2 Backend: secuencias persistidas, migración aditiva, desbloqueo, dificultad adaptativa, DTOs, seed y demo
- [x] H3 Frontend: mapa de 5 mundos con desbloqueo, juego por mundo, progreso/clasificación por mundo
- [x] H4 QA: pruebas funcionales de los 5 mundos y regresión (ver §10)
- [x] H5 Revisión independiente y corrección de hallazgos críticos/altos (ver §11)
- [x] H6 Documentación (README, architecture, api, demo, este plan)

## 8. Registro de estado

- 2026-11-22 — Auditoría completada; rama avanzada por fast-forward a `back-002` (consolidación `frontend/`→`apps/web` y
  generador ya hechos allí). Contratos §5 escritos. Especialistas de motor y frontend trabajando en paralelo sobre archivos
  disjuntos; el orquestador integra backend, migración y pruebas.
- 2026-11-23 — Integración: bloqueo detectado por las pruebas (consulta con el cliente raíz dentro de una transacción en
  `WorldUnlockService` → `WorldsRepository`), corregido pasando el cliente transaccional. `npm run verify` en verde salvo
  el formato de `pnpm-lock.yaml` (archivo sin seguimiento previo del usuario, no tocado). Prueba de humo con la API
  compilada + seeds reales. Commits `49830c6` (API) y `a296092` (web).

- 2026-11-23 — Revisión independiente (backend y frontend, en paralelo, solo lectura). Backend: 30 000 secuencias
  fuzzeadas sin problemas; 0 críticos/altos; medios y bajos corregidos en `bfbf407` y `0ac97ec`. Frontend: sin deriva de
  contrato; 2 altos y los medios corregidos en `65d4551`. Verificación final en vivo (API compilada + Vite + navegador):
  aviso de reto vencido desde el mapa, tarjeta de inicio sin cronómetro, aviso de `x` en una ecuación real.

## 9. Catálogo final de reglas

Fuente de verdad: `apps/api/src/modules/worlds/catalog/*.world.ts`.

| Mundo | Clave                             | Tipo                   | Config                          | Descripción                                                                   |
| ----- | --------------------------------- | ---------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| 1     | `arithmetic.forbidden-digit-2`    | `FORBIDDEN_DIGIT`      | `{digit:2}`                     | No puedes usar el dígito 2.                                                   |
| 1     | `arithmetic.required-7-times-1`   | `REQUIRED_OPERATION`   | `{operator:'*',left:7,right:1}` | Debes usar la multiplicación 7 \* 1.                                          |
| 1     | `arithmetic.forbidden-digit-5`    | `FORBIDDEN_DIGIT`      | `{digit:5}`                     | No puedes usar el dígito 5.                                                   |
| 1     | `arithmetic.required-division`    | `REQUIRED_OPERATOR`    | `{operator:'/'}`                | Debes usar al menos una división.                                             |
| 1     | `arithmetic.required-parentheses` | `REQUIRED_PARENTHESES` | `{}`                            | Usa paréntesis que cambien el orden de las operaciones, como en (2 + 3) \* 4. |
| 1     | `arithmetic.min-numbers-4`        | `MIN_NUMBERS`          | `{count:4}`                     | Usa al menos 4 números.                                                       |
| 2     | `signs.required-negative`         | `REQUIRED_NEGATIVE`    | `{}`                            | Usa al menos un número negativo, como (-3).                                   |
| 2     | `signs.forbidden-digit-3`         | `FORBIDDEN_DIGIT`      | `{digit:3}`                     | No puedes usar el dígito 3.                                                   |
| 2     | `signs.max-number-10`             | `MAX_NUMBER`           | `{max:10}`                      | Ningún número puede ser mayor que 10.                                         |
| 2     | `signs.required-multiplication`   | `REQUIRED_OPERATOR`    | `{operator:'*'}`                | Debes usar al menos una multiplicación.                                       |
| 2     | `signs.required-subtraction`      | `REQUIRED_OPERATOR`    | `{operator:'-'}`                | Debes usar al menos una resta (el signo de un número negativo no cuenta).     |
| 3     | `fractions.required-decimal`      | `REQUIRED_DECIMAL`     | `{}`                            | Usa al menos un número decimal, como 0.5.                                     |
| 3     | `fractions.required-division`     | `REQUIRED_OPERATOR`    | `{operator:'/'}`                | Usa al menos una división (una fracción como 3 / 4 cuenta).                   |
| 3     | `fractions.forbidden-digit-5`     | `FORBIDDEN_DIGIT`      | `{digit:5}`                     | No puedes usar el dígito 5 (tampoco en decimales como 0.5).                   |
| 3     | `fractions.min-numbers-3`         | `MIN_NUMBERS`          | `{count:3}`                     | Usa al menos 3 números.                                                       |
| 3     | `fractions.max-number-10`         | `MAX_NUMBER`           | `{max:10}`                      | Ningún número puede ser mayor que 10.                                         |
| 4     | `algebra.required-power`          | `REQUIRED_OPERATOR`    | `{operator:'^'}`                | Usa al menos una potencia, como 2 ^ 3.                                        |
| 4     | `algebra.required-parentheses`    | `REQUIRED_PARENTHESES` | `{}`                            | Usa paréntesis que cambien el orden de las operaciones, como en (2 + 3) \* 4. |
| 4     | `algebra.max-number-9`            | `MAX_NUMBER`           | `{max:9}`                       | Usa solo números de una cifra (ninguno mayor que 9).                          |
| 4     | `algebra.forbidden-digit-1`       | `FORBIDDEN_DIGIT`      | `{digit:1}`                     | No puedes usar el dígito 1.                                                   |
| 4     | `algebra.min-numbers-3`           | `MIN_NUMBERS`          | `{count:3}`                     | Usa al menos 3 números.                                                       |
| 5     | `chaos.forbidden-digit-0`         | `FORBIDDEN_DIGIT`      | `{digit:0}`                     | No puedes usar el dígito 0 (tampoco en 10 ni en 0.5).                         |
| 5     | `chaos.required-power`            | `REQUIRED_OPERATOR`    | `{operator:'^'}`                | Usa al menos una potencia, como 2 ^ 3.                                        |
| 5     | `chaos.required-decimal`          | `REQUIRED_DECIMAL`     | `{}`                            | Usa al menos un número decimal, como 1.5.                                     |
| 5     | `chaos.required-negative`         | `REQUIRED_NEGATIVE`    | `{}`                            | Usa al menos un número negativo, como (-3).                                   |
| 5     | `chaos.required-parentheses`      | `REQUIRED_PARENTHESES` | `{}`                            | Usa paréntesis que cambien el orden de las operaciones, como en (2 + 3) \* 4. |
| 5     | `chaos.min-numbers-4`             | `MIN_NUMBERS`          | `{count:4}`                     | Usa al menos 4 números.                                                       |
| 5     | `chaos.max-number-12`             | `MAX_NUMBER`           | `{max:12}`                      | Ningún número puede ser mayor que 12.                                         |

| Mundo                    | Sintaxis            | ruleCount E/B/H | Tiempo extra | Familias de enunciados                                        |
| ------------------------ | ------------------- | --------------- | ------------ | ------------------------------------------------------------- |
| 1 Aritmética             | enteros             | 2/3/4           | 0 s          | multiplicativa                                                |
| 2 Números y signos       | enteros             | 2/3/4           | 5 s          | con signos (×3), multiplicativa (×1)                          |
| 3 Fracciones y decimales | decimales           | 2/3/4           | 10 s         | fraccionaria, decimal                                         |
| 4 Álgebra                | potencias           | 2/3/4           | 20 s         | ecuaciones lineales (×2), potencias (×1)                      |
| 5 Caos matemático        | decimales+potencias | 3/4/5           | 25 s         | con signos, fraccionaria, decimal, potencias, ecuaciones (×2) |

`FORBIDDEN_OPERATOR` está implementado y probado, pero ningún catálogo lo usa (ver ADR 17 en `docs/architecture.md`).

## 10. Resultados de pruebas (ejecución real)

| Comprobación                                                                      | Resultado                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (API + web)                                                   | OK                                                                                                                                 |
| `npx eslint .`                                                                    | OK                                                                                                                                 |
| API unitarias (`test:unit`)                                                       | 38 suites, 685 pruebas OK                                                                                                          |
| API integración (`test:integration`, PGlite)                                      | 18 suites, 247 pruebas OK (5 mundos con planificador real, demo, migración sobre datos antiguos y robustez)                        |
| Web (`vitest`)                                                                    | 8 archivos, 146 pruebas OK                                                                                                         |
| `npm run build` (API + web)                                                       | OK                                                                                                                                 |
| `prisma migrate diff` migraciones ↔ esquema                                       | vacío (sin deriva)                                                                                                                 |
| Humo: API compilada + `db:seed` + `db:seed:demo` reales sobre PostgreSQL (PGlite) | 5 mundos servidos, desbloqueos correctos, ecuación y potencias en el Mundo 5, fallo con reglas descartadas, 403 en mundo bloqueado |
| `prettier --check .`                                                              | OK salvo `pnpm-lock.yaml` (archivo sin seguimiento previo, ajeno a este trabajo)                                                   |

## 11. Revisión independiente: hallazgos y resolución

| Hallazgo                                                                                                                                                                                                         | Severidad  | Resolución                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Aviso «reto vencido» nunca visible al entrar desde el mapa (la lectura de `/progress` lo consumía)                                                                                                               | Alta       | API: `expiredAttempt` se informa hasta el siguiente reto (`0ac97ec`); web lo muestra al entrar     |
| En ecuaciones, escribir `x = …` (invitado por el prefijo) terminaba la secuencia                                                                                                                                 | Alta       | Web: aviso previo al envío solo para `x` en ecuaciones; el servidor sigue siendo la autoridad      |
| Abrir un mundo arrancaba el cronómetro (curiosear generaba TIMEOUTs)                                                                                                                                             | Media      | Web: tarjeta «Empezar desafío»; el reto solo empieza al pulsarla (o se reanuda si hay uno abierto) |
| Cambio de catálogo (regla renombrada) o intento antiguo abierto ⇒ errores 500 permanentes                                                                                                                        | Media      | API: el servidor retira el estado no jugable sin culpa del jugador (`bfbf407`)                     |
| `MAX_NUMBER`: texto engañoso con números negativos                                                                                                                                                               | Media      | Texto de la regla y del mensaje alineados con la semántica (número escrito; el signo no cuenta)    |
| `startAttempt` no volvía a comprobar desbloqueo ni mundo habilitado                                                                                                                                              | Baja–media | API: comprobación en cada reto                                                                     |
| Mensaje `WRONG_RESULT` revelaba el valor esperado                                                                                                                                                                | Baja       | API: mensaje sin el valor                                                                          |
| `-0` contaba como número negativo                                                                                                                                                                                | Baja       | `REQUIRED_NEGATIVE` exige un valor negativo                                                        |
| `db:seed` reactivaba mundos deshabilitados; ratio del panel docente > 100 %                                                                                                                                      | Baja       | Corregidos                                                                                         |
| Diálogo de fin sin foco atrapado ni salida; 320 px; fracciones como `÷`; `x` poco visible; pestañas cortadas; candado que apunta a otro mundo bloqueado; contraste y textos < 11 px; etiquetas docentes ambiguas | Media/Baja | Web: corregidos (`65d4551`)                                                                        |
| Migración no apta para despliegue en caliente; el TIMEOUT de la transición conserva la racha; `n / 1` cumple «usa una división»; la regla nueva no siempre muerde sola                                           | Baja       | Decisiones documentadas en `docs/architecture.md` (Supuestos)                                      |

## 12. Limitaciones conocidas

- La justicia de las reglas (que un humano las resuelva a tiempo) se juzgó con muestras y topes de resultado, no con
  jugadores reales: conviene una prueba con estudiantes, sobre todo en Caos con dificultad intensa.
- Las pruebas de integración usan PGlite con un pool de 1 conexión; la serialización concurrente real (`FOR UPDATE`) se
  prueba de forma lógica. Antes de producción: prueba de humo contra un PostgreSQL real con varias conexiones.
- Sin ilustraciones de fondo por mundo (la identidad se mantiene con el acento de color de cada mundo).
- Progreso y clasificación sin mundo en la URL abren el mundo con más actividad (la API no expone «último jugado»).
- `pnpm-lock.yaml` (sin seguimiento y previo a este trabajo) no pasa `prettier --check`; no se tocó.
