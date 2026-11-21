# Grupos, docentes y panel docente (backend)

Referencia del dominio de grupos: arquitectura, modelo de datos, autorización, endpoints y operación. Solo backend
(`apps/api`): no existe ninguna vista; todo es API REST consumible por un futuro frontend. Swagger: `/api/docs`
(etiquetas `admin`, `teacher`, `teacher-dashboard`, `users`).

## 1. Arquitectura

| Módulo (`apps/api/src/modules`) | Responsabilidad                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groups`                        | `GroupAccessService` (autorización centralizada), `GroupsService`, `TeacherAssignmentsService`, `MembershipsService` y los controladores `admin/groups`, `teacher/groups`, `users/me/groups` |
| `admin`                         | Aprovisionamiento de docentes (`POST /admin/teachers`), listado de docentes y `provisionUser` (compartido con el script de CLI)                                                              |
| `teacher-dashboard`             | `TeacherDashboardService` y controlador `teacher/*` (panel, estadísticas, estudiantes, intentos)                                                                                             |
| `statistics` (ampliado)         | `StatisticsService.getMany` y `AttemptAnalyticsService` (agregados agrupados del historial de intentos)                                                                                      |
| `progression` (ampliado)        | `ProgressionService.listSummaries` (lectura masiva del progreso)                                                                                                                             |

Solo se **añadieron** métodos de lectura a `statistics` y `progression`; el motor, el ciclo de juego, los multiplicadores,
las rachas y el libro de puntos no se tocaron. El panel no mantiene agregados propios: lee `StudentWorldProgress`
(mismos puntos/rachas que ve el estudiante), `WorldStatistics` (contadores y tiempos) y el historial `ChallengeAttempt`.

Dependencias: `groups ← admin`, `groups + statistics + progression + worlds ← teacher-dashboard`.

## 2. Modelo de datos (migración `20261121180000_groups_and_teachers`)

Se **extendieron** las tablas existentes (no se recrearon):

| Tabla                       | Cambios                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `groups`                    | `description`, `status` (`ACTIVE`/`INACTIVE`), `deactivatedAt`, `createdById`                                   |
| `group_memberships`         | `status` (`ACTIVE`/`REMOVED`), `removedAt`, `addedById`, `removedById`. Una fila por **periodo** de pertenencia |
| `teacher_group_assignments` | `status` (`ACTIVE`/`REVOKED`), `revokedAt`, `assignedById`, `revokedById`. Una fila por periodo de asignación   |

Integridad en la BD (el SQL manual de la migración; Prisma no lo expresa):

- Índices únicos **parciales**: una sola membresía `ACTIVE` por `(userId, groupId)` y una sola asignación `ACTIVE` por
  `(teacherId, groupId)`. Las filas históricas no cuentan, así que se puede reincorporar/reasignar conservando el historial.
- CHECK de coherencia `status ↔ fecha de baja` en las tres tablas.
- Triggers `BEFORE INSERT`: el usuario de una membresía debe ser `STUDENT` y el de una asignación, `TEACHER`
  (defensa en profundidad; la aplicación ya lo valida con 422).
- Índices `(groupId, status)`, `(userId, status)`, `(teacherId, status)` para las consultas con alcance de grupo.
- FKs de auditoría (`*ById`) con `ON DELETE SET NULL`: el historial sobrevive al actor.
- **Los grupos no se borran**: se desactivan. No hay endpoint `DELETE` de grupos ni de membresías/asignaciones.

### Migraciones

- Aditiva: todo lo existente pasa a `ACTIVE` y no se borra ni se reescribe ningún dato.
- Verificado (a) sobre base **limpia**: el `globalSetup` de las pruebas de integración aplica todas las migraciones en cada
  ejecución y `prisma migrate deploy` también; (b) sobre una base **con datos**: `groups-migration.int-spec.ts` aplica las
  migraciones anteriores, siembra grupos/usuarios/membresías/asignaciones, aplica la nueva y comprueba que se conservan e
  imponen los invariantes; (c) sin divergencia con `schema.prisma` (`prisma migrate diff … --exit-code` → "No difference").
- Aplicar: `npm run db:migrate` (desarrollo) · `npm run db:migrate:deploy -w apps/api` (producción).

## 3. Roles y aprovisionamiento

| Rol       | Cómo se obtiene                                                                   | Alcance                                                                  |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `STUDENT` | `POST /auth/register` (público). **Siempre** crea estudiantes; rechaza `role`     | Su juego y `GET /users/me/groups`                                        |
| `TEACHER` | `POST /admin/teachers` (solo `ADMIN`). No existe registro público de docentes     | Solo grupos con **asignación activa**; panel y membresías de esos grupos |
| `ADMIN`   | Script operativo `npm run admin:create` (acceso al servidor). **No hay endpoint** | Gestión global (grupos, asignaciones, docentes, membresías)              |

### Primer administrador

El primer administrador solo puede crearse con acceso al servidor y a la base de datos (no hay ruta HTTP):

```bash
# con .env configurado (DATABASE_URL). La contraseña se pide por consola SIN eco (mín. 12 caracteres):
ADMIN_EMAIL=admin@ejemplo.com ADMIN_NAME="Admin" npm run admin:create
# en automatización también puede pasarse ADMIN_PASSWORD (evita dejarla en el historial del shell: usa un gestor de secretos)
```

El script usa el mismo hash `scrypt` y la misma unicidad de correo que el registro, **no promociona cuentas existentes**
(si el correo ya existe, falla) e imprime solo el id y el correo. Los siguientes docentes los crea un administrador por API.
Los administradores adicionales se crean con el mismo script.

> Pendiente: no hay endpoint de cambio de contraseña, por lo que la contraseña inicial de un docente (fijada por el
> administrador) no puede cambiarla el propio docente todavía. Ver "Limitaciones".

## 4. Reglas de autorización

Todo recurso con alcance de grupo pasa por **`GroupAccessService`** (un único punto), tanto en el servicio como en la consulta:

1. **Autenticación** (`JwtAuthGuard` global, deniega por defecto) → 401. El rol se recarga de la BD en cada petición.
2. **Rol** (`@Roles`) → 403. `/admin/*` solo `ADMIN`; `/teacher/*` solo `TEACHER`; `/users/me/groups` solo `STUDENT`.
   Un administrador no usa `/teacher/*` (mínimo privilegio; se gestiona desde `/admin/*`).
3. **Pertenencia** → **404** (nunca 403) para cualquier grupo que el docente no tenga asignado, exista o no, con el mismo
   mensaje. Conocer un id no da acceso ni revela existencia. El predicado es `assignedToTeacher(teacherId)`
   (asignación `ACTIVE` propia) y se incluye en el `where` de las consultas.
4. **Estudiante dentro del grupo**: para ver datos de un estudiante debe tener membresía `ACTIVE` en un grupo del docente;
   si no, 404. Si deja el grupo, el docente pierde el acceso a sus datos de inmediato (y deja de contar en los totales).
5. **Estado del grupo**: un grupo `INACTIVE` es de **solo lectura** para docentes (escrituras → 409); solo un administrador
   lo reactiva. Se asigna/retira docentes solo desde `/admin`.
6. Un docente **no puede**: asignarse o retirar docentes, cambiar el estado de un grupo, ni modificar roles, credenciales,
   puntos, intentos o reglas acumuladas (no existe ninguna operación para ello).
7. La autorización se evalúa **antes** de consultar datos sensibles; las agregaciones reciben solo ids de estudiantes ya autorizados.

Códigos: 400 validación (ids mal formados, cuerpo inválido, campos extra) · 401 sin token · 403 rol insuficiente ·
404 no encontrado / no autorizado · 409 conflicto (duplicado, grupo desactivado) · 422 el usuario existe pero no tiene el rol
adecuado (docente/estudiante).

## 5. Endpoints

Base `/api`. Todos exigen `Authorization: Bearer <token>`. Listas paginadas por cursor: `?limit=` (1–100, def. 20) y
`?cursor=` (el `nextCursor` anterior; `null` = última página).

### Administración (`ADMIN`)

| Método          | Ruta                                             | Notas                                                                                      |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| POST            | `/admin/teachers`                                | Crea un docente `{email, displayName, password}` (201, 409 correo duplicado)               |
| GET             | `/admin/teachers?search=`                        | Docentes (paginado)                                                                        |
| GET             | `/admin/teachers/:teacherId/groups?status=`      | Grupos de un docente (`ACTIVE` por defecto; `REVOKED`/`ALL` = historial)                   |
| POST            | `/admin/groups`                                  | `{name, description?, teacherIds?}`; con `teacherIds` crea y asigna en **una transacción** |
| GET             | `/admin/groups?status=`                          | Todos los grupos (`ACTIVE`/`INACTIVE`/`ALL`, def. `ALL`), orden alfabético                 |
| GET/PATCH       | `/admin/groups/:groupId`                         | Detalle / `{name?, description?}`                                                          |
| POST            | `/admin/groups/:groupId/deactivate`·`reactivate` | 200; 409 si ya estaba en ese estado                                                        |
| GET             | `/admin/groups/:groupId/teachers?status=`        | Docentes del grupo (`ALL` = historial)                                                     |
| POST            | `/admin/groups/:groupId/teachers`                | `{teacherId}` → 201; 409 duplicado/grupo inactivo; 422 no es docente; 404                  |
| DELETE          | `/admin/groups/:groupId/teachers/:teacherId`     | 204; marca `REVOKED` (no borra); 404 si no hay asignación activa                           |
| GET/POST/DELETE | `/admin/groups/:groupId/students[/:studentId]`   | Membresías (p. ej. grupos sin docente), mismas reglas que abajo                            |

### Docente: grupos y membresías (`TEACHER`, solo grupos asignados)

| Método | Ruta                                           | Notas                                                                                           |
| ------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/teacher/groups?status=`                      | Mis grupos (def. `ACTIVE`)                                                                      |
| GET    | `/teacher/groups/:groupId`                     | Detalle + docentes asignados (sin correos)                                                      |
| PATCH  | `/teacher/groups/:groupId`                     | `{name?, description?}` (no el estado)                                                          |
| GET    | `/teacher/groups/:groupId/students`            | `?search=` (nombre/correo), `?status=ACTIVE\|REMOVED\|ALL`, paginado, orden por nombre          |
| POST   | `/teacher/groups/:groupId/students`            | `{studentId}` **o** `{email}` (exactamente uno) → 201; 409 duplicado; 422 no es estudiante; 404 |
| DELETE | `/teacher/groups/:groupId/students/:studentId` | 204; marca `REMOVED` (historial); 404 si no es miembro activo                                   |

### Docente: panel (`TEACHER`)

| Método | Ruta                                                      | Contenido                                                                           |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/teacher/dashboard`                                      | Grupos **activos** asignados: datos del grupo + resumen de actividad                |
| GET    | `/teacher/groups/:groupId/dashboard`                      | Grupo + actividad + rendimiento por mundo (`studentsStarted`, `studentsCompleted`…) |
| GET    | `/teacher/groups/:groupId/dashboard/students`             | Resumen de **cada estudiante** (paginado, `?search=`)                               |
| GET    | `/teacher/groups/:groupId/statistics`                     | Errores comunes, reglas incumplidas, retos a reforzar, estudiantes en riesgo        |
| GET    | `/teacher/groups/:groupId/students/:studentId`            | Resumen del estudiante (perfil seguro, totales y desglose por mundo)                |
| GET    | `/teacher/groups/:groupId/students/:studentId/statistics` | Estadísticas por mundo: fallos consecutivos, errores, reglas, todos los retos       |
| GET    | `/teacher/groups/:groupId/students/:studentId/attempts`   | Historial de intentos **resueltos** (cursor, `?worldSlug=`), más recientes primero  |
| GET    | `/users/me/groups` (`STUDENT`)                            | Mis grupos (membresías activas) con los nombres de sus docentes                     |

`/statistics` acepta umbrales: `minAttempts` (5), `lowAccuracyBelow` (50, %), `repeatedFailures` (3), `top` (10); se devuelven
en `thresholds`.

## 6. Semántica de las métricas (disponible ≠ cero)

- **Contadores** (`points`, `attempts`, `correct`, `incorrect`, `timeouts`, `studentCount`…) valen `0` cuando no hay actividad: es un cero real.
- **Porcentajes y promedios** cuyo denominador es 0 valen **`null`** ("no disponible"), nunca 0: `accuracyPercent` (sin intentos
  resueltos), `averageCorrectResponseTimeMs` (sin aciertos), `failureRatePercent` (reto sin intentos), `lastActivityAt` (nadie ha jugado).
- `progressStatus` = `NOT_STARTED` (sin fila de progreso, `currentPosition: null`) · `IN_PROGRESS` · `COMPLETED`.
- `accuracyPercent` = aciertos ÷ intentos **resueltos** (acierto, fallo o timeout) × 100, a 1 decimal. Los `PENDING` no cuentan.
- `points`, `currentStreak`, `maxStreak`: mismos valores que `GET /progress` del propio estudiante (`StudentWorldProgress`);
  por mundo y sumados entre mundos. Los puntos coinciden con la suma del libro `ScoreTransaction` (verificado en tests).
- `averageCorrectResponseTimeMs`: solo se agrega el tiempo de los **aciertos** (es lo que registra `WorldStatistics`); a nivel de
  grupo es el promedio ponderado exacto (suma de tiempos ÷ aciertos), no un promedio de promedios.
- `challengesCompleted`: retos **distintos** acertados al menos una vez (no cuenta repeticiones tras reiniciar la secuencia).
- `activeStudentsLast7Days`: estudiantes con algún intento **iniciado** en los últimos 7 días (reloj del servidor, `Clock`).
- **Errores matemáticos comunes** = distribución de `failureReason` (`SYNTAX_ERROR`, `DIVISION_BY_ZERO`, `WRONG_RESULT`,
  `CLAIMED_RESULT_MISMATCH`, `RULE_VIOLATION`, `TIMEOUT`) y **reglas incumplidas** (de `WorldStatistics.ruleViolationCounts`, con
  tipo y descripción del catálogo). **Conceptos a reforzar** = esas reglas + los retos con precisión por debajo del umbral
  (con `minAttempts` mínimo de intentos). No existe una taxonomía de temas matemáticos en los datos, así que no se inventa.
- **Estudiantes en riesgo**: `LOW_ACCURACY` (precisión < umbral con al menos `minAttempts` intentos) y/o `REPEATED_FAILURES`
  (≥ `repeatedFailures` fallos/timeouts consecutivos más recientes en algún mundo).
- Un intento vencido que el estudiante aún no ha "cerrado" se contabiliza cuando el servidor lo resuelve (al volver a jugar o
  consultar su estado): una lectura del docente **no escribe** datos del estudiante.

## 7. Rendimiento

Sin N+1: cada endpoint ejecuta un número **fijo** de consultas agrupadas (`IN (ids autorizados)` + `groupBy`/función de ventana),
independiente del número de estudiantes (comprobado en tests contando sentencias SQL con 3 y 15 estudiantes). Los contadores de
miembros usan `_count` filtrado. Las listas de estudiantes e historial son paginadas por cursor; `statistics` agrega sobre todos los
miembros del grupo (acotado por el tamaño del grupo). Sin cachés. Los intentos se cuentan desde `WorldStatistics` (materializado);
`challengeAttempt` solo se agrega para reparto de fallos, retos y fallos consecutivos.

## 8. Ejemplos

```bash
B=http://localhost:3000/api
login() { curl -s -X POST $B/auth/login -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }

ADMIN=$(login admin@ejemplo.com 'la-clave-de-admin')
# 1. Crear un docente y un grupo con ese docente asignado
T=$(curl -s -X POST $B/admin/teachers -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"email":"profe@ejemplo.com","displayName":"Profa. Lucía","password":"clave-inicial-1"}')
TID=$(echo $T | jq -r .id)
GID=$(curl -s -X POST $B/admin/groups -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d "{\"name\":\"5.º A\",\"description\":\"Mates\",\"teacherIds\":[\"$TID\"]}" | jq -r .id)

# 2. El docente agrega estudiantes (por correo) y consulta el panel
TEACHER=$(login profe@ejemplo.com 'clave-inicial-1')
curl -s -X POST $B/teacher/groups/$GID/students -H "Authorization: Bearer $TEACHER" -H 'content-type: application/json' \
  -d '{"email":"ana@example.com"}'
curl -s $B/teacher/dashboard -H "Authorization: Bearer $TEACHER" | jq
curl -s "$B/teacher/groups/$GID/dashboard/students?limit=20&search=ana" -H "Authorization: Bearer $TEACHER" | jq
curl -s "$B/teacher/groups/$GID/statistics?minAttempts=5&lowAccuracyBelow=50" -H "Authorization: Bearer $TEACHER" | jq

# 3. Retirar un docente (queda en el historial)
curl -s -X DELETE $B/admin/groups/$GID/teachers/$TID -H "Authorization: Bearer $ADMIN" -w '%{http_code}\n'
```

## 9. Consideraciones de seguridad

- Sin rutas públicas de privilegio: el registro solo crea estudiantes (`forbidNonWhitelisted` rechaza `role`); docentes solo por
  `POST /admin/teachers`; administradores solo por el script operativo.
- 404 uniforme para grupos/estudiantes fuera de alcance (sin enumeración). Los ids son UUIDv7; los mal formados dan 400.
- Respuestas con proyecciones explícitas (`PERSON_SELECT`): nunca `passwordHash`. Los correos de otros docentes no se exponen a
  docentes ni a estudiantes (solo `displayName`). Ninguna respuesta incluye `referenceSolution` ni `expectedResult`.
- Mínimo privilegio: `ADMIN` no usa `/teacher/*`; los docentes no cambian el estado de los grupos ni sus propias asignaciones.
- Auditoría: `createdById`, `addedById`, `removedById`, `assignedById`, `revokedById` y las fechas de alta/baja.
- Un docente puede agregar a **cualquier** estudiante por correo (para poder matricular). Esto le da acceso a sus datos de
  juego mientras sea miembro; ver "Limitaciones".

## 10. Limitaciones y decisiones pendientes

- **Consentimiento/invitación**: hoy el docente matricula directamente por id/correo (el enunciado lo exige). Un flujo de
  invitación o códigos de grupo evitaría que un docente enumere cuentas por correo (la respuesta 404/422/201 revela si existe).
- **Cambio de contraseña**: no existe; el docente conserva la contraseña inicial fijada por el administrador. Sin
  recuperación de cuenta, límite de peticiones en login ni revocación de tokens (preexistente).
- **Orden**: las listas de estudiantes se ordenan por nombre; no hay ordenación por métricas (precisión, puntos). `studentsNeedingAttention` cubre el caso principal.
- **Alta masiva** de estudiantes (CSV) y fusión/duplicado de grupos no implementados. Un solo estudiante por petición.
- **Dashboard de administrador**: el administrador no consume `/teacher/*`.
- **Concurrencia**: los duplicados concurrentes los resuelve el índice único parcial (→ 409); PGlite (tests) comparte una sola
  sesión, por lo que esa carrera se prueba de forma secuencial a nivel de BD. Conviene un smoke test contra PostgreSQL real.
- Un `create` de Prisma con `include` que falla por violación única desincroniza PGlite; por eso las altas de
  asignaciones/membresías crean sin `include` (no afecta a PostgreSQL real).
