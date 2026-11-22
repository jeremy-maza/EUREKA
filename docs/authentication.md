# Autenticación, sesiones y gestión de cuentas

Este documento describe la API de cuentas, las decisiones de seguridad y sus límites. El frontend principal (`frontend/`)
ya implementa registro, acceso y cierre de sesión; **no** hay pantallas de recuperación ni de cambio de contraseña (solo la API). Referencia rápida de rutas: [api.md](./api.md). Swagger: `/api/docs`.

## 1. Arquitectura

```
POST /auth/login ──▶ ThrottleService.charge ──▶ verifica scrypt ──▶ AuthSessionsService.issue ──▶ JWT (jti = sesión)
                      (IP · correo · IP+correo)                       (fila auth_sessions)
Cualquier petición ──▶ JwtAuthGuard ──▶ TokenService.verify (firma HS256, exp, jti)
                                   └──▶ AuthSessionsService.authenticate (sesión vigente, del mismo usuario)
                                   └──▶ RolesGuard
```

| Pieza                                  | Responsabilidad                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `TokenService` (sin cambios de diseño) | JWT HS256 con `node:crypto`. Ahora **exige** el claim `jti` y devuelve `issuedAt`/`expiresAt` al emitir. |
| `AuthSessionsService`                  | Crea, autentica, lista y revoca sesiones (`auth_sessions`).                                              |
| `JwtAuthGuard` (global)                | Firma/caducidad del JWT **y** sesión vigente. Sigue denegando por defecto; `@Public()` no cambia.        |
| `PasswordPolicy`                       | Política de contraseñas (registro, aprovisionamiento de docentes, cambio y recuperación).                |
| `PasswordService`                      | Cambio de contraseña y recuperación (solicitud + restablecimiento).                                      |
| `ThrottleService` + `throttle-state`   | Limitador de intentos persistente en PostgreSQL (lógica pura aparte, probada con reloj controlado).      |
| `Mailer` (`modules/mail`)              | Puerto de correo independiente del proveedor, con transportes `disabled` y `console` (solo desarrollo).  |
| `AuthMaintenanceService`               | Purga opcional de registros caducados (también `npm run auth:cleanup`).                                  |

