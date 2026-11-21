# Referencia rápida de la API

Base: `http://localhost:3000/api` · Swagger interactivo: `/api/docs` · Todo (salvo `/auth/{register,login,password/*}` y
`/health*`) requiere `Authorization: Bearer <accessToken>`; el token solo vale mientras su **sesión** siga vigente (se revoca
con logout, cambio/recuperación de contraseña…). Autenticación y cuentas: [authentication.md](./authentication.md). Los endpoints de juego son solo para estudiantes (otros roles reciben 403). Grupos, docentes y panel docente: ver
[groups-and-teachers.md](./groups-and-teachers.md).

## Flujo de una partida

```bash
B=http://localhost:3000/api

# 1. Cuenta y token
curl -s -X POST $B/auth/register -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","displayName":"Ana","password":"correct-horse-battery"}'
TOKEN=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"ana@example.com","password":"correct-horse-battery"}' | jq -r .accessToken)
A="Authorization: Bearer $TOKEN"

# 2. Sesión en el mundo 1 (201 si se crea, 200 si se reanuda)
SID=$(curl -s -X POST $B/worlds/arithmetic/sessions -H "$A" | jq -r .session.id)

# 3. Iniciar el reto actual: el cronómetro del SERVIDOR empieza aquí
curl -s -X POST $B/sessions/$SID/attempts -H "$A"
# → { attemptId, position: 1, expression: "3 * 7", rules: [], newRule: null,
#     timeLimitSeconds: 60, deadlineAt, serverTime, remainingMs, ... }

# 4. Responder: la ÚNICA entrada del cliente es la expresión
curl -s -X POST $B/attempts/$AID/answer -H "$A" -H 'content-type: application/json' -d '{"expression":"21"}'
# → { outcome: "CORRECT", score: { points: 100, multiplier: "1" }, progress: { streak: 1, ... }, ... }
```

## Semántica

| Situación                                                                 | Resultado                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Respuesta correcta y válida con las reglas                                | `CORRECT`; puntos = base × multiplicador; se guarda la regla nueva; avanza al siguiente reto                                        |
| Resultado erróneo, sintaxis inválida, división entre cero o regla violada | `INCORRECT` (con `failureReason` y `violations`); 0 puntos; racha a 0; **reinicia la secuencia**; las reglas guardadas se conservan |
| Envío fuera de plazo (reloj del servidor)                                 | `TIMEOUT`; mismas consecuencias que un fallo; la respuesta no se evalúa                                                             |
| Reto abandonado                                                           | Se cierra como `TIMEOUT` al volver a consultar el estado o iniciar un reto                                                          |
| Reenviar la misma expresión                                               | 200 con el resultado original (`replayed: true`); no se puntúa dos veces                                                            |
| Otra expresión en un reto ya resuelto                                     | 409 (un solo intento por reto)                                                                                                      |
| Campos extra en el cuerpo (`points`, `streak`, `submittedAt`…)            | 400                                                                                                                                 |
| Sesión/intento de otro jugador                                            | 404                                                                                                                                 |

Formato de respuesta aceptado: `expresión` o `expresión = resultado` (p. ej. `41 + 1 = 42`). Operadores `+ - * /` (también
`× ÷ −`), paréntesis y `-` unario; enteros solamente; máximo 200 caracteres.

## Endpoints