Se conserva el `TokenService` propio (HS256) y el `PasswordHasher` (`scrypt`); no se añadió ninguna dependencia
(tampoco `@nestjs/throttler`: ver [§7](#7-limitación-de-intentos-de-login)).

## 2. Sesiones y revocación de JWT

Cada login crea una fila `AuthSession`; su `id` (UUID aleatorio) es el claim `jti` del token. **El JWT nunca se guarda**
(ni su hash): la tabla no tiene dónde ponerlo.

| Campo                            | Significado                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                             | `jti` del JWT. Se muestra solo a su propietario.                                                                   |
| `createdAt` / `expiresAt`        | `iat` y `exp` exactos del token (`expiresAt > createdAt` por CHECK).                                               |
| `revokedAt` / `revocationReason` | Se fijan juntos (CHECK). Motivos: `LOGOUT`, `LOGOUT_ALL`, `SESSION_REVOKED`, `PASSWORD_CHANGED`, `PASSWORD_RESET`. |
| `ipAddress`, `userAgent`         | Solo para que el usuario reconozca sus sesiones. User-Agent saneado y truncado a 200 caracteres.                   |

Una petición se autentica solo si **todo** se cumple: firma y algoritmo válidos, `exp` futuro, `jti` presente, la sesión
existe, pertenece al `sub` del token, no está revocada y `expiresAt` es futuro. Cualquier otro caso es `401` con el mismo
mensaje (`Sesión no válida o revocada.`): no se distingue «desconocida» de «revocada» de «caducada». El rol se sigue
leyendo de la BD en cada petición (como antes).

**Ciclo de vida:** `login` → activa → (`logout` | `DELETE /auth/sessions/:id` | `logout-all` | cambio/recuperación de
contraseña) → revocada · o caduca sola (`JWT_EXPIRES_IN_SECONDS`, 1 h por defecto). Una sesión revocada **no se borra**:
queda como historial hasta que la purga la elimine (§9).

**Qué se revoca, y cuándo**

| Acción                             | Efecto                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `POST /auth/logout`                | Revoca la sesión del token usado. Reutilizar ese token → `401`.                   |
| `DELETE /auth/sessions/:sessionId` | Revoca una sesión **propia** (idempotente). Ajena o inexistente → `404` uniforme. |
| `POST /auth/logout-all`            | Revoca todas las sesiones vigentes del usuario, incluida la actual.               |
| `POST /auth/change-password`       | Revoca todas, incluida la actual. Hay que volver a iniciar sesión.                |
| `POST /auth/password/reset`        | Revoca todas. No inicia sesión.                                                   |
| `POST /auth/password/forgot`       | **No** revoca nada (cualquiera podría pedirla para la cuenta de otro).            |
| Borrar al usuario                  | Las sesiones caen en cascada → sus tokens dejan de valer.                         |

**Privacidad entre usuarios.** Los endpoints de sesiones no aceptan ningún `userId`: cada usuario ve y revoca **solo las
suyas**. Un administrador tampoco puede listar ni revocar sesiones ajenas (hay pruebas que lo verifican). No existe aún una
«expulsión forzada» administrativa: sería un requisito explícito a definir (ver §11).

**Cambio documentado (seguridad):** los JWT emitidos antes de esta versión no llevan `jti` y **dejan de ser válidos**; los
usuarios deben iniciar sesión otra vez. No se pierde ningún dato.

**Carrera login ↔ cambio de contraseña.** Un login que verificó la contraseña antigua justo antes de un cambio no puede
emitir una sesión después de la revocación masiva: la sesión se inserta bajo `SELECT … FOR SHARE` de la fila del usuario y
solo si su `passwordHash` sigue siendo el verificado. (Probado de forma lógica; ver limitaciones sobre concurrencia real.)

## 3. Política de contraseñas

Misma política para registro, `POST /admin/teachers`, cambio y recuperación:

- Longitud mínima configurable: `PASSWORD_MIN_LENGTH` (por defecto **8**, rango 8–64; recomendado **12** en producción).
  Máxima fija: **128** (rechaza entradas desmesuradas antes de gastar `scrypt`). La contraseña no se recorta ni transforma.
- **Sin reglas de composición** (mayúsculas, símbolos…), que empujan a patrones previsibles (NIST SP 800-63B).
- Se rechazan: contraseñas de un solo carácter repetido o en blanco, una lista **mínima** de contraseñas muy comunes
  (`common-passwords.ts`), y la contraseña igual al correo o a su parte local.
- Cambio de contraseña: la nueva debe ser distinta de la actual.
- El hash sigue siendo `scrypt` con sal aleatoria de 16 bytes (formato `scrypt$N$r$p$sal$hash`, parámetros incluidos en el hash).
  `verify` ahora devuelve `false` (no lanza) ante hashes corruptos con parámetros inválidos.
- Los errores de política son `400` con la lista de mensajes; **no** se usan en el login (que solo responde «Credenciales
  inválidas») y nunca incluyen la contraseña. Ninguna contraseña, hash ni token se escribe en los registros (verificado por pruebas).

## 4. Cambio de contraseña — `POST /auth/change-password`

Autenticado (estudiante, docente o administrador). Cuerpo `{ currentPassword, newPassword }`.

1. Cuenta el intento en el limitador `PASSWORD_CHANGE_USER` (por usuario): un token robado no sirve para adivinar la
   contraseña actual (5 fallos → `429` con `Retry-After`). Un cambio correcto limpia el contador.
2. Verifica la contraseña actual (`403` si es incorrecta; sin cambios ni revocaciones).
3. Aplica la política y rechaza una nueva igual a la actual (`400`).
4. Hashea fuera de la transacción y, **en una sola transacción**: actualiza el hash (condicionado al hash anterior: si otro
   cambio se coló, `409`), revoca todas las sesiones (`PASSWORD_CHANGED`) e invalida los enlaces de recuperación pendientes.

Respuesta `200 { message }`. El token usado queda revocado: hay que volver a llamar a `POST /auth/login`.

**Docentes aprovisionados por un administrador.** `POST /admin/teachers` fija una contraseña **temporal** (sujeta a la
política). El docente inicia sesión con ella y llama a `POST /auth/change-password` para establecer la suya; desde ese
momento el administrador ya no puede entrar con la temporal. Si la pierde, usa la recuperación por correo. No hay un
indicador «debe cambiar la contraseña» que obligue al cambio (decisión pendiente, §11).

## 5. Recuperación de contraseña

### Solicitud — `POST /auth/password/forgot` `{ email }`

- Responde **siempre** `202` con el mismo cuerpo exista o no la cuenta. No genera ni envía nada si no existe.
- El token son 256 bits de CSPRNG (`randomBytes(32)`, base64url). En la BD se guarda **solo su SHA-256**
  (`password_reset_tokens.tokenHash`, único); el token en claro solo existe en el correo.
- Caduca a los `PASSWORD_RESET_TTL_MINUTES` (30). Un solo uso.
- **Un único token pendiente por usuario**: un token nuevo invalida el anterior (`invalidatedAt`), y un índice único
  parcial en la BD lo garantiza aunque lleguen solicitudes simultáneas (las solicitudes de un mismo usuario se serializan con
  `SELECT … FOR NO KEY UPDATE`).
- **Espera mínima** `PASSWORD_RESET_COOLDOWN_SECONDS` (60): si ya hay un token vigente creado hace menos, no se envía otro
  (anti _mail-bombing_ por cuenta). Además hay un límite por IP (`PASSWORD_RESET_MAX_REQUESTS_PER_IP`, 10/hora → `429`),
  independiente de que las cuentas existan.
- El correo se entrega **en segundo plano**: un fallo del proveedor no cambia la respuesta ni se filtra. Los errores se
  registran sin el mensaje ni el destinatario.
- El enlace es `PASSWORD_RESET_URL#token=<token>` (por defecto `<CORS_ORIGIN>/reset-password`). Va en el **fragmento** para
  que no llegue a registros de servidores web ni a `Referer`. El frontend debe leerlo de `location.hash`.

### Restablecimiento — `POST /auth/password/reset` `{ token, newPassword }`

1. Hashea el token y lo busca. Si no existe, está caducado, usado o invalidado: `400` con **un único mensaje**
   («El enlace de recuperación no es válido o ha caducado.»). Esta comprobación barata va **antes** de `scrypt`, de modo que
   un token inservible no cuesta CPU.
2. Aplica la política a la nueva contraseña (`400`; el token **no** se consume y puede reintentarse).
3. Hashea y, en **una sola transacción**: reclama el token con `UPDATE … WHERE id=… AND consumedAt IS NULL AND
invalidatedAt IS NULL AND expiresAt > ahora` (si no afecta exactamente 1 fila → `400`), actualiza la contraseña y revoca
   todas las sesiones (`PASSWORD_RESET`). Si algo falla, todo se revierte, incluido el consumo del token.
4. Limpia los contadores de login del correo (y del par IP+correo de quien restablece): quien demuestra control del correo no
   queda bloqueado por sus propios intentos.

Dos envíos simultáneos del mismo token: exactamente uno prospera (el otro recibe `400`). Respuesta `200 { message }`; **no**
devuelve token de acceso.

## 6. Correo electrónico

El proyecto **no tenía** integración de correo, así que se creó un puerto independiente del proveedor:

```ts
abstract class Mailer {
  abstract send(message: { to; subject; text }): Promise<void>;
}
```

| `MAIL_TRANSPORT`     | Comportamiento                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `disabled` (defecto) | No entrega nada. Registra un aviso **sin destinatario ni cuerpo**. Válido en producción, pero los usuarios no recibirán el enlace. |
| `console`            | **Solo desarrollo.** Imprime el correo completo (con el token) en la consola. El arranque falla si `NODE_ENV=production`.          |

**Limitación actual:** no hay ningún proveedor real configurado (no se inventaron credenciales SMTP ni de terceros). La
abstracción, el transporte de desarrollo y todo el flujo están implementados y probados con un `Mailer` de pruebas; la
entrega real queda pendiente de elegir proveedor.

Los tokens **nunca** se devuelven en la API ni se escriben en los registros (salvo en la consola del transporte `console`).

### Configurar un proveedor de correo en producción

1. Crea `modules/mail/<proveedor>.mailer.ts` con una clase `extends Mailer`. `send` debe lanzar/rechazar si el proveedor
   falla y **no** debe registrar `message.text` (contiene el token) ni el destinatario.
2. Añade un `case '<proveedor>'` en `createMailer` (`mail.module.ts`) y el valor a `@IsIn([...])` de `MAIL_TRANSPORT`
   en `config/env.validation.ts`. Lee sus secretos de variables de entorno propias (p. ej. `<PROVEEDOR>_API_KEY`), nunca del repositorio.
3. Define `MAIL_TRANSPORT=<proveedor>` y `PASSWORD_RESET_URL=https://tu-frontend/reset-password`. Configura SPF/DKIM/DMARC
   del dominio remitente en el proveedor.
4. Añade pruebas del adaptador con el proveedor simulado y comprueba que un fallo no filtra el token.

## 7. Limitación de intentos de login

`POST /auth/login` cuenta cada intento en **tres contadores** persistentes (`auth_throttles`): por **IP**, por **correo
normalizado** (cualquier IP) y por **par IP+correo**.

| Ámbito (defecto)             | Qué frena                                                      |
| ---------------------------- | -------------------------------------------------------------- |
| IP + correo — **5** / 15 min | Adivinar la contraseña de una cuenta desde un mismo origen.    |
| Correo — **20** / 15 min     | Ataque distribuido (muchas IPs) contra una cuenta.             |
| IP — **100** / 15 min        | «Rociado» de contraseñas entre muchas cuentas desde un origen. |

- **Bloqueo temporal progresivo**: al superar el umbral, `429` durante `LOGIN_LOCK_BASE_SECONDS` (60 s), que se **duplica**
  en cada bloqueo consecutivo hasta `LOGIN_LOCK_MAX_SECONDS` (900 s). El nivel se olvida tras una ventana completa de calma.
  **Nunca es permanente**: todo bloqueo expira solo, así que no sirve para negar el servicio indefinidamente a otro usuario.
- **El bloqueo por IP+correo no deja fuera al dueño** que entra desde otra IP (su par no está bloqueado).
- **Respuesta uniforme**: el correo se normaliza (minúsculas, sin espacios) y se limita exista o no la cuenta. Cuenta
  existente e inexistente dan la misma secuencia de `401` y luego `429` (verificado por pruebas), con el mismo coste (hash ficticio).
  El `429` lleva un mensaje genérico y `Retry-After` en segundos; no se exponen contadores, intentos restantes ni qué límite saltó.
- **Éxito**: se borra el contador del par y se devuelve el intento a los contadores por IP y por correo. El de correo **no**
  se pone a cero (un atacante distribuido no debe recuperar su presupuesto porque el dueño entre).
- **Concurrencia**: el intento se cuenta **antes** de verificar la contraseña, bajo `SELECT … FOR UPDATE` en una
  transacción, con las filas bloqueadas siempre en el mismo orden (sin interbloqueos). N peticiones simultáneas no pueden
  sobrepasar el límite (probado: 12 simultáneas → exactamente 5 verifican y 7 reciben `429`). Mientras algún ámbito esté
  bloqueado, la petición se rechaza **sin contar** en los demás (un atacante bloqueado no agota los contadores de la víctima).
- **IPv6**: se limita por prefijo `/64`; IPv4 mapeada en IPv6 se normaliza.
- No se guardan correos en claro (clave = SHA-256 del correo normalizado).
- El mismo motor protege `change-password` (por usuario) y `password/forgot` (por IP).

**Por qué no `@nestjs/throttler` ni Redis.** El almacén por defecto de `@nestjs/throttler` es en memoria (no compartido
entre instancias ni persistente), no limita por correo con bloqueo progresivo y no ofrece un contador atómico «cuenta antes,
devuelve en caso de éxito». Con PostgreSQL ya presente, `SELECT … FOR UPDATE` da atomicidad y persistencia sin infraestructura
nueva. Coste: ~8 sentencias SQL por login; si el volumen lo exigiera, el contador puede migrarse a Redis tras la misma interfaz.

### IP del cliente y proxies (`TRUST_PROXY`)

La IP sale de `request.ip` de Express; **jamás** se lee `X-Forwarded-For` a mano.

- Sin proxy: deja `TRUST_PROXY` sin definir (`false`). Cualquier `X-Forwarded-For` se **ignora** (probado).
- Detrás de **un** proxy inverso que añade la IP real: `TRUST_PROXY=1`. Asegúrate de que el proxy sobrescribe/añade la cabecera.
- ⚠️ Detrás de un proxy **sin** `TRUST_PROXY`, todos los clientes comparten la IP del proxy y el límite por IP bloquearía a todos.
  Con `TRUST_PROXY=true` (confiar en todo) un cliente puede falsificar su IP: evítalo.

### Valores recomendados en producción

Los valores por defecto ya son los recomendados. Ajustes habituales:

| Variable                      | Defecto | Cuándo cambiarla                                                                                           |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `LOGIN_MAX_ATTEMPTS_IP`       | 100     | **Aulas/colegios con una sola IP pública (NAT):** subir (p. ej. 300–500) para no bloquear a toda la clase. |
| `LOGIN_MAX_ATTEMPTS_IP_EMAIL` | 5       | Subir a 8–10 para usuarios jóvenes que se equivocan a menudo.                                              |
| `LOGIN_MAX_ATTEMPTS_EMAIL`    | 20      | Bajarlo endurece contra ataques distribuidos pero facilita bloquear temporalmente a una víctima.           |
| `LOGIN_LOCK_MAX_SECONDS`      | 900     | Tope del bloqueo; mayor = más protección y más molestia/riesgo de negación de servicio temporal.           |
| `PASSWORD_MIN_LENGTH`         | 8       | Recomendado **12** en producción.                                                                          |

## 8. Endpoints nuevos

| Método | Ruta                        | Auth   | Códigos                      | Notas                                                |
| ------ | --------------------------- | ------ | ---------------------------- | ---------------------------------------------------- |
| POST   | `/auth/login`               | —      | 200, 400, 401, **429**       | Ahora crea una sesión y limita intentos              |
| POST   | `/auth/change-password`     | Bearer | 200, 400, 401, 403, 409, 429 | Revoca todas las sesiones                            |
| POST   | `/auth/password/forgot`     | —      | 202, 400, 429                | Respuesta genérica                                   |
| POST   | `/auth/password/reset`      | —      | 200, 400                     | Un solo uso; revoca todas las sesiones               |
| GET    | `/auth/sessions`            | Bearer | 200, 400, 401                | `?status=ACTIVE\|ALL&limit&cursor`; solo las propias |
| DELETE | `/auth/sessions/:sessionId` | Bearer | 204, 400, 401, 404           | Idempotente; ajena → 404                             |
| POST   | `/auth/logout`              | Bearer | 204, 401                     | Revoca la sesión actual                              |
| POST   | `/auth/logout-all`          | Bearer | 200, 401                     | `{ revokedSessions }`                                |

Errores con el formato habitual `{ statusCode, error, message, path, timestamp }`. Los `429` añaden `Retry-After`.

## 9. Base de datos y mantenimiento

Migración `20261121200000_auth_sessions_and_recovery` (**aditiva**: no toca filas ni columnas existentes):

- `auth_sessions` (FK a `users` con `ON DELETE CASCADE`; índices `(userId, createdAt DESC)` y `expiresAt`; CHECKs de
  revocación coherente y de caducidad posterior a la creación).
- `password_reset_tokens` (`tokenHash` único; índices por `userId` y `expiresAt`; CHECK de resultado único; **índice único
  parcial** «un token pendiente por usuario»).
- `auth_throttles` (clave `(scope, key)`; índice por `lastAttemptAt`; CHECK de no negativos).

Verificada sobre una base limpia (cada ejecución de integración aplica todas las migraciones) y sobre una base **con datos**
(`auth-migration.int-spec.ts` aplica las anteriores, inserta usuarios/grupos/membresías/asignaciones, aplica esta y comprueba
que no se pierde nada). En una base real: `npm run db:migrate:deploy -w apps/api`. No resetees la base.

**Purga.** Solo se borra lo caducado hace más de `AUTH_RETENTION_DAYS` (30): el historial reciente de sesiones (incluidas las
revocadas) y recuperaciones se conserva; nunca se tocan sesiones vigentes ni tokens pendientes; los contadores se purgan a las
24 h de inactividad salvo que sigan bloqueados. Opciones: la API purga cada `AUTH_CLEANUP_INTERVAL_MINUTES` (360; 0 la
desactiva; nunca corre en tests) o ejecuta `npm run auth:cleanup` desde un cron. Es idempotente y segura con varias instancias.

## 10. Variables de entorno

Todas opcionales (valores por defecto entre paréntesis). Se validan al arrancar. Ver también [`.env.example`](../.env.example).

| Variable                                | Defecto                        | Descripción                                                                   |
| --------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `JWT_SECRET` / `JWT_EXPIRES_IN_SECONDS` | — / 3600                       | Ya existentes. La validez del token es también la de la sesión.               |
| `TRUST_PROXY`                           | `false`                        | Saltos de proxy (`1`), `loopback`, CIDR… Determina la IP del cliente.         |
| `PASSWORD_MIN_LENGTH`                   | 8 (8–64)                       | Longitud mínima de contraseña.                                                |
| `LOGIN_MAX_ATTEMPTS_IP_EMAIL`           | 5                              | Intentos por IP+correo por ventana.                                           |
| `LOGIN_MAX_ATTEMPTS_EMAIL`              | 20                             | Intentos por correo (todas las IPs).                                          |
| `LOGIN_MAX_ATTEMPTS_IP`                 | 100                            | Intentos por IP (todas las cuentas).                                          |
| `LOGIN_WINDOW_SECONDS`                  | 900                            | Duración de la ventana.                                                       |
| `LOGIN_LOCK_BASE_SECONDS`               | 60                             | Primer bloqueo (se duplica en cada reincidencia).                             |
| `LOGIN_LOCK_MAX_SECONDS`                | 900                            | Tope del bloqueo (≥ base).                                                    |
| `PASSWORD_CHANGE_MAX_ATTEMPTS`          | 5                              | Fallos con la contraseña actual antes de bloquear (misma ventana y bloqueos). |
| `PASSWORD_RESET_TTL_MINUTES`            | 30                             | Validez del enlace de recuperación.                                           |
| `PASSWORD_RESET_COOLDOWN_SECONDS`       | 60                             | Espera mínima entre correos de recuperación de una cuenta.                    |
| `PASSWORD_RESET_MAX_REQUESTS_PER_IP`    | 10                             | Solicitudes de recuperación por IP y hora.                                    |
| `PASSWORD_RESET_URL`                    | `<CORS_ORIGIN>/reset-password` | URL del frontend a la que se añade `#token=…`.                                |
| `MAIL_TRANSPORT`                        | `disabled`                     | `disabled` \| `console` (solo desarrollo; prohibido en producción).           |
| `AUTH_RETENTION_DAYS`                   | 30                             | Días que se conserva lo caducado antes de purgarlo.                           |
| `AUTH_CLEANUP_INTERVAL_MINUTES`         | 360                            | Purga periódica en proceso (0 = desactivada).                                 |

## 11. Revisión de seguridad y limitaciones conocidas

Amenazas revisadas y cómo se cubren. Las filas marcadas con _(diseño)_ se apoyan en el razonamiento y en pruebas indirectas, no en una prueba específica de la propiedad; el resto tiene prueba automática:

| Amenaza                                               | Mitigación                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enumeración de cuentas                                | `forgot` genérico; `login` mismo `401`/`429` exista o no; límites por correo sin depender de la existencia.                                                                                                                                                                         |
| Fuerza bruta de login                                 | Tres ámbitos, bloqueo progresivo, conteo previo atómico bajo concurrencia.                                                                                                                                                                                                          |
| Fuerza bruta con token robado                         | `change-password` limita los intentos de contraseña actual.                                                                                                                                                                                                                         |
| Fuga del token de recuperación                        | 256 bits; solo SHA-256 en BD; nunca en la API ni en los registros; en el fragmento de la URL; mensaje de error único.                                                                                                                                                               |
| Reutilización / carrera de tokens                     | Reclamo atómico `UPDATE … WHERE consumedAt IS NULL AND expiresAt > ahora`, en la misma transacción que la contraseña y la revocación.                                                                                                                                               |
| Repetición de JWT revocados                           | El guard exige sesión vigente en cada petición.                                                                                                                                                                                                                                     |
| Fijación de sesión _(diseño)_                         | No existen sesiones preexistentes que adoptar: cada login crea un `jti` nuevo aleatorio, emitido por el servidor.                                                                                                                                                                   |
| Contraseña/sesiones inconsistentes _(diseño parcial)_ | Cambio de hash + revocación + invalidación en una transacción; hash condicionado al anterior; `FOR SHARE` frente a logins en vuelo (la condición del hash está probada; la atomicidad bajo fallo a mitad de transacción descansa en `$transaction`, sin prueba de fallo inyectado). |
| Revocación no autorizada                              | Rutas sin `userId`; consultas siempre filtradas por el usuario autenticado; ajeno ⇒ `404`, también para administradores.                                                                                                                                                            |
| Fuga por errores o registros                          | Mensajes genéricos, sin contraseñas, hashes ni tokens en registros (prueba que captura stdout/stderr).                                                                                                                                                                              |
| Falsificación de IP                                   | `TRUST_PROXY` explícito; `X-Forwarded-For` ignorado por defecto (probado).                                                                                                                                                                                                          |

**Limitaciones y decisiones pendientes** (no se afirma ninguna garantía más allá de lo probado):

1. **Concurrencia real.** Las pruebas usan PGlite con una sola conexión: las peticiones «simultáneas» se serializan y la
   lógica de bloqueos (`FOR UPDATE`, `FOR SHARE`, reclamo atómico, índice parcial) se ejerce pero **no** con paralelismo real
   entre conexiones. Antes de producción conviene un smoke test de carga contra PostgreSQL real (Docker).
2. **Correo real.** No hay proveedor configurado (§6). Con `MAIL_TRANSPORT=disabled` la recuperación no entrega nada.
3. **Enumeración por tiempo.** `forgot` hace trabajo de BD solo si la cuenta existe; la entrega de correo va en segundo
   plano, pero la diferencia de unos milisegundos en la respuesta no se ha eliminado ni medido.
4. **Registro (`POST /auth/register`)** responde `409` si el correo existe (comportamiento previo) y no tiene límite de
   peticiones: es un vector de enumeración y de abuso fuera de este alcance. Cambiarlo rompería el contrato actual.
5. **Intentos en vuelo.** Al contarse antes de verificar, más de 5 logins _simultáneos_ del mismo correo desde la misma IP
   pueden recibir `429` aunque la contraseña sea correcta (los intentos se devuelven al terminar). No afecta a uso normal.
6. **Denegación de servicio temporal por correo.** Un atacante con 20 intentos por ventana puede bloquear un correo hasta
   15 min (el dueño sigue entrando desde otra IP mientras no haya superado su par). Es el coste de limitar ataques distribuidos;
   es temporal y configurable.
7. **`scrypt`.** Se conservan `N=2^15, r=8, p=1`. La guía actual de OWASP lista configuraciones más costosas (p. ej. `N=2^17`);
   subirlas exige dimensionar memoria (≈128 MiB por hash concurrente). El formato ya permite subir parámetros; falta añadir el
   _re-hash_ al iniciar sesión. Pendiente de decidir con datos de carga reales.
8. **Política de contraseñas.** La lista de contraseñas comunes es pequeña; no se consulta ningún corpus de filtraciones.
9. **Tokens de acceso de 1 h, sin _refresh_.** Un token filtrado es válido hasta que se revoque o caduque. No hay MFA, ni
   correo de aviso al cambiar la contraseña, ni «último uso» por sesión.
10. **Docentes aprovisionados:** no existe el indicador «debe cambiar la contraseña»; la temporal sigue siendo válida hasta
    que el docente la cambie. **Expulsión administrativa** de sesiones ajenas: no implementada a propósito (sería un
    requisito explícito).
11. **Reloj.** Con varias instancias, ventanas de bloqueo y caducidad dependen de que sus relojes estén sincronizados (NTP).
12. **Datos personales.** Las sesiones guardan IP y User-Agent (para que el usuario reconozca dispositivos); se conservan
    hasta `AUTH_RETENTION_DAYS` tras caducar.
13. **Tokens anteriores** a esta versión (sin `jti`) dejan de valer: los usuarios deben volver a iniciar sesión.