| Método | Ruta                                    | Códigos             | Notas                                                                                                                         |
| ------ | --------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/register`                        | 201, 400, 409       | Siempre crea un estudiante                                                                                                    |
| POST   | `/auth/login`                           | 200, 400, 401, 429  | `{ accessToken, tokenType, expiresIn }`; crea una sesión                                                                      |
| GET    | `/users/me`                             | 200, 401            |                                                                                                                               |
| GET    | `/worlds`                               | 200                 | Mundos habilitados                                                                                                            |
| GET    | `/progress`                             | 200, 403            | Progreso y **racha por mundo**                                                                                                |
| GET    | `/worlds/:slug/progress`                | 200, 404            | Posición, racha, puntos, reglas, estadísticas, ids abiertos                                                                   |
| GET    | `/worlds/:slug/rules`                   | 200, 404            | Reglas acumuladas (guardadas)                                                                                                 |
| GET    | `/worlds/:slug/score?limit=`            | 200, 404            | Total, racha, próximo multiplicador, libro de puntos reciente                                                                 |
| GET    | `/worlds/:slug/leaderboard?limit=`      | 200, 404            | Clasificación por puntos **solo entre compañeros de grupo** (sin grupo: solo el jugador); nombre y puntos, sin ids ni correos |
| GET    | `/worlds/:slug/attempts?limit=&cursor=` | 200, 400, 404       | Historial (fallos y timeouts incluidos), más recientes primero                                                                |
| POST   | `/worlds/:slug/sessions`                | 201 / 200, 404      | Crea o reanuda; `expiredAttempt` ≠ null si un reto venció en la ausencia (TIMEOUT)                                            |
| POST   | `/sessions/:id/end`                     | 200, 404, 409       | 409 si hay un reto vigente                                                                                                    |
| POST   | `/sessions/:id/attempts`                | 201 / 200, 404, 409 | Crea o reanuda el intento abierto                                                                                             |
| GET    | `/sessions/:id/attempts/current`        | 200, 404            |                                                                                                                               |
| POST   | `/attempts/:id/answer`                  | 200, 400, 404, 409  | Cuerpo: `{ "expression": "…" }`                                                                                               |

Puntos: enteros. `multiplierMilli` en milésimas (1500 = 1.5x) y `multiplier` como texto (`"1.5"`).

## Cuenta, contraseñas y sesiones

Detalle, flujos y configuración en [authentication.md](./authentication.md). Los `429` llevan `Retry-After` (segundos).

| Método | Ruta                        | Auth   | Códigos                      | Notas                                                           |
| ------ | --------------------------- | ------ | ---------------------------- | --------------------------------------------------------------- |
| POST   | `/auth/change-password`     | Bearer | 200, 400, 401, 403, 409, 429 | `{ currentPassword, newPassword }`; revoca TODAS las sesiones   |
| POST   | `/auth/password/forgot`     | —      | 202, 400, 429                | `{ email }`; misma respuesta exista o no la cuenta              |
| POST   | `/auth/password/reset`      | —      | 200, 400                     | `{ token, newPassword }`; token de un solo uso; revoca sesiones |
| GET    | `/auth/sessions`            | Bearer | 200, 400, 401                | `?status=ACTIVE\|ALL&limit&cursor`; solo las propias            |
| DELETE | `/auth/sessions/:sessionId` | Bearer | 204, 400, 401, 404           | Revoca una sesión propia (ajena → 404)                          |
| POST   | `/auth/logout`              | Bearer | 204, 401                     | Revoca la sesión actual                                         |
| POST   | `/auth/logout-all`          | Bearer | 200, 401                     | `{ revokedSessions }`                                           |

```bash
# Cambiar la contraseña (tras el 200, el token usado ya no sirve: vuelve a hacer login)
curl -s -X POST $B/auth/change-password -H "$A" -H 'content-type: application/json' \
  -d '{"currentPassword":"correct-horse-battery","newPassword":"una-clave-nueva-y-larga"}'

# Recuperación: el correo trae un enlace …/reset-password#token=<token>
curl -s -X POST $B/auth/password/forgot -H 'content-type: application/json' -d '{"email":"ana@example.com"}'
curl -s -X POST $B/auth/password/reset  -H 'content-type: application/json' -d '{"token":"<token>","newPassword":"otra-clave-larga-1"}'
```

## Grupos, docentes y panel docente

Detalle completo, semántica de métricas, autorización y ejemplos en [groups-and-teachers.md](./groups-and-teachers.md).

| Método   | Ruta                                                                    | Rol     | Códigos                |
| -------- | ----------------------------------------------------------------------- | ------- | ---------------------- |
| POST     | `/admin/teachers`                                                       | ADMIN   | 201, 400, 403, 409     |
| POST     | `/admin/groups` · GET `/admin/groups` · GET/PATCH `…/:id`               | ADMIN   | 201/200, 400, 404      |
| POST     | `/admin/groups/:id/deactivate` · `/reactivate`                          | ADMIN   | 200, 404, 409          |
| GET/POST | `/admin/groups/:id/teachers`                                            | ADMIN   | 200/201, 404, 409, 422 |
| DELETE   | `/admin/groups/:id/teachers/:teacherId`                                 | ADMIN   | 204, 404               |
| GET      | `/teacher/groups` · `/teacher/groups/:id`                               | TEACHER | 200, 404               |
| PATCH    | `/teacher/groups/:id`                                                   | TEACHER | 200, 400, 404, 409     |
| GET/POST | `/teacher/groups/:id/students`                                          | TEACHER | 200/201, 404, 409, 422 |
| DELETE   | `/teacher/groups/:id/students/:studentId`                               | TEACHER | 204, 404, 409          |
| GET      | `/teacher/dashboard`                                                    | TEACHER | 200                    |
| GET      | `/teacher/groups/:id/dashboard` · `/dashboard/students` · `/statistics` | TEACHER | 200, 404               |
| GET      | `/teacher/groups/:id/students/:studentId` · `/statistics` · `/attempts` | TEACHER | 200, 404               |
| GET      | `/users/me/groups`                                                      | STUDENT | 200                    |

Un grupo o estudiante fuera del alcance del docente responde siempre **404** (igual que si no existiera).
