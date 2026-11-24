# EUREKA — Auditoría integral de producto, arquitectura, matemáticas y educación (Mundos 1–5)

> Auditoría independiente de **solo lectura**. Fecha: 2026-11-23. Rama `dlomito-002/eureka-orchestrator-development`,
> HEAD `4a48662`. Único archivo creado en el proyecto: este informe. No se modificó código, migraciones, semillas, pruebas,
> configuración ni documentación.
>
> **Ampliación:** cuando Docker estuvo disponible se añadió la verificación contra **PostgreSQL 17.12 real** con el pool de
> producción (10 conexiones). Cubre migraciones, deriva del esquema, la suite de integración completa, carreras de
> concurrencia, carga, ráfagas e invariantes (Anexo VII). Así se levantó la principal limitación de la primera versión.

---

## Cómo leer este informe

Cada afirmación lleva su **tipo de evidencia**:

| Etiqueta          | Significado                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VIVO**          | Comprobado en ejecución real: API compilada + PostgreSQL (PGlite) + frontend Vite, jugando en un navegador real (navegador integrado de Orca) o por HTTP. |
| **PG-REAL**       | Ejecutado contra PostgreSQL 17.12 real (contenedor desechable) con la API compilada y el pool por defecto de producción (10 conexiones).                  |
| **MEDIDO**        | Resultado de ejecutar el código real del proyecto (planificador, motor, política) sobre lotes grandes.                                                    |
| **SIMULADO**      | Jugadores **sintéticos** con supuestos explícitos contra la política real. **No son datos de estudiantes.**                                               |
| **COBERTURA**     | Lo cubren las pruebas automáticas existentes (y pasan).                                                                                                   |
| **INSPECCIONADO** | Lectura de código.                                                                                                                                        |
| **TEÓRICO**       | Razonamiento (pedagógico, de concurrencia, de despliegue) sin ejecución que lo confirme.                                                                  |

Severidades: **CRÍTICA**, **ALTA**, **MEDIA**, **BAJA** y **DECISIÓN DE PRODUCTO** (requiere criterio de producto, no
una corrección técnica). Los niveles de dificultad se nombran como en la interfaz: **Suave / Normal / Intensa**
(`EASIER / BASELINE / HARDER` en el código).

---

## A. Resumen ejecutivo

**Eureka está bien construido por dentro y mal protegido por fuera.**

- **El núcleo técnico y matemático es sólido.**
  - La aritmética es exacta (racionales con `BigInt`).
  - Se reverificaron **1 320 000 retos de 300 000 secuencias** con una implementación independiente: **0 errores**. Cada enunciado tiene respuesta única, cada solución de referencia cumple sus reglas y todas las ordenaciones de reglas son planificables (MEDIDO).
  - No hay doble puntuación ni pérdida de puntos. No hay IDOR ni fuga de soluciones. La idempotencia funciona y los tiempos los fija el servidor (VIVO y COBERTURA).
  - Todas las suites pasan: 685 pruebas unitarias y 247 de integración en la API, 146 en la web. Typecheck, lint y build, en verde.
  - **En PostgreSQL 17 real con pool 10 (PG-REAL):**
    - las 5 migraciones se despliegan y no hay deriva con el esquema;
    - las 247 pruebas de integración también pasan;
    - 800 peticiones simultáneas del mismo alumno (carreras de sesión, reto, respuesta y mezclas) dan 0 errores 5xx y 0 duplicados;
    - 60 alumnos jugando a la vez y una ráfaga de 600 peticiones dan 0 errores;
    - los 14 invariantes de datos se cumplen;
    - no hay interbloqueos.
- **El diseño del juego tiene agujeros que vacían su propósito educativo y su equidad:**
  1. **Una errata termina la secuencia entera,** y la notación escolar española (`·`, `x`, `:`) se trata como errata (VIVO). La propia interfaz muestra `×`, lo que invita a teclear la letra x.
  2. **La regla «Debes usar la multiplicación 7 * 1» rechaza `3 * 7 * 1`** con un mensaje que contradice lo que el alumno ve (VIVO).
  3. **La dificultad adaptativa no ayuda a quien se atasca.** El estudiante honesto que falla en el reto 2 casi nunca llega a Suave, porque el reto 1 (copiable) le mantiene la precisión en el 50 %. Quien falla a propósito tres veces el reto 1 sí llega, y desbloquea el mundo siguiente con 2 reglas (VIVO: una cuenta nueva desbloqueó el Mundo 2 en unos minutos sin hacer ninguna operación).
  4. **El reto 1 (sin reglas) acepta copiar el enunciado** y cada acierto vale lo mismo sea cual sea la dificultad. Desde la interfaz se ganan unos 100 puntos por ciclo de pocos segundos (copiar + fallar), y por API se obtuvieron 2 500 puntos en 0,8 s (VIVO). La clasificación del grupo queda a merced de quien lo descubra.
  5. **Las reglas «exigidas» se cumplen con relleno neutro** (`× 1`, `/ 1`, `− 0`, `+ (2 − 2) ^ 2`…; MEDIDO):
     - Entre el 27 % y el 41 % de los retos con reglas de los Mundos 1–3 se superan envolviendo el enunciado tal cual, **sin calcular nada**.
     - Con un sufijo fijo por mundo que vale 0, se supera el **100 %** de los retos calculando solo el resultado.
     - La interpretación «`n / 1` cuenta como división» es solo un caso de este patrón.

     El diseño declara como filosofía «cumplir la letra de la regla», así que esto se clasifica como **decisión de producto de alto impacto**, no como defecto.
- **Riesgos operativos del piloto:**
  - No hay forma de recuperar una contraseña olvidada: en producción no se envía correo y no hay restablecimiento por docente ni administrador.
  - Con la configuración por defecto, el limitador de inicio de sesión por IP puede bloquear a clases enteras.
  - Faltan procedimientos para los datos de menores.
  - Una caché de mundos que nunca caduca solo da problemas si se habilitan o deshabilitan mundos en caliente.
  - Un byte NUL en la respuesta provoca un error 500 (VIVO), sin corrupción de datos.
- **Pedagogía.** El Mundo 5 («Caos») acumula reglas y familias de retos, pero no las sintetiza: ningún enunciado combina conceptos. El fallo no enseña: nunca se muestra una solución ni el valor correcto. La mecánica no se explica antes de que corra el cronómetro.

**Veredicto: LISTO TRAS CORRECCIONES** (ver §H), para un **piloto controlado y acotado**: 1–2 clases, docente presente,
operador disponible, versión congelada y los 5 mundos habilitados.

- No hay hallazgos críticos.
- Las correcciones de código imprescindibles son pocas y locales: notación y erratas, la regla `7 * 1`, la recuperación de contraseñas y excluir el reto 1 de la dificultad.
- Hay que configurar el despliegue y tomar varias **decisiones de producto antes** del piloto. Sin ellas, el piloto mediría sobre todo la capacidad de encontrar atajos, no el aprendizaje.

---

## B. Evaluación global

| Dimensión                       | Valoración                           | Resumen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arquitectura técnica**        | **Buena**                            | Secuencias persistidas y auditables. Bloqueo por fila de progreso (`FOR UPDATE`) en toda transición. Libro de puntos de solo inserción con trigger. Triple barrera de idempotencia. Migración aditiva coherente con el esquema. **Concurrencia verificada en PostgreSQL 17 real con pool 10** (Anexo VII). Lunares: caché de mundos sin invalidación (EUR-06, solo si se tocan mundos en caliente), `Promise.all` dentro de transacciones (deprecado en `pg@9`), 500 ante entradas raras (sin corrupción).                                                                                                        |
| **Corrección matemática**       | **Muy buena**                        | 0 errores en 1,32 M retos reverificados de forma independiente. Exactitud BigInt, potencias acotadas antes de calcular, división entre cero detectada en todas sus formas, ecuaciones con solución única. Los problemas están en la **semántica de las reglas** (EUR-01, EUR-05, EUR-07), no en la aritmética.                                                                                                                                                                                                                                                                                                    |
| **Diseño educativo**            | **Insuficiente**                     | Progresión de 5 mundos coherente en el papel, pero las reglas se pueden cumplir sin ejercitar el concepto del mundo (EUR-01). Caos acumula sin sintetizar (EUR-10). El fallo no enseña (EUR-08). El generador cubre los conceptos de forma desigual (EUR-16).                                                                                                                                                                                                                                                                                                                                                     |
| **Experiencia de juego**        | **Aceptable, con fricciones serias** | Interfaz cuidada: cronómetro del servidor, reanudación, aviso de «x =», diálogo de fallo claro. Pero una errata cuesta la secuencia (EUR-04), no hay explicación previa de la mecánica (EUR-09), la regla nueva se oculta en móviles de 320 px (EUR-11) y la sesión caduca a la hora (EUR-12).                                                                                                                                                                                                                                                                                                                    |
| **Dificultad y equidad**        | **Insuficiente**                     | Política adaptativa manipulable y que no ayuda a quien lo necesita (EUR-03). Puntos y clasificación que premian el volumen y el farmeo (EUR-02). Un fallo de regla (7 * 1) injusto en el mundo de principiantes (EUR-05).                                                                                                                                                                                                                                                                                                                                                                                         |
| **Preparación para producción** | **Parcial**                          | Integridad y seguridad básicas correctas. Faltan:<br>- recuperación de contraseñas (EUR-35);<br>- configuración segura por defecto del limitador de inicio de sesión (EUR-37);<br>- procedimientos para datos de menores (EUR-38);<br>- gestión de grupos sin interfaz (EUR-39);<br>- repetir la prueba de carga en la infraestructura real del piloto (red, proxy, BD gestionada); en un PostgreSQL 17 local ya está verificada (Anexo VII);<br>- límites de peticiones en el juego;<br>- operación de mundos en caliente;<br>- migración apta para despliegue en caliente (no afecta a un piloto con BD nueva). |

---

## C. Evaluación mundo por mundo

Datos comunes:

- **Tiempo límite** (INSPECCIONADO `timer-manager.ts:40-53`, MEDIDO): `60 s + 15 s × (reglas activas − 1) + extra del mundo`, con un mínimo de una regla. Por eso los retos 1 y 2 reciben el mismo tiempo.
- **Retos por secuencia:** número de reglas + 1 (el reto 1 no tiene reglas).

| Mundo (extra)       | R1  | R2  | R3  | R4  | R5  | R6  |
| ------------------- | --- | --- | --- | --- | --- | --- |
| 1 Aritmética (0 s)  | 60  | 60  | 75  | 90  | 105 | —   |
| 2 Signos (5 s)      | 65  | 65  | 80  | 95  | 110 | —   |
| 3 Fracciones (10 s) | 70  | 70  | 85  | 100 | 115 | —   |
| 4 Álgebra (20 s)    | 80  | 80  | 95  | 110 | 125 | —   |
| 5 Caos (25 s)       | 85  | 85  | 100 | 115 | 130 | 145 |

**Atajos sin calcular** (MEDIDO por el orquestador, `trivial-split.ts` / `trivial-seq.ts`): se envuelve el enunciado tal cual con `× 1`, `/ 1`, `− 0`, `+ 0` y combinaciones. Es una cota inferior: solo se probaron 10 envoltorios.

| Mundo | Retos con reglas superables sin calcular (S / N / I) | Secuencias completas superables sin calcular (S / N / I) |
| ----- | ---------------------------------------------------- | -------------------------------------------------------- |
| 1     | 40,8 % / 28,8 % / 26,8 %                             | **26,4 %** / 6,3 % / 1,0 %                               |
| 2     | 32,1 % / 23,5 % / 14,6 %                             | 16,5 % / 2,8 % / 0,1 %                                   |
| 3     | 32,8 % / 29,5 % / 20,3 %                             | 20,3 % / 6,3 % / 0,1 %                                   |
| 4     | 9,0 % / 5,1 % / 3,9 %                                | 0,9 % / 0 % / 0 %                                        |
| 5     | 12,8 % / 9,5 % / 7,4 %                               | 0,5 % / 0,1 % / 0 %                                      |

Si además se permite calcular el valor del enunciado y envolverlo, el agente educativo midió que un **sufijo fijo por mundo**
(por ejemplo `+ (-2 + 2) ^ 2 * 1.5` en Caos) supera el **100 %** de 126 000 retos (MEDIDO, ED-01).

### Mundo 1 — Aritmética

- **Objetivo:** las cuatro operaciones, la jerarquía de operaciones, descomponer números y los paréntesis.
- **Reglas** (6): dígitos 2 y 5 prohibidos, `7 * 1`, división, paréntesis que cambien el orden y al menos 4 números.
- **Lo que funciona:**
  - Los **dígitos prohibidos** obligan a descomponer de verdad (`42` sin el 2 → `6 * 7`), que es el núcleo del mundo.
  - Tiempos holgados para un alumno con soltura.
- **Lo que falla:**
  - La regla `7 * 1` rechaza `3 * 7 * 1` (EUR-05, VIVO).
  - División, mínimo de números y paréntesis se cumplen con relleno (`(…) / 1`, `+ 0 + 0`, `(… ) × 1`).
  - El 76 % de los enunciados en Suave son cadenas de productos: la jerarquía de operaciones no interviene.
  - El 26,4 % de las secuencias Suaves se completan sin calcular nada.
  - Sin tiempo extra, los retos finales de Normal e Intensa son los más justos para un alumno lento (HEURÍSTICO).
- **Valoración:** buena base, con un fallo de regla injusto y reglas «exigidas» vacías.

### Mundo 2 — Números y signos

- **Objetivo:** negativos, regla de los signos y restar como sumar el opuesto.
- **Lo que falla:**
  - **Ninguna regla obliga a razonar con signos.** `- (-1) * 0` cumple a la vez «negativo», «multiplicación» y «resta» (MEDIDO).
  - Solo el 32–36 % de los resultados son negativos.
  - Entre el 23 % y el 30 % de los enunciados son multiplicativos sin signo, es decir, contenido del Mundo 1.
  - El producto con signos solo aparece en el 10–24 % de los enunciados.
- **Valoración:** el mundo no garantiza que se practique su concepto central.

### Mundo 3 — Fracciones y decimales

- **Lo que funciona:**
  - Entre el 54 % y el 66 % de los resultados no son enteros.
  - Hay oportunidades reales de razonar: `1/6 + 5/9` con un decimal obligatorio se resuelve con `0.5 + 2/9`.
  - La coma decimal española (`0,5`) se acepta (VIVO).
- **Lo que falla:**
  - El sufijo `+ 0.1 / 1 - 0.1` anula esas oportunidades.
  - Ningún resultado es negativo.
  - Entre el 1 % y el 3 % de los retos dan resultados «feos», con denominador mayor que 100, incluso en Suave y en el reto 1 (`5/7 + 4/5 − 7/12 = 391/420`).
  - En Mundo 3, `1.000` vale 1 y no mil (MA-08).
- **Valoración:** el mundo con más contenido matemático real entre los de expresión, pero también se puede eludir.

### Mundo 4 — Álgebra

- **Lo que funciona:**
  - Entre el 72 % y el 82 % de los retos son ecuaciones. Una ecuación no se puede copiar: **es el único mundo que obliga a calcular** (resolver x).
  - La respuesta puede ser el propio despeje (`3x + 14 = 56` → `(56 − 14) / 3`), lo que es pedagógicamente valioso.
  - El aviso de «no escribas la x» funciona (VIVO).
- **Lo que falla:**
  - Las soluciones son siempre enteras, y nunca negativas en Suave ni en Normal.
  - Las potencias son decorativas en la respuesta (`+ (2 − 2) ^ 2`).
  - No hay ninguna ecuación con potencias.
- **Valoración:** el mundo más sólido pedagógicamente. Le falta variedad de soluciones.

### Mundo 5 — Caos matemático (revisión a fondo)

- **Diseño:**
  - 7 reglas; 3, 4 o 5 por secuencia.
  - Familias de enunciados: con signos, fraccionaria, decimal, potencia y ecuación (×2).
  - Sintaxis con decimales y potencias.
- **Resoluble y comprensible:**
  - Todas las combinaciones son satisfacibles (exhaustivo: 142 800 planes).
  - Las soluciones de referencia del reto final en Intensa miden de mediana 37 caracteres (p90 52, máximo 108) y usan 8 números de mediana (MEDIDO).
  - Se jugaron en vivo secuencias Normales e Intensas completas. Por ejemplo, `3 × (x + 10) − 12 = 12` con «al menos 4 números + decimal + máx. 12» se resuelve con `-2.5 + 0.5 + 0 + 0` en 1:54 (VIVO).
- **¿Culminación o acumulación? Acumulación.**
  - Cada enunciado pertenece a **una sola familia**: en 75 000 enunciados, 0 combinan potencia y decimal y 0 ecuaciones llevan potencias (MEDIDO, MA-09).
  - Las reglas son independientes entre sí y del valor.
  - El sufijo `+ (-2 + 2) ^ 2 * 1.5` cumple potencia, decimal, negativo, paréntesis y «al menos 4 números» para cualquier objetivo.
  - Las reglas restrictivas castigan precisamente la respuesta más algebraica: el despeje `(19 + 16) / (9 − 2)` falla por «máximo 12».
  - El último reto (5 reglas) puede ser la ecuación más simple (`6 * x = 24` en el 6 % de los casos).
- **Justicia:**
  - El salto desde el Mundo 4 es brusco: las x negativas pasan del 0 % al 33 % de las ecuaciones. En la simulación, el jugador sintético RL80 pasa de 3 a 8 secuencias de mediana (SIMULADO).
  - A 320 px de ancho, la regla nueva queda oculta tras el marcador (VIVO, EUR-11).
  - En Suave, con «máximo 12» como primera regla, entre el 6 % y el 12,5 % de las semillas no se pueden planificar; el planificador vuelve a sortear en silencio y desplaza la distribución de reglas (MA-04).
- **Valoración:** resoluble y razonablemente justo en tiempo para un alumno con soltura (85–145 s), pero **no es la síntesis que promete** el diseño.

---

## D. Hallazgos

### D.1 Índice

| ID                            | Severidad                               | Componente                          | Título                                                                                                                                         | Evidencia                            |
| ----------------------------- | --------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| EUR-04                        | **ALTA** (prioridad 1)                  | Motor / web                         | Un error de sintaxis o una errata termina la secuencia; se rechaza la notación española                                                        | VIVO                                 |
| EUR-05                        | **ALTA**                                | Mundo 1 · `REQUIRED_OPERATION`      | «Debes usar 7 * 1» rechaza `3 * 7 * 1`                                                                                                         | VIVO + MEDIDO                        |
| EUR-35                        | **ALTA** (operación)                    | Auth · despliegue                   | No hay forma de recuperar una contraseña en producción                                                                                         | INSPECCIONADO                        |
| EUR-03                        | **ALTA**                                | Dificultad adaptativa               | Suave no llega al alumno honesto que se atasca; rama Intensa por precisión muerta                                                              | VIVO + MEDIDO + SIMULADO             |
| EUR-02                        | **ALTA** (equidad) + DECISIÓN           | Puntuación · clasificación · reto 1 | Copiar el enunciado del reto 1 permite farmear puntos                                                                                          | VIVO + MEDIDO                        |
| EUR-01                        | **DECISIÓN DE PRODUCTO** (impacto alto) | Motor de reglas · todos los mundos  | Las reglas «exigidas» se cumplen con relleno neutro                                                                                            | MEDIDO + VIVO                        |
| EUR-36                        | MEDIA                                   | Panel docente                       | «Requiere atención» nunca marca al alumno típico con dificultades                                                                              | INSPECCIONADO + TEÓRICO              |
| EUR-37                        | MEDIA (configuración)                   | Auth · limitador                    | Los valores por defecto del limitador por IP pueden bloquear a clases enteras                                                                  | INSPECCIONADO                        |
| EUR-38                        | MEDIA                                   | Datos de menores                    | Nombre libre visible en la clasificación, cuentas no borrables, sin consentimiento                                                             | INSPECCIONADO                        |
| EUR-06                        | MEDIA (BAJA sin apertura por fases)     | `WorldsRepository`                  | La caché congela `isEnabled`: mundo deshabilitado jugable o mapa caído                                                                         | VERIFICADO (harness) + INSPECCIONADO |
| EUR-07                        | MEDIA                                   | `REQUIRED_PARENTHESES`              | Semántica estructural: `5 * (-3)` no cuenta y el mensaje contradice la regla                                                                   | MEDIDO                               |
| EUR-09                        | MEDIA                                   | Web · incorporación                 | La mecánica no se explica antes del cronómetro; el reto siguiente arranca solo                                                                 | VIVO                                 |
| EUR-10                        | MEDIA + DECISIÓN                        | Mundo 5                             | Caos acumula, no sintetiza; salto brusco desde el Mundo 4                                                                                      | MEDIDO + SIMULADO                    |
| EUR-12                        | MEDIA (configuración)                   | Auth · web                          | Con el TTL por defecto (1 h), el token caduca a mitad de un reto                                                                               | INSPECCIONADO (+ observado en vivo)  |
| EUR-15                        | MEDIA                                   | Web · accesibilidad                 | Contraste de 2,1:1 en botones principales; lector de pantalla incompleto; sin ajuste de tiempo                                                 | MEDIDO + INSPECCIONADO               |
| EUR-16                        | MEDIA                                   | Generador                           | Cobertura desigual de los conceptos; el enunciado no crece; resultados «feos»                                                                  | MEDIDO                               |
| EUR-17                        | MEDIA                                   | Pruebas                             | Huecos de cobertura que ocultan los hallazgos anteriores                                                                                       | INSPECCIONADO + MEDIDO               |
| EUR-18                        | MEDIA                                   | Web · textos                        | El diálogo de fallo no muestra lo enviado; reglas «descartadas» y «dominadas» a la vez; multiplicador y dificultad sin explicar; × ÷ sin tecla | VIVO + INSPECCIONADO                 |
| EUR-08                        | DECISIÓN DE PRODUCTO                    | Feedback                            | El fallo no enseña: ni solución ni valor correcto (ocultarlo fue deliberado en §11)                                                            | INSPECCIONADO + VIVO                 |
| EUR-11                        | BAJA                                    | Web · móvil                         | A 320 px, con 5 reglas, la regla nueva queda tapada por el marcador                                                                            | VIVO                                 |
| EUR-13                        | BAJA                                    | API · robustez                      | Un byte NUL da 500 y deja el reto abierto; un cuerpo de 1 MB da 500                                                                            | VIVO                                 |
| EUR-14                        | BAJA (con versión congelada)            | Catálogo · despliegue               | Cambiar la semántica de una regla sin cambiar su clave culpa al jugador                                                                        | VERIFICADO (harness)                 |
| EUR-19…EUR-34, EUR-39, EUR-40 | BAJA                                    | Varios                              | Ver D.3                                                                                                                                        | —                                    |

El orden refleja la prioridad. Los IDs se conservan entre borradores para la trazabilidad; las recalibraciones se explican en §D.4.

### D.2 Fichas detalladas (ALTA y MEDIA)

#### EUR-01 · DECISIÓN DE PRODUCTO (impacto alto) · Las reglas «exigidas» se cumplen con relleno neutro

> **Clasificación.** El mecanismo está confirmado por tres agentes y por el revisor principal, este con el motor real: en
> el Mundo 1, 6 de 12 secuencias reales del planificador se completan sin calcular. Pero «cumplir la letra de la regla» es
> la filosofía declarada (`docs/architecture.md:328-329`), y §11 aceptó `n / 1`. Por eso se clasifica como decisión de
> producto y no como defecto. Su impacto educativo es alto y conviene decidirla **antes** del piloto (ver §E.1).

- **Dónde:**
  - Los handlers solo comprueban que algo **aparece** en el árbol de la expresión, no que influya en el valor: `apps/api/src/modules/challenges/rules/handlers/required-operator.rule.ts:22-29`, `min-numbers.rule.ts:23-28`, `required-negative.rule.ts:30-34`, `required-decimal.rule.ts:19-26` y `required-parentheses.rule.ts:19-24`.
  - La garantía de que la regla nueva «muerde» solo asegura que se rechazan el enunciado tal cual y el resultado literal: `challenges/generation/challenge-generator.ts:299-332`.
- **Ejemplos** (MEDIDO con el motor real). Todos son CORRECT:
  - `21 / 1`
  - `21 - 0`
  - `-7 * 1`
  - `12 ^ 1`
  - `12 * 7 ^ 0`
  - `21 + 0 + 0 + 0`
  - `--21`
  - `7 + 0.5 - 0.5`
  - `21 * (1 + 0)`
- **Sufijo fijo por mundo, que vale 0 y cumple todas sus reglas positivas:**
  - M1: `+ (7 * 1 - 7) / 1`
  - M2: `- (-1) * 0`
  - M3: `+ 0.1 / 1 - 0.1`
  - M4: `+ (2 - 2) ^ 2`
  - M5: `+ (-2 + 2) ^ 2 * 1.5`
- **Reproducción en vivo** (cuenta nueva, Mundo 1, Suave):
  - `3 × 2` (copia del reto 1)
  - `(4 × 6 + 10) × 1` (regla: paréntesis)
  - `(11 × 11 + 4) × 1` (reglas: paréntesis y al menos 4 números)

  Resultado: «¡Completaste el Mundo 1! Desbloqueaste el Mundo 2», con 2 de 6 reglas dominadas y ninguna operación realizada.

- **Medición:** ver la tabla de §C. El 26,4 % de las secuencias Suaves del Mundo 1 se completan sin calcular. Con el sufijo y calculando solo el valor, se supera el 100 % de 126 000 retos.
- **Consecuencias:**
  - Solo `FORBIDDEN_DIGIT`, `MAX_NUMBER` y las ecuaciones obligan a razonar.
  - Los conceptos de los Mundos 2 y 3 y las potencias del 4 nunca son necesarios.
  - Un alumno que descubra el patrón «añado `× 1`» progresa sin aprender, y el desbloqueo deja de certificar nada.
- **Resolución recomendada (decisión de producto + código):**
  - Como mínimo:
    - prohibir los elementos neutros (`× 1`, `/ 1`, `± 0`, `^ 1`, `^ 0`, `a − a`);
    - prohibir que el enunciado completo aparezca dentro de la respuesta.
  - Mejor: exigir que la pieza requerida sea **esencial**, es decir, que quitarla cambie el valor.
  - Recalibrar después los tiempos y el número de reglas, porque cada regla costará de verdad.
- **Requiere:** decisión de producto (semántica) y después cambio de código.

#### EUR-02 · ALTA (equidad) + DECISIÓN DE PRODUCTO · El reto 1 se copia y los puntos se farmean

> **Discrepancia resuelta.** El revisor principal propuso MEDIA: el reto 1 sin reglas (§2.2) y que los puntos nunca se
> pierdan (§2.5) son requisitos no negociables, y farmear por API exige programar. Se mantiene ALTA porque el camino
> **desde la interfaz** es trivial y plausible a cualquier edad: copiar el enunciado, escribir cualquier cosa y pulsar
> «Nueva secuencia» rinde unos 100 puntos cada pocos segundos (HEURÍSTICO), frente a 700 por completar el Mundo 1 jugando.
> Nada de lo que se recomienda viola §2: decidir si el reto 1 puntúa y en qué se basa la clasificación.

- **Dónde:**
  - El reto 1 no tiene reglas y la garantía de «mordida» empieza en la posición 2 (`challenge-generator.ts:305`).
  - La instrucción, «Escribe una expresión que valga lo mismo que la operación», no pide una expresión distinta (`game/game.service.ts:659-664`).
  - Cada acierto vale 100 × multiplicador, sin importar el mundo, la dificultad ni el número de reglas (`scoring/scoring-engine.ts:35-41`).
  - Los puntos nunca se pierden y la clasificación los suma (`game/leaderboard.service.ts:44-61`).
  - No hay límite de peticiones en las rutas de juego.
- **Reproducción:**
  - VIVO (navegador): en el reto 1, escribir `4 × 7` para el enunciado «4 × 7» da «¡Correcto!» y +100.
  - VIVO (HTTP, agente QA): ciclos de «copiar el reto 1 + responder mal el 2» dan **2 500 puntos en 101 peticiones y 0,8 s**, frente a los 700 de completar el Mundo 1 jugando de verdad.
  - MEDIDO: copiar el enunciado pasa el 100 % de los retos 1 de tipo expresión, y escribir el resultado literal, el 100 % de todos los retos 1.
- **Consecuencias:**
  - La clasificación entre compañeros, uno de los motores motivacionales del piloto, se puede manipular trivialmente.
  - La copia también infla la precisión que mira la política adaptativa (EUR-03).
- **Resolución:**
  - Decisión de producto sobre si el reto 1 da puntos y si la respuesta debe ser «distinta».
  - Código:
    - límite de peticiones;
    - puntos ponderados por reglas activas o por dificultad;
    - clasificación basada en compleciones o reglas dominadas en lugar de puntos brutos.
  - Mitigación inmediata para el piloto: ocultar la clasificación o no puntuar el reto 1.

#### EUR-03 · ALTA · La dificultad adaptativa no ayuda a quien lo necesita (y se puede forzar)

> **Alcance de la severidad.** El revisor principal confirmó (a)–(d) con la política real.
>
> - Lo que se considera **defecto ALTO** es (a): el sistema adaptativo no cumple su función principal con el patrón de
>   fallo más común. Se le suman (c) y (d), que son consecuencias de la misma causa.
> - El forzado deliberado (b) es una consecuencia aceptada en `docs/architecture.md:317`. Se trata como **decisión de
>   producto** en §E.2 y §E.3.
> - (d) solo afecta al rejugar: el mundo siguiente empieza en Normal.

- **Dónde:**
  - `game/difficulty.ts:48-61` (política) y `:65-83` (resumen de rendimiento).
  - `game/sequence-store.ts:126-146`: ventana de los 12 últimos intentos del mundo.
- **Mecanismo** (INSPECCIONADO, MEDIDO y confirmado por el orquestador sobre el código):
  1. **El alumno honesto que se atasca no llega a Suave.**
     - Su historial típico es «acierto en el reto 1 (copiable), fallo en el 2».
     - Eso da `consecutiveFailures = 1` y una precisión del 50 %. Nunca alcanza «3 fallos seguidos» ni «precisión < 35 %».
     - SIMULADO: un jugador que domina 2 reglas pero no 3 juega el 99,8 % de sus secuencias en Normal.
  2. **Se fuerza a propósito.** Tres fallos en el reto 1 (una errata, dejar pasar el tiempo, responder «1») hacen que la siguiente secuencia sea Suave: 3 retos y 2 reglas, o 3 reglas en Caos. Completarla desbloquea el mundo siguiente.
  3. **Rendirse por tiempo baja el nivel; equivocarse no.** (acierto, timeout) × 2 da Suave; (acierto, fallo) × 6 da Normal.
  4. **La rama «Intensa por precisión ≥ 80 %» es inalcanzable.** La dificultad se elige tras un fallo (que rompe la condición «sin fallos») o tras completar (que ya activa la otra rama). Toda compleción lleva a Intensa: salto directo de Suave a Intensa y oscilación al rejugar. `docs/architecture.md:176-178` describe otra cosa.
- **Reproducción (VIVO):** cuenta nueva en el Mundo 1. Fallos: errata en el reto 3, tiempo agotado en el reto 1 y «1» en el reto 1. Resultado: la siguiente secuencia es «Dificultad: Suave · Desafío 1 de 3». Al completarla, el Mundo 2 queda desbloqueado. Unos 5 minutos en total.
- **SIMULADO:** un «jugador táctico» (GAMER80) completa el Mundo 1 en ≤ 5 secuencias el 96,2 % de las veces, frente al 70,5 % del jugador honesto equivalente.
- **Consecuencias:** el desbloqueo se puede obtener con 2 reglas a coste casi nulo, mientras que el alumno que más necesita apoyo no lo recibe.
- **Resolución:**
  - Medir el rendimiento **por secuencias**, excluyendo el reto 1.
  - Bajar un nivel tras N secuencias fallidas en el mismo nivel y subir un escalón cada vez (con histéresis).
  - Que los fallos triviales en el reto 1 no cuenten para bajar.
  - Decidir si un desbloqueo en Suave cuenta como dominio (ver §E).

#### EUR-04 · ALTA (prioridad 1) · Una errata o la notación española terminan la secuencia

> El revisor principal lo confirma y lo sitúa como prioridad nº 1. Además, la interfaz dibuja el enunciado con `×`
> (`GamePage.tsx:62-65`), lo que invita a teclear la letra x. Normalizar la notación no viola el §2: una cadena que no se
> puede interpretar no tiene valor y, por tanto, no es una «respuesta incorrecta». Que un error de sintaxis consuma o no
> el intento sí es decisión de producto.

- **Dónde:**
  - `challenges/challenge-engine.ts:61-63`: SYNTAX_ERROR es un fallo de evaluación.
  - `game/game-engine.ts:91-99`: todo lo que no es CORRECT termina la secuencia.
  - `math/tokenizer.ts:34-43, 136-141`: solo normaliza `× ÷ − –`.
  - `apps/web/src/features/game/pages/GamePage.tsx:518-531`: la única validación previa al envío es la `x` en ecuaciones.
- **Reproducción:**
  - VIVO: en el reto 3 de 4 (Mundo 1), `(9 + 0) × 3 × 6 +` da «¡Secuencia terminada! … falta un número al final». Se descartan las reglas y la racha vuelve a 0.
  - MEDIDO: `8x9`, `8 x 9`, `8·9`, `144:2`, `8²`, `[8*9]`, `2(36)`, `(8*9` y `8*9 =` dan todos SYNTAX_ERROR. En un mundo con potencias, `2^13` también («exponente demasiado grande»).
  - VIVO (QA): `"   "` (solo espacios) penaliza, mientras que `""` da 400 sin coste.
- **Consecuencias:**
  - El alumno pierde 3–5 retos de trabajo por una tecla mal pulsada o por usar la notación que le enseñaron (`·` en el teclado español es Mayús+3).
  - Además, las fichas «Puedes usar» muestran `×` y `÷`, que no están en el teclado, sin decir qué tecla pulsar.
- **Decisión previa:** el requisito no negociable §2.3 dice «respuesta incorrecta = fallo directo». Hay que decidir si una expresión que **no se puede leer** es una «respuesta incorrecta» (ver §E).
- **Resolución:**
  - Que SYNTAX_ERROR no consuma el intento (422 sin resolver), o al menos validarlo en el cliente.
  - Normalizar `·`, `∗` → `*`, `:` → `/` y `—` → `-`.
  - Mensajes con sugerencia («para multiplicar usa *»).
  - Explicar en la interfaz el límite del exponente y que `1.000` no significa mil.

#### EUR-05 · ALTA · «Debes usar la multiplicación 7 * 1» rechaza `3 * 7 * 1`

- **Dónde:**
  - `challenges/rules/handlers/required-operation.rule.ts:56-63` busca un nodo binario cuyos hijos sean los literales 7 y 1.
  - El parser es asociativo a la izquierda (`math/expression-parser.ts:199-207`): `3 * 7 * 1` es `(3 * 7) * 1`.
  - La limitación está documentada en el código (`:28-32`) y en `docs/architecture.md:322-323`, y la fija una prueba.
- **Reproducción:**
  - VIVO: con el enunciado `2 × 7 × 9 ÷ 7` y la regla activa, `2 * 9 * 7 * 1 / 7` da «Debes usar la operación 7 * 1 al menos una vez».
  - MEDIDO: `3 * 7 * 1`, `3 + 3 * 7 * 1`, `3 * 1 * 7` y `-7 * 1` fallan; `7 * 1 * 3`, `1 * 7 * 3` y `3 * (7 * 1)` pasan.
- **Frecuencia:** la regla solo existe en el Mundo 1. Aparece en el 33 %, 50 % y 67 % de las secuencias Suave, Normal e Intensa.
- **Consecuencias:** en el mundo de principiantes, la forma más natural de escribir «multiplico también por 7 * 1» termina la secuencia, con un mensaje que contradice lo que el alumno ve escrito. Es exactamente el tipo de fallo que no se entiende. Que la limitación esté documentada no la hace justa.
- **Resolución:** aplanar las cadenas de `*` y `+` y aceptar factores literales adyacentes (código), o cambiar el texto de la regla a «escribe (7 * 1)».

#### EUR-06 · MEDIA (BAJA si no se abren mundos por fases) · La caché de mundos congela `isEnabled`

> **Recalibrado de ALTA a MEDIA.** `isEnabled` solo se escribe al crear el mundo (`catalog-sync.ts:23-26`), y no hay
> interfaz, endpoint ni script para cambiarlo: solo SQL a mano. Con los 5 mundos habilitados no se dispara, y reiniciar la
> API lo resuelve. Sigue siendo relevante porque la corrección de §11 («`startAttempt` comprueba que el mundo esté
> habilitado») no se sostiene en ejecución.

- **Dónde:**
  - `worlds/worlds.repository.ts:52-62`: `getBySlug` y `getById` devuelven el objeto cacheado.
  - `:87-89`: la caché nunca caduca; `clearCache` solo la llaman las pruebas.
  - `game/world-unlocks.service.ts:48-49`: si el mundo no figura entre los habilitados, `assertUnlocked` no lanza.
  - `game/game.service.ts:181`: la comprobación de mundo habilitado añadida en §11 usa el objeto cacheado.
- **Reproducción** (agente de backend, harness con el `GameService` real; el orquestador confirmó el mecanismo leyendo el código):
  - **(a)** Un alumno sin el Mundo 1 completado prueba `signs` (403), con lo que el mundo queda en caché. El operador lo deshabilita en la BD. Desde entonces `startSession`, `startAttempt` y `answer` funcionan: CORRECT y +100 en un mundo deshabilitado y además bloqueado para él.
  - **(b)** Alguien pide `chaos` mientras está deshabilitado (404, que queda en caché). El operador lo habilita. Desde entonces `GET /worlds` y `GET /progress` fallan para **todos** los usuarios hasta reiniciar la API.
- **Consecuencias:** un piloto escalonado («habilitamos el Mundo 3 la semana que viene») puede dejar la aplicación inservible o mostrar contenido no autorizado. Requiere una acción del operador en la BD (no hay interfaz de administración para esto), pero es una operación natural en un piloto.
- **Resolución:**
  - Para el piloto, basta un procedimiento de operación: no tocar `worlds.isEnabled`, o reiniciar la API después de hacerlo.
  - Después: no cachear `isEnabled` (cachear solo la parte del catálogo) o invalidar la caché, y añadir una prueba que lo alterne.

#### EUR-07 · MEDIA · `REQUIRED_PARENTHESES` es estructural y contradice a otras reglas

- **Dónde:** `math/ast.ts:124-160` (`necessaryGroups`) y `rules/handlers/required-parentheses.rule.ts:19-24`.
- **Ejemplos (MEDIDO):**
  - Cuentan: `2 + (3 + 4)`, `2 * (3 * 4)` y `21 * (1 + 0)`, aunque quitar los paréntesis no cambia el valor.
  - No cuentan: `5 * (-3)` y `5 - (-3)`, aunque `REQUIRED_NEGATIVE` enseña literalmente «como (-3)» (`chaos.world.ts:48`).
  - El mensaje de fallo dice «Unos paréntesis que se pueden quitar sin cambiar nada no cuentan» (`:22-23`), lo que es falso para `2 + (3 + 4)`.
- **Consecuencias:** en el Caos, con «negativo» y «paréntesis» activas a la vez, un alumno que escribe `5 * (-3)` creyendo cumplir ambas pierde la secuencia.
- **Resolución:** decisión de producto («paréntesis que cambian el valor»; el 100 % de las soluciones de referencia ya los cumple), y como mínimo alinear el mensaje.

#### EUR-08 · DECISIÓN DE PRODUCTO · El fallo no enseña

> Ocultar el valor esperado fue una decisión deliberada de la revisión anterior (§11; `docs/architecture.md:326-327`). Se
> presenta como decisión de producto con una recomendación explícita. Que el diálogo no muestre lo enviado es un defecto de
> interfaz y se trata en EUR-18.

- **Dónde:** `apps/web/src/features/game/feedback.ts:79-142`, `GamePage.tsx:1065-1146` y `challenge-engine.ts:81-91`.
- **Evidencia:**
  - INSPECCIONADO: nunca se muestra el valor correcto, la `x` de la ecuación ni un ejemplo de respuesta válida. El tiempo agotado solo dice «Se acabó el tiempo».
  - VIVO: el diálogo de fallo no muestra la expresión enviada, aunque el mensaje de sintaxis cite posiciones.
- **Consecuencias:** en una ecuación, el alumno nunca sabe cuánto valía x. Ocultar la respuesta no protege nada, porque la secuencia se descarta y el siguiente sorteo es distinto. El diseño desaprovecha el momento de mayor atención.
- **Resolución:** tras un fallo, mostrar lo enviado (resaltando el error), el valor correcto o la x, y una respuesta válida legible.

#### EUR-09 · MEDIA · La mecánica no se explica y el cronómetro arranca solo

- **Evidencia (VIVO):**
  - No hay pantalla de «cómo se juega».
  - La tarjeta «Empezar desafío» no dice qué hay que hacer.
  - La primera explicación es la instrucción del servidor, que aparece con el reloj ya en marcha.
  - Tras un acierto, el resultado se ve unos 1,5 s y el reto siguiente empieza solo con el cronómetro corriendo (observado: 00:55 a los 3 s). También al pulsar «Nueva secuencia».
- **Dónde:** `GamePage.tsx:465-474, 581-593, 822-858`; `HomePage.tsx:226-229`.
- **Resolución:**
  - Tarjeta de incorporación con un ejemplo resuelto la primera vez.
  - Mostrar el tiempo y las reglas de la secuencia en la tarjeta de inicio.
  - Botón «Siguiente desafío» o una pausa mínima (decisión de producto).

#### EUR-10 · MEDIA · El Caos acumula, no sintetiza (DECISIÓN DE PRODUCTO asociada)

Ver §C (Mundo 5) y §E.4.

- **Dónde:** `challenges/generation/statement-families.ts:57-82` (una familia por candidato) y `worlds/catalog/chaos.world.ts`.
- **Resolución:**
  - Plantillas mixtas (`(-2)^3 + 3/4`, ecuaciones con coeficientes decimales).
  - Rampa de entrada: 2 familias por secuencia en Suave.
  - Revisar las reglas que bloquean el despeje.

#### EUR-11 · BAJA · A 320 px la regla nueva queda tapada

> Recalibrado a BAJA: 5 reglas solo aparecen en Caos Intensa, y en las aulas casi no hay pantallas de 320 px.

- **Reproducción (VIVO):** Caos en Intensa, reto 6 de 6, viewport de 320×568.
  - Las cinco reglas ocupan desde y=393 hasta y=631, y el marcador empieza en y=577.
  - La página solo se desplaza 52 px. La quinta regla, la **NUEVA** («Usa al menos 4 números»), queda detrás del marcador.
  - A 375×667 todo cabe justo (última regla hasta y=625; marcador desde y=624).
- **Dónde:** `GamePage.module.css`: reglas bajo el campo, marcador fijo y altura limitada.
- **Resolución:** reglas antes del campo en móvil, permitir el desplazamiento o reservar espacio para el marcador. Verificar también el aviso de «regla nueva» sobre el reloj (FE-08, no verificado).

#### EUR-12 · MEDIA (configuración) · La sesión caduca a mitad de un reto

> Se resuelve sin código: `JWT_EXPIRES_IN_SECONDS` admite hasta 30 días (`config/env.validation.ts:84-90`). El riesgo
> está en desplegar con el valor por defecto de 1 h.

- **Dónde:**
  - `auth/auth.module.ts:47`: TTL de 3 600 s sin renovación.
  - `apps/web/src/services/api/client.ts:80-81`: un 401 redirige a `/acceso`.
  - `AuthContext.tsx:33-36`.
- **Evidencia:**
  - INSPECCIONADO.
  - Observado en vivo tras una pausa larga: la pestaña volvió a «Inicia sesión» y el reto en curso se cerró por tiempo.
- **Consecuencias:** en una clase de 50–60 minutos con inicio de sesión al principio, la expulsión es probable al final. Se pierde la respuesta escrita y el reloj del servidor sigue corriendo.
- **Resolución:** TTL ≥ la duración de la sesión de clase o renovación silenciosa, y guardar el borrador en `sessionStorage`.

#### EUR-13 · BAJA · Entradas raras provocan errores 500

> Recalibrado a BAJA:
>
> - la transacción se revierte;
> - el intento sigue PENDING y la web deja reenviar (`GamePage.tsx:556-559`);
> - el NUL no se puede teclear.

- **Byte NUL:**
  - VIVO (reproducido por el orquestador): `POST /attempts/:id/answer` con `{"expression":"1\u00002"}` da **500**, y el intento sigue PENDING con el reloj corriendo.
  - Causa: PostgreSQL rechaza 0x00 en `updateMany` de `persistResolution` (`game/game.service.ts:434`).
- **Cuerpo de 1 MB:** da 500 en lugar de 413, porque `PayloadTooLargeError` no es una `HttpException` (`common/filters/all-exceptions.filter.ts:27-41`).
- **Consecuencias:** errores ruidosos y estados abiertos. No hay corrupción.
- **Resolución:** sanear o rechazar los caracteres de control en el DTO; mapear 413.

#### EUR-14 · BAJA (con versión congelada durante el piloto) · Cambio de catálogo con la misma clave

- **Dónde:** `game/game.service.ts:360-395`. La retirada de intentos solo compara claves, y la secuencia no guarda una huella de la versión del catálogo (`sequence-store.ts:74-96`).
- **Evidencia (harness):** si `forbidden-digit-2` pasa a prohibir el 3, la solución de referencia `3 * 4` se evalúa como RULE_VIOLATION: racha a 0 y secuencia FAILED, con la culpa para el jugador.
- **Resolución:** guardar con la secuencia la configuración de cada regla, o una huella, y retirarla sin culpa si cambia. O bien prohibir por proceso que una regla cambie de semántica sin cambiar de clave.

#### EUR-15 · MEDIA · Accesibilidad

- Contraste de blanco sobre naranja: 2,11:1 en «Empezar desafío» y «Jugar», 2,17:1 en «Nueva secuencia». El reloj amarillo tiene 3,61:1 y el texto de ejemplo del campo, 2,40:1 (MEDIDO con un calculador WCAG sobre los colores del CSS).
- El lector de pantalla no anuncia el enunciado ni las reglas al cambiar de reto, y no hay avisos de tiempo (`GamePage.tsx:381-384, 725-728, 773-797`).
- No hay ajuste de tiempo para alumnos con necesidades específicas (WCAG 2.2.1; decisión de producto).

#### EUR-16 · MEDIA · Cobertura desigual de los conceptos en el generador

MEDIDO:

- M1 Suave: el 76 % de los enunciados son productos sin jerarquía de operaciones.
- M2: entre el 23 % y el 30 % de los enunciados no tienen signo.
- M3: 0 resultados negativos.
- M4: x nunca negativa ni fraccionaria en Suave y Normal.
- Dentro de una secuencia el enunciado no crece: la plantilla se elige al azar entre las de complejidad ≤ el nivel (`statement-families.ts:133-138, 394-395`).
- Entre el 1 % y el 3 % de los resultados tienen denominador mayor que 100 (tope de 1000 en `statement-families.ts:44`).

Resolución: pesos y perfiles por mundo (`signs.world.ts:4-7`, `algebra.world.ts:52-77`, `arithmetic.world.ts:66-84`) y un tope de denominador menor en Suave.

#### EUR-17 · MEDIA · Huecos de pruebas que ocultan los hallazgos

- `test/helpers/scripted-planner.ts`: las 42 pruebas de `game-flow.int-spec.ts` juegan en el Mundo 1 una secuencia fija clásica, no la del planificador real.
- `authorization-matrix.int-spec.ts` no incluye las rutas de juego.
- `difficulty.spec.ts` deja vivos 4 de 8 mutantes (umbrales 0,35 y 0,5 sin casos frontera; MEDIDO por mutación).
- En el proyecto, la concurrencia solo se prueba con PGlite y pool = 1. Esta auditoría la verificó aparte en PostgreSQL 17 real (Anexo VII); conviene un job de CI que ejecute la suite de integración contra PostgreSQL real, como se hizo aquí.
- Nada alterna `isEnabled`. No hay prueba de contrato ni E2E web ↔ API (las 146 pruebas web usan respuestas simuladas escritas a mano).
- `sequence-planner.spec.ts:222` exige un p95 < 50 ms medido con reloj real, lo que puede fallar de forma intermitente en CI.

#### EUR-18 · MEDIA · Textos y comprensión

VIVO + INSPECCIONADO:

- El diálogo de fallo **no muestra la expresión enviada**, aunque el mensaje de sintaxis cite posiciones; el campo queda desenfocado detrás del velo (`GamePage.tsx:1065-1146`).
- Tras un fallo, la misma regla aparece tachada en «Reglas descartadas» y a la vez contada en «Tus reglas dominadas».
- El mapa dice «si fallas, se descartan, pero tus reglas dominadas se quedan contigo» sin haber explicado antes qué es una regla.
- «PRÓXIMO ×2» y el multiplicador no se explican.
- El cambio a «Suave» o «Intensa» y la longitud de la secuencia (3–6 retos) no se explican.
- Las fichas `×` y `÷` no dicen qué tecla pulsar; el «también *» solo está en `title`, invisible en pantallas táctiles.

#### EUR-35 · ALTA (operación del piloto) · No hay forma de recuperar una contraseña

- **Dónde:**
  - `config/env.validation.ts`: `MAIL_TRANSPORT` solo admite `disabled` o `console`, y `console` se rechaza con `NODE_ENV=production`, porque imprime los tokens.
  - La web no tiene ruta de «olvidé mi contraseña» (`apps/web/src/app/router/AppRoutes.tsx`). El enlace por defecto `<CORS_ORIGIN>/reset-password` (`auth.config.ts:63`) cae en la ruta comodín y redirige a `/`.
  - No hay endpoint de docente ni de administrador para restablecer la contraseña de un alumno.
- **Evidencia:** INSPECCIONADO por el revisor principal y confirmado por el orquestador en `env.validation.ts`, las rutas web y los controladores de administración y grupos.
- **Consecuencias:** en un piloto de varias semanas con alumnos de 10–15 años, una contraseña olvidada significa perder el progreso (crear otra cuenta) o tocar la BD con SQL.
- **Resolución:** script o endpoint de restablecimiento por docente o administrador (mínimo); transporte de correo real o flujo web completo (después).

#### EUR-36 · MEDIA · El panel docente no marca al alumno que más lo necesita

- **Dónde:**
  - Umbrales de «requiere atención»: al menos 5 intentos, precisión **por debajo** del 50 % o 3 fallos seguidos (`teacher-dashboard/dto/dashboard.dto.ts:23,36,49`).
  - Racha de fallos calculada en `statistics/attempt-analytics.service.ts:130-147`.
- **Evidencia:** INSPECCIONADO + TEÓRICO. El patrón típico del alumno con dificultades (acertar el reto 1 copiable y fallar el 2) da exactamente un 50 % de precisión y 1 fallo seguido, así que nunca salta la alerta.
- **Consecuencias:** el docente no recibe la señal que el panel promete. La causa es la misma que la de EUR-03 (a).
- **Resolución:** excluir el reto 1 tanto de la política de dificultad como de las métricas docentes, con un único arreglo.

#### EUR-37 · MEDIA (configuración) · El limitador de inicio de sesión puede bloquear a clases enteras

- **Dónde:**
  - Límite por IP de 100 fallos cada 15 min (`auth/auth.config.ts:51`), que solo acumula fallos (`auth.service.ts:60,68-74`).
  - `TRUST_PROXY` vale `false` por defecto (`common/configure-app.ts:15`).
- **Evidencia:** INSPECCIONADO.
- **Consecuencias:**
  - Detrás de un proxy inverso sin `TRUST_PROXY`, todos los alumnos comparten un contador, así que las erratas de unas pocas clases bloquean a todos entre 60 y 900 s.
  - Con NAT escolar, varias clases comparten IP.
  - El registro no está limitado, así que dar de alta a una clase entera no es problema.
- **Resolución:** lista de configuración del piloto con `TRUST_PROXY` correcto, `LOGIN_MAX_ATTEMPTS_IP` de 300–500 y `LOGIN_MAX_ATTEMPTS_IP_EMAIL` de 8–10. Probarla con la topología real del centro.

#### EUR-38 · MEDIA · Datos de menores

- **Qué se guarda:** correo, `displayName` libre (80 caracteres), las expresiones enviadas, e IP y User-Agent por sesión.
- **Qué ven los compañeros:** el `displayName` en la clasificación. No se puede editar (`users.controller.ts` solo tiene `GET /me`).
- **Borrado:** una cuenta con puntos no se puede borrar (FK RESTRICT en `score_transactions`, `20261121000000_init/migration.sql:279`, y un trigger que impide DELETE en `…_game_persistence/migration.sql:77-85`).
- **Consentimiento:** no hay campo de consentimiento ni de edad.
- **Evidencia:** INSPECCIONADO.
- **Consecuencias:**
  - El nombre visible puede ser un nombre completo, una suplantación o algo ofensivo.
  - No hay procedimiento para borrar o anonimizar al terminar el piloto.
- **Resolución:** procedimiento de datos acordado con el centro (alias, consentimiento, anonimización al cierre), y moderar o editar el `displayName`.

### D.3 Hallazgos de severidad BAJA

| ID     | Componente · ubicación                                                                     | Hallazgo                                                                                                                                                                                                                                                                         | Evidencia            |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| EUR-19 | `game.service.ts:262-275`                                                                  | `submittedAt` se mide después del bloqueo y de `retireUnplayable`, sin margen de latencia. En reposo son 6–22 ms; con contención, 110–150 ms; un envío 10 ms antes del plazo ya es TIMEOUT. En PostgreSQL real, con 60 alumnos sin pausa: p50 106 ms, p99 144 ms, máximo 150 ms. | VIVO (QA) + PG-REAL  |
| EUR-20 | `game.service.ts:383`, `progress-view.builder.ts:27`                                       | `Promise.all` dentro de una transacción: `pg` emite DeprecationWarning y romperá con `pg@9`.                                                                                                                                                                                     | VIVO (log de la API) |
| EUR-21 | `auth/dto/session.dto.ts:9` frente a `game/dto/game.dto.ts:86`                             | Dos `SessionDto`: Swagger documenta `/auth/sessions` con el esquema del juego.                                                                                                                                                                                                   | VIVO                 |
| EUR-22 | `challenge-engine.ts:81-91`                                                                | WRONG_RESULT incrusta el valor completo: con 191 caracteres de entrada se obtiene un mensaje de 8,7 KB, que se persiste y puede desbordar el diálogo.                                                                                                                            | MEDIDO               |
| EUR-23 | `sequence-store.ts:132-137`; migración                                                     | Los intentos retirados «sin culpa» cuentan como TIMEOUT para la dificultad, y las estadísticas y el panel docente mezclan fuentes.                                                                                                                                               | VERIFICADO (harness) |
| EUR-24 | `challenge-engine.ts:80-92`, `game.service.ts:465-471`                                     | Las violaciones de reglas se cuentan aunque el fallo sea WRONG_RESULT, lo que mezcla causas en las estadísticas del docente.                                                                                                                                                     | VIVO (QA)            |
| EUR-25 | `world-unlocks.service.ts:28-38`                                                           | La cadena de desbloqueo se calcula sobre los mundos habilitados: deshabilitar `signs` desbloquea `fractions` para todos (D5 dice «mundo n − 1»).                                                                                                                                 | VERIFICADO (harness) |
| EUR-26 | `game.service.ts:525`                                                                      | Un reenvío idempotente devuelve el progreso **actual**, no el original.                                                                                                                                                                                                          | VERIFICADO (harness) |
| EUR-27 | `game.service.ts:253-304`                                                                  | `submitAnswer` no vuelve a comprobar el desbloqueo. Solo es alcanzable reparando datos.                                                                                                                                                                                          | VIVO (QA)            |
| EUR-28 | `progression.service.ts:126-129`                                                           | El `INSERT` crudo usa `now()` de la BD en columnas sin zona: el servidor PostgreSQL debe estar en UTC.                                                                                                                                                                           | VERIFICADO           |
| EUR-29 | `sequence-planner.ts:109-118`, `chaos.world.ts:76-80`                                      | Caos Suave con «máximo 12» primero: entre el 6 % y el 12,5 % de las semillas no se planifican y se vuelve a sortear en silencio (sesgo de 13,56 % frente a 14,29 %).                                                                                                             | MEDIDO               |
| EUR-30 | `math-evaluator.ts:30-35`; `tokenizer.ts:51-53`                                            | El exponente mayor que 12 da SYNTAX_ERROR sin explicación previa; `-2^2 = -4` no se comunica; `1.000` vale 1.                                                                                                                                                                    | MEDIDO               |
| EUR-31 | `all-exceptions.filter.ts`, `player-state.service.ts:29-37`                                | Un `GameStateError` en un mundo tumba todo `GET /progress` (solo con datos corruptos); P2002 da 500 sin reintento (hoy no es alcanzable).                                                                                                                                        | VERIFICADO (harness) |
| EUR-32 | `schema.prisma:511,513, 530`                                                               | Un usuario con puntos no se puede borrar (RESTRICT + trigger; el comentario de la migración dice lo contrario). `totalCorrectElapsedMs` es INT (desbordamiento teórico hacia ~14 800 aciertos).                                                                                  | VERIFICADO / TEÓRICO |
| EUR-33 | `attempt-analytics.service.ts:105,140`                                                     | Las lecturas del docente no liquidan intentos vencidos, así que el docente no ve el TIMEOUT de un alumno que no volvió (conocido).                                                                                                                                               | INSPECCIONADO        |
| EUR-34 | Web (varios)                                                                               | Ver la lista debajo.                                                                                                                                                                                                                                                             | INSPECCIONADO / VIVO |
| EUR-39 | `apps/web/src/services/api/client.ts:88-132`; `groups/teacher-groups.controller.ts:98-109` | Grupos y miembros solo se gestionan por API. Un alumno sin grupo no aparece en el panel docente y en la clasificación solo se ve a sí mismo. Para el piloto hace falta un script de alta. (BAJA-MEDIA, logística)                                                                | INSPECCIONADO        |
| EUR-40 | `common/configure-app.ts:28`                                                               | Swagger se expone sin condición, también en producción.                                                                                                                                                                                                                          | INSPECCIONADO        |

**Detalle de EUR-34 (web):**

- Salir a mitad de un reto no avisa de que el reloj sigue.
- El historial no muestra el motivo del fallo.
- «Mi progreso» abre por defecto el mundo con más puntos.
- Un intento retirado muestra «¡Tiempo agotado!» junto a «racha vuelve a empezar: 3».
- El texto de WRONG_RESULT en ecuaciones se sustituye por uno genérico y un decimal se muestra como «17/5».
- La trampa de foco del diálogo se puede escapar con un clic en el fondo.
- Falta `autoCorrect="off"`.
- El tamaño de 14 px en el campo provoca zoom en iOS (TEÓRICO).
- El `<title>` no cambia.
- La respuesta vacía no muestra ningún texto.
- Un error de red en `me()` cierra la sesión.
- Mezcla de «reto» y «desafío», y masculino genérico («BIENVENIDO»).
- Comentario desfasado en `feedback.ts:80-82` y documentación desalineada (`docs/architecture.md:176-178`, §9 del plan frente a los textos de `max-number`).

### D.4 Discrepancias entre auditores y cómo se resolvieron

| Tema                                                           | Posiciones                                                                                         | Resolución del orquestador                                                   | Motivo                                                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relleno neutro (EUR-01)                                        | Educación: ALTA. Matemáticas: decisión de producto. Revisor: decisión de producto con riesgo MEDIA | **Decisión de producto (impacto alto)**, a decidir antes del piloto          | La filosofía «letra de la regla» está documentada y el encargo pide no cambiar la semántica sin decisión de producto. El impacto medido justifica la urgencia |
| Farmeo con el reto 1 (EUR-02)                                  | Backend: ALTA. QA: MEDIA. Revisor: MEDIA + decisión                                                | **ALTA + decisión**                                                          | El camino por la interfaz es trivial. Las mitigaciones no violan el §2                                                                                        |
| Dificultad adaptativa (EUR-03)                                 | Educación: ALTA. Backend: MEDIA/decisión. Revisor: MEDIA                                           | **ALTA para (a)(c)(d); (b) es decisión**                                     | El fallo principal, que no ayuda a quien se atasca, invalida la función del sistema; el forzado está documentado como aceptado                                |
| Error de sintaxis (EUR-04)                                     | Frontend: ALTA. Matemáticas: MEDIA. Revisor: ALTA, prioridad 1                                     | **ALTA, prioridad 1**                                                        | Verificado en vivo; afecta a todos los alumnos                                                                                                                |
| «7 * 1» (EUR-05)                                               | Frontend: ALTA. Matemáticas: MEDIA. Revisor: ALTA                                                  | **ALTA**                                                                     | Verificado en vivo; el mensaje contradice lo que se ve; aparece en el 33–67 % de las secuencias del Mundo 1                                                   |
| Caché de mundos (EUR-06)                                       | Backend: ALTA. Revisor: BAJA                                                                       | **MEDIA** (BAJA si no se abren mundos por fases)                             | Hace falta SQL manual para dispararlo, pero el impacto es una caída general y la corrección de §11 no se sostiene                                             |
| Fallo que no enseña (EUR-08)                                   | Educación: MEDIA. Revisor: decisión                                                                | **Decisión de producto** con recomendación                                   | Ocultar el valor fue deliberado en §11                                                                                                                        |
| Móvil 320 px, NUL, cambio de catálogo (EUR-11, EUR-13, EUR-14) | Frontend, QA y backend: MEDIA. Revisor: BAJA                                                       | **BAJA**                                                                     | Impacto acotado: pocos dispositivos, sin corrupción, versión congelada en el piloto                                                                           |
| Veredicto                                                      | Orquestador: listo tras correcciones. Revisor: piloto controlado tras correcciones acotadas        | **LISTO TRAS CORRECCIONES**, con el alcance de piloto controlado del revisor | Coinciden en el fondo; la lista obligatoria se reequilibró hacia la operación (§G.1)                                                                          |

---

## E. Decisiones de producto

### E.1 La interpretación `n / 1` (y, en general, los elementos neutros)

- **Hechos (MEDIDO):** `n / 1` no es un caso aislado.
  - `n * 1`, `n − 0`, `n + 0`, `n ^ 1`, `n * 7 ^ 0`, `--n`, `n + 0.5 − 0.5`, `n * (1 + 0)` y `n + 0 + 0 + 0` cumplen sus reglas respectivas.
  - El generador nunca usa `/ 1` en sus soluciones (0 en 1,32 M): el propio diseño de las respuestas de referencia evita lo que el motor acepta.
- **Consecuencia:** toda regla «exigida» se convierte en «añade un sufijo». En los Mundos 1–3, hasta el 26 % de las secuencias Suaves se completan sin calcular nada.
- **Opciones:**
  - **Mantener.** Simple y coherente con «cumplir la letra», pero el atajo es universal y se contagia entre alumnos.
  - **Refinar.** Prohibir neutros (`/1`, `*1`, `±0`, `^0`, `^1`) y el enunciado completo dentro de la respuesta. Coste bajo y fácil de explicar; deja formas menos obvias (`+ (3 − 3)`).
  - **Reconsiderar.** Exigir piezas **esenciales**: quitarlas cambia el valor. Cierra el problema de raíz, pero complica el motor y los mensajes.
- **Recomendación:** **refinar antes del piloto** y evaluar «esencial» para la regla central de cada mundo. Como mínimo, documentar la decisión ante el equipo docente.

### E.2 Completar una secuencia en Suave desbloquea el mundo siguiente

- **Hechos:**
  - Suave son 3 retos y 2 reglas (3 en Caos), y el reto 1 es copiable.
  - Se puede forzar con 3 fallos deliberados (VIVO). El 26,4 % de las secuencias Suaves del Mundo 1 se superan sin calcular (MEDIDO). En Aritmética Suave, el 6,6 % de los sorteos son solo dos dígitos prohibidos.
  - Al terminar, la pantalla muestra «Reglas dominadas 2 / 6».
  - El forzado deliberado de Suave (fallar a propósito el reto 1) es una consecuencia que `docs/architecture.md:317` ya acepta. Esta auditoría aporta la medición de su coste: en vivo bastaron unos 5 minutos; con jugadores sintéticos, 3,7 fallos deliberados por mundo.
- **Contrapartidas:**
  - Un requisito más estricto (por ejemplo, Normal) bloquearía a alumnos que dominan 2 reglas pero no 3, y con el modelo de todo o nada eso frustra mucho (SIMULADO: el modelo CAP2 completa el Mundo 1 en ≤ 5 secuencias solo el 50,8 % de las veces).
  - Un requisito más laxo no certifica nada.
- **Opciones:**
  - (A) Mantener.
  - (B) Exigir Normal.
  - (C) Exigir N reglas dominadas del repertorio.
  - (D) Cada regla al menos una vez más una compleción.
  - (E) Desbloquear con Suave pero marcar el mundo «a medias» hasta completarlo en Normal.
  - (F) Que los fallos triviales del reto 1 no cuenten para bajar de nivel.
- **Recomendación:** **C o E, combinadas con F** y con la corrección de EUR-01 y EUR-03. Endurecer el requisito sin más no es mejor: aumenta la frustración sin cerrar los atajos.

### E.3 Comportamiento de la dificultad adaptativa

- **Hechos:** ver EUR-03. En la práctica funciona como dos estados: Normal hasta la primera compleción e Intensa después. Suave queda casi solo para quien falla el reto 1 o deja pasar el tiempo.
- **Recomendación:**
  - Una política **por secuencias**, con histéresis, que baje o suba un escalón cada vez: por ejemplo, dos secuencias fallidas en la posición ≥ 2 bajan un nivel y dos compleciones seguidas lo suben.
  - Excluir el reto 1 del rendimiento y tratar igual errores y tiempos agotados.
  - Valorar ocultar el nivel al alumno, por el estigma y porque delata cuándo ha funcionado la trampa.
  - Validar con el simulador (`sim.ts`) antes del piloto y con datos reales (`elapsedMs` y resultados ya se guardan) durante el piloto.

### E.4 Complejidad del Mundo 5

- **Hechos:**
  - Resoluble: 0 combinaciones imposibles; tiempos de 85–145 s.
  - Exigente en cantidad de reglas (3/4/5) pero no en integración de conceptos (ver §C).
  - El salto desde el Mundo 4 es brusco.
- **Recomendación:**
  - Buscar **síntesis** en lugar de más reglas: plantillas mixtas y ecuaciones con decimales o potencias.
  - Rampa de entrada (2 familias por secuencia en Suave).
  - Revisar las reglas restrictivas que castigan el despeje.
  - Mantener 3/4/5 solo si cada regla «cuesta» de verdad (tras E.1).

### E.5 Número de reglas por secuencia (1–4: 2/3/4; Caos: 3/4/5)

- **Teórico:** con el modelo de todo o nada, cada regla adicional multiplica el riesgo. Por ejemplo, con un acierto de 0,8 por regla, la probabilidad de completar una secuencia se divide aproximadamente por dos con cada regla extra (≈ 0,48 → 0,24 → 0,10 con 2/3/4 reglas). Mostrar las reglas en pantalla reduce la carga de memoria, no la de planificación.
- **Recomendación:** mantener 2/3/4 en los Mundos 1–4 **si** Suave llega a quien lo necesita (EUR-03). Dar a Caos una rampa (empezar en 2–3). **Recalibrar después** de cerrar los atajos (EUR-01), porque hoy las reglas «exigidas» casi no cuestan.

### E.6 Otras decisiones que conviene tomar explícitamente

1. **¿Un error de sintaxis es una «respuesta incorrecta»?** El §2.3 del plan lo hace fallo directo. Recomendación: no lo es; la expresión no se puede leer.
2. **¿La respuesta debe ser distinta del enunciado?** La instrucción no lo dice y el reto 1 acepta la copia.
3. **¿Mostrar la solución tras un fallo?** Recomendación: sí (EUR-08).
4. **Puntos y clasificación:** ponderar por dificultad o por reglas, o clasificar por compleciones o reglas dominadas.
5. **Arranque automático del reto siguiente** y **ajustes de tiempo** por accesibilidad.
6. **Notación de potencias** (`^`) y **teclado matemático en pantalla** para tabletas.

---

## F. Evaluación de riesgos en un piloto con alumnos

| Riesgo                                                                                  | Probabilidad                                                          | Impacto                                                              | Origen         | Mitigación                                                                        |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| Los alumnos descubren y comparten el atajo `× 1` / `/ 1` / copiar el reto 1             | Alta (los atajos son simples y contagiosos)                           | Alto: el piloto mide atajos, no aprendizaje; desbloqueos sin dominio | EUR-01, EUR-02 | Refinar las reglas (E.1); no puntuar el reto 1                                    |
| La clasificación se manipula con farmeo                                                 | Media-alta                                                            | Alto en motivación y convivencia del grupo                           | EUR-02         | Ocultar la clasificación en el piloto o cambiar su base; límite de peticiones     |
| Frustración por erratas que terminan secuencias                                         | Alta (alumnos de 11–15 años, teclados de tableta, notación `·`)       | Alto: abandono, sensación de injusticia                              | EUR-04         | SYNTAX_ERROR sin coste y normalización de notación                                |
| Fallo injusto con la regla «7 * 1»                                                      | Media (la regla sale en ~50 % de las secuencias Normales del Mundo 1) | Medio-alto: el alumno no entiende por qué ha fallado                 | EUR-05         | Aplanar cadenas o cambiar el texto                                                |
| El alumno que se atasca no recibe ayuda (Suave no llega) y se rinde                     | Media-alta                                                            | Alto en equidad                                                      | EUR-03         | Política por secuencias                                                           |
| Alumnos que fuerzan Suave para desbloquear                                              | Media                                                                 | Medio: el desbloqueo pierde significado                              | EUR-03, E.2    | F + C/E                                                                           |
| Sesión caducada al final de la clase                                                    | Alta si la clase dura ≥ 1 h                                           | Medio                                                                | EUR-12         | TTL de clase o renovación                                                         |
| Mapa caído para todos al habilitar mundos por etapas                                    | Baja (requiere SQL manual)                                            | Muy alto (caída general)                                             | EUR-06         | Los 5 mundos habilitados desde el inicio; reiniciar la API si se toca `isEnabled` |
| Móviles pequeños (320 px) ocultan la regla nueva                                        | Baja (si el piloto usa tabletas u ordenadores)                        | Medio                                                                | EUR-11         | Corregir el CSS o usar dispositivos ≥ 375 px                                      |
| Concurrencia real en PostgreSQL con pool > 1                                            | Baja (verificada en PostgreSQL 17 real, Anexo VII)                    | Medio-alto (integridad)                                              | §12 del plan   | Repetir la prueba de humo en la infraestructura del piloto                        |
| Alumnos que olvidan la contraseña y pierden su progreso                                 | Alta en un piloto de semanas                                          | Alto (abandono, cuentas duplicadas, sesgo en los datos)              | EUR-35         | Restablecimiento por docente o administrador antes del piloto                     |
| Bloqueo de inicio de sesión de clases enteras (IP compartida o proxy sin `TRUST_PROXY`) | Media                                                                 | Alto (clase entera sin jugar 1–15 min)                               | EUR-37         | Configuración del limitador y de `TRUST_PROXY`; prueba con la red del centro      |
| El docente no ve qué alumnos necesitan ayuda                                            | Alta                                                                  | Medio                                                                | EUR-36         | Excluir el reto 1 de las métricas                                                 |
| Datos de menores (nombre libre visible a compañeros, sin borrado ni consentimiento)     | Media                                                                 | Medio-alto (privacidad y cumplimiento)                               | EUR-38         | Procedimiento con el centro: alias, consentimiento, anonimización                 |
| Alumnos sin grupo, invisibles para el docente                                           | Media                                                                 | Medio                                                                | EUR-39         | Script de alta de grupos y alumnos                                                |
| Conclusiones del piloto sesgadas por los atajos                                         | Alta si no se corrige EUR-01                                          | Alto (decisiones de producto erróneas)                               | EUR-01, EUR-02 | Corregir antes, o instrumentar la detección de respuestas con neutros             |

---

## G. Plan de acción recomendado

### G.1 Imprescindible antes del piloto con alumnos

**Código (acotado):**

1. **EUR-04:** normalizar `x`/`X` entre operandos fuera de las ecuaciones, `·` y `∗` → `*`, `:` → `/` y `—` → `-`; prevalidación en el cliente con mensajes de sugerencia («para multiplicar usa *»). Mejor aún, que un error de sintaxis no consuma el intento (ver decisión 2).
2. **EUR-05:** aplanar las cadenas asociativas de `*` y `+` en `REQUIRED_OPERATION`, o cambiar el texto de la regla.
3. **EUR-35:** script o endpoint para que un docente o administrador restablezca la contraseña de un alumno.
4. **EUR-03 (a) + EUR-36:** excluir el reto 1 del rendimiento que mira la política de dificultad **y** de las métricas del panel docente (un único arreglo).

**Decisiones de producto que hay que tomar antes (ver §E):**

1. **EUR-01:** aceptar o refinar el relleno neutro. Si se acepta, al menos registrar y medir su uso durante el piloto.
2. **EUR-04:** ¿un error de sintaxis consume el intento?
3. **EUR-02:** ¿el reto 1 puntúa? ¿En qué se basa la clasificación, o se oculta durante el piloto?
4. **E.2:** requisito de desbloqueo (Suave forzado).
5. **EUR-08:** ¿mostrar la solución tras un fallo?

**Operación y configuración:**

1. `NODE_ENV=production`, un `JWT_SECRET` real, `CORS_ORIGIN`, `TRUST_PROXY` según la red y `LOGIN_MAX_ATTEMPTS_IP` / `LOGIN_MAX_ATTEMPTS_IP_EMAIL` ajustados (EUR-37).
2. `JWT_EXPIRES_IN_SECONDS` de al menos una jornada escolar (EUR-12).
3. **Prueba de humo en la infraestructura real del piloto** (BD gestionada, proxy y red del centro). En un PostgreSQL 17 local ya se hizo y salió limpia (Anexo VII); los scripts se pueden reutilizar.
4. Script de alta de grupos y alumnos (EUR-39).
5. Los 5 mundos habilitados desde el inicio y la versión congelada durante el piloto; reiniciar la API si se toca `worlds.isEnabled` (EUR-06, EUR-14).
6. Procedimiento de datos de menores con el centro: alias, consentimiento y anonimización al cierre (EUR-38).

### G.2 Conviene mejorar antes del piloto (barato y de alto rendimiento)

- **EUR-09:** tarjeta «cómo se juega» con un ejemplo resuelto la primera vez; mostrar tiempo y reglas en la tarjeta de inicio.
- **EUR-18:** que el diálogo de fallo muestre lo enviado; textos (descartadas frente a dominadas, multiplicador, dificultad, teclas `*` y `/`).
- **EUR-07:** alinear `REQUIRED_PARENTHESES` con «(-3)» y con su mensaje.
- **EUR-02 (técnico):** límite de peticiones en las rutas de juego.
- **EUR-13:** sanear el NUL y mapear el 413.
- **EUR-15:** contraste de los botones principales.
- **EUR-17:** ampliar las pruebas: planificador real en `game-flow`, matriz de roles del juego, casos frontera de la dificultad, `isEnabled` y E2E mínimo web ↔ API.
- **EUR-19:** margen de gracia de ~500 ms en el plazo.
- **EUR-11:** maquetación a 320 px (solo si el piloto usa móviles pequeños).
- **EUR-40:** ocultar Swagger en producción.
- Instrumentar el piloto: marcar las respuestas con elementos neutros o con el enunciado incrustado, para medir cuántos alumnos usan atajos.

### G.3 Decisiones de producto que requieren aprobación

1. `n / 1` y elementos neutros (E.1).
2. Requisito de desbloqueo (E.2).
3. Política adaptativa y visibilidad del nivel (E.3).
4. Diseño del Caos: síntesis frente a acumulación (E.4).
5. Número de reglas por mundo (E.5).
6. ¿Error de sintaxis = fallo? (E.6.1)
7. ¿Respuesta distinta del enunciado? (E.6.2)
8. ¿Mostrar la solución tras un fallo? (E.6.3)
9. Base de puntos y clasificación (E.6.4).
10. Arranque automático y ajustes de tiempo por accesibilidad (E.6.5).
11. Notación de potencias y teclado en pantalla (E.6.6).

### G.4 Puede esperar a después del piloto

- **EUR-10** completo (nuevas plantillas mixtas del Caos), **EUR-16** (pesos del generador), recalibrado de tiempos con datos reales de `elapsedMs`.
- **EUR-06** en código (caché sin `isEnabled`) y **EUR-14** (huella del catálogo por secuencia).
- **EUR-20** (`Promise.all` antes de `pg@9`), **EUR-21** (Swagger), **EUR-22** (truncar valores), **EUR-23–EUR-33**, **EUR-34** (pulido web), accesibilidad avanzada (lector de pantalla, avisos de tiempo).
- Correo transaccional real para la recuperación autónoma de contraseñas.
- Migración apta para despliegue en caliente (documentada como no apta; no afecta a un piloto con BD nueva).

---

## H. Veredicto final

### **LISTO TRAS CORRECCIONES**

El piloto procede tras las correcciones y decisiones de §G.1, y como **piloto controlado**:

- 1–2 clases;
- docente presente y operador disponible;
- versión congelada y los 5 mundos habilitados;
- instrumentación para medir el uso de atajos.

El revisor principal independiente coincide en el fondo («listo para piloto controlado tras correcciones acotadas»).

**Por qué no «NO LISTO».**

- No hay hallazgos críticos: no hay pérdida de datos, compromiso de seguridad ni corrupción matemática.
- El motor matemático está verificado a gran escala y la integridad de progreso, puntos y secuencias es sólida.
- Se jugó el producto entero en vivo, de la cuenta nueva al Mundo 5, sin bloqueos.
- Las correcciones de código imprescindibles son cuatro y locales (notación y erratas, `7 * 1`, restablecer contraseñas, excluir el reto 1 de las métricas). El resto son configuración, procedimientos y decisiones de producto que ya tienen opciones analizadas.

**Por qué no «LISTO PARA PILOTO CONTROLADO» tal como está hoy.**

- Sin las correcciones y decisiones de §G.1, un piloto mediría sobre todo los atajos:
  - el 26 % de las secuencias de desbloqueo del Mundo 1 se superan sin calcular;
  - la dificultad se puede forzar;
  - la clasificación se puede farmear.
- Además, castigaría a los alumnos por erratas y por una regla defectuosa (7 * 1) en el primer mundo.
- Las conclusiones de ese piloto (motivación, dificultad, aprendizaje) no serían fiables, y los fallos injustos dañarían la primera impresión de alumnos y docentes.

**Por qué no «CANDIDATO A PRODUCCIÓN».**

- La concurrencia ya está verificada en PostgreSQL 17 local, pero no en la infraestructura de producción (red, proxy, BD gestionada, carga sostenida durante horas).
- Falta la operación segura de mundos en caliente (EUR-06).
- Falta validación con estudiantes reales de tiempos, dificultad y comprensión.
- Que pasen las pruebas automáticas no lo demuestra: las propias pruebas fijan algunos de los comportamientos problemáticos (`7 * 1`, la `x` fuera de ecuaciones) y no ejercitan el planificador real en el flujo principal.

---

## Anexo I. Verificaciones ejecutadas

| Comprobación                                            | Comando                                                    | Resultado                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tipos (API + web)                                       | `npm run typecheck`                                        | OK                                                                                   |
| Lint                                                    | `npx eslint .`                                             | OK                                                                                   |
| Formato                                                 | `npx prettier --check .`                                   | Solo falla `pnpm-lock.yaml` (archivo sin seguimiento previo del usuario; no se tocó) |
| Build de producción (API + web)                         | `npm run build`                                            | OK                                                                                   |
| Pruebas unitarias de la API                             | `jest --selectProjects unit`                               | 38 suites, **685** pruebas OK                                                        |
| Integración de la API (PGlite)                          | `npm run test:integration`                                 | 18 suites, **247** pruebas OK                                                        |
| Web                                                     | `vitest run`                                               | 8 archivos, **146** pruebas OK                                                       |
| Validación masiva del generador (agente de matemáticas) | `batch.ts 20000`                                           | 300 000 secuencias y 1 320 000 retos: **0 fallos**                                   |
| Exhaustivo de órdenes de reglas                         | `exhaustive.ts 40`                                         | 187 200 planes: 0 fallos salvo 150 en Caos Suave (EUR-29)                            |
| Paréntesis: motor frente a «quitar y reparsear»         | `rules-probe.ts`                                           | 200 000 expresiones, 0 discrepancias                                                 |
| Atajos sin calcular (orquestador)                       | `trivial-split.ts`, `trivial-seq.ts`                       | Ver §C                                                                               |
| Complejidad y tiempos (agente educativo)                | `measure.ts` (30 000 secuencias)                           | Ver §C y el Anexo III                                                                |
| Simulación de la política (agente educativo)            | `sim.ts` (17 modelos × 4 000 jugadores)                    | Ver §E y el Anexo III                                                                |
| Escenarios HTTP en vivo (agente de QA)                  | `s01`–`s13` contra la API compilada + PGlite               | Ver el Anexo IV                                                                      |
| Juego en navegador real (orquestador)                   | API compilada + PGlite + Vite + navegador de Orca          | Ver el Anexo IV                                                                      |
| Despliegue de migraciones en PostgreSQL 17.12 real      | `prisma migrate deploy` + `prisma migrate status`          | 5 migraciones aplicadas; «Database schema is up to date» (PG-REAL)                   |
| Deriva BD desplegada ↔ `schema.prisma`                  | `prisma migrate diff --from-config-datasource --to-schema` | **No difference detected** (PG-REAL)                                                 |
| Suite de integración en PostgreSQL real, pool 10        | Jest con configuración temporal fuera del repositorio      | 18 suites, **247** pruebas OK en 74 s (PG-REAL)                                      |
| Carreras, carga, ráfagas e invariantes                  | `races.mjs`, `load.mjs`, `burst.mjs`, `invariants.mjs`     | Ver el Anexo VII (PG-REAL)                                                           |

## Anexo II. Orquestación

| Agente                            | Responsabilidad                                                                                                                                  | Método                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Orquestador (sesión principal)    | Contexto, verificación de repo y suites, medición propia de atajos, juego en vivo en el navegador, verificación cruzada de hallazgos y redacción | Ejecución y lectura                                                                    |
| Auditor de backend e integridad   | Arquitectura, ciclo de vida de secuencias, transacciones, idempotencia, desbloqueo, migraciones, seguridad, contrato                             | Harness con el `GameService` real sobre PGlite + inspección                            |
| Auditor matemático                | Parser, evaluador, reglas, generador, planificador                                                                                               | Verificador independiente (BigInt, parser propio), lotes masivos, entradas adversarias |
| Auditor educativo y de dificultad | Progresión, conceptos por mundo, tiempos, política adaptativa                                                                                    | Medición con el planificador real + simulación con jugadores sintéticos                |
| Auditor de frontend y UX          | Recorrido del alumno en 12 pasos, accesibilidad, contrato                                                                                        | Lectura de `apps/web` + módulos puros ejecutados + lista para verificar en vivo        |
| QA adversarial                    | Escenarios HTTP en vivo, robustez, cobertura de las pruebas                                                                                      | API compilada + PGlite + mutación de pruebas                                           |
| Revisor principal independiente   | Refutar y recalibrar los hallazgos ALTOS, buscar huecos, contrastar el veredicto                                                                 | Lectura + comprobaciones puntuales                                                     |

Todos los agentes trabajaron en **solo lectura**. El entorno no les permitió escribir sus informes en disco: los devolvieron
como mensajes y el orquestador los consolidó. Los scripts, logs y capturas están en la carpeta temporal de la sesión
(`…/scratchpad/agents/{backend,math,education,frontend,qa}/` y `…/scratchpad/orchestrator/`). No forman parte del proyecto.

## Anexo III. Datos medidos y simulados

**Último reto de cada secuencia** (MEDIDO; 2 000 secuencias por combinación). Columnas:

- Valor: magnitud del resultado (mediana · p90).
- Referencia: longitud de la solución de referencia en caracteres (mediana · p90 · máximo).
- Fluido: mediana del tiempo estimado (s) para un alumno con soltura.
- En desarrollo: mediana del tiempo estimado (s) y porcentaje de retos que superarían el límite, para un alumno lento.

Las dos últimas columnas son una heurística con constantes inventadas y solo sirven para ordenar el riesgo.

| Mundo · nivel        | Reglas | Límite (s) | Valor     | Referencia    | Fluido | En desarrollo |
| -------------------- | ------ | ---------- | --------- | ------------- | ------ | ------------- |
| Aritmética · Suave   | 2      | 75         | 32 · 100  | 17 · 25 · 35  | 44     | 84 · 76 %     |
| Aritmética · Normal  | 3      | 90         | 60 · 257  | 21 · 30 · 47  | 60     | 116 · 99 %    |
| Aritmética · Intensa | 4      | 105        | 111 · 468 | 26 · 37 · 55  | 72     | 141 · 100 %   |
| Signos · Normal      | 3      | 95         | 30 · 182  | 20 · 30 · 45  | 57     | 110 · 85 %    |
| Fracciones · Normal  | 3      | 100        | 6 · 34    | 22 · 34 · 75  | 63     | 122 · 91 %    |
| Álgebra · Normal     | 3      | 110        | 11 · 41   | 19 · 28 · 47  | 73     | 142 · 93 %    |
| Caos · Suave         | 3      | 115        | 8 · 50    | 22 · 34 · 66  | 65     | 127 · 77 %    |
| Caos · Normal        | 4      | 130        | 10 · 90   | 29 · 43 · 90  | 79     | 155 · 92 %    |
| Caos · Intensa       | 5      | 145        | 16 · 121  | 38 · 53 · 109 | 95     | 186 · 99 %    |

Lectura: el alumno con soltura va holgado en todas partes. El alumno lento se queda sin tiempo en los retos finales.
**Hay que validarlo con datos reales del piloto** (`elapsedMs` ya se guarda).

**Simulación de la política** (SIMULADO). La probabilidad de acierto depende de la posición, de las reglas y del nivel, y
el 30 % de los fallos son tiempos agotados.

| Modelo sintético                 | Completa el M1 en ≤ 5 secuencias | Completa el M5 en ≤ 60 secuencias | % de compleciones en Suave (M1) |
| -------------------------------- | -------------------------------- | --------------------------------- | ------------------------------- |
| Experto (≈ 0,999 · 0,99^r)       | 100 %                            | 100 %                             | 0 %                             |
| RL80 (0,98 · 0,8^r)              | 70,5 %                           | 99,7 %                            | 0,5 %                           |
| RL70                             | 41 %                             | 74,5 %                            | 0,7 %                           |
| CAP2 (domina 2 reglas)           | 50,8 %                           | 69,6 %                            | 1,8 %                           |
| CAP1 (domina 1 regla)            | 9,5 %                            | 16,7 %                            | 1,8 %                           |
| Táctico (falla adrede el reto 1) | 96,2 %                           | 100 %                             | 100 %                           |

Ningún modelo completa un mundo por primera vez en Intensa. La rama de Intensa por precisión no decide ninguna secuencia.

## Anexo IV. Recorridos en vivo

**Navegador** (orquestador; cuenta nueva y cuentas demo):

1. Registro → mapa de 5 mundos. Solo el Mundo 1 aparece disponible, con el requisito de cada mundo bloqueado indicado claramente. El texto de bienvenida habla de reglas descartadas y dominadas sin explicar la mecánica.
2. «Jugar» → tarjeta «Empezar desafío» (el cronómetro no arranca hasta pulsar: correcto).
3. Reto 1, `4 × 7`: copiado tal cual → «¡Correcto!» +100.
4. El reto 2 arranca solo. Con la regla de paréntesis, `(2 + 4) × 8` → correcto, +150 (×1,5).
5. Reto 3, errata `… × 6 +` → «¡Secuencia terminada!» con las reglas descartadas tachadas y «Qué conservas» (puntos, racha 0).
6. Tiempo agotado real a los 60 s → diálogo correcto.
7. Tercer fallo → la siguiente secuencia es «Suave», con 3 retos, sin explicación.
8. Suave completada sin calcular → «¡Descubrimiento logrado! Nuevo mundo desbloqueado».
9. Caos con la cuenta demo F: decimales, potencias, coma decimal `0,5` aceptada, ecuaciones y aviso de `x =` correcto. Tiempos de 85/85/100/115/130 s.
10. Clasificación por mundo con podio.
11. Móvil: a 375×667, 3 y 5 reglas caben; a 320×568, con 5 reglas, la nueva queda oculta. El diálogo de fallo en móvil es correcto, pero no muestra lo enviado.
12. Mundo 1 con `7 * 1`: `2 * 9 * 7 * 1 / 7` → «Debes usar la operación 7 * 1».

**HTTP** (agente de QA, con el orquestador en el caso del NUL):

- **PASS:**
  - camino feliz (libro de puntos 100/150/200/250 = 700 y desbloqueo);
  - segunda partida en Intensa;
  - respuesta incorrecta;
  - tiempo agotado y reto vencido estando ausente;
  - 6 envíos idénticos concurrentes → 1 fila en el libro y el resto con `replayed`;
  - 20 peticiones mixtas sin ningún 5xx;
  - IDOR → 404 y roles → 403;
  - entradas de 10 KB y 10 000 niveles de anidamiento → 400 en ≤ 3 ms; `9^9^9` acotado;
  - 14 invariantes de BD al final.
- **FALLOS u observaciones:** NUL → 500; 1 MB → 500; farmeo; Suave forzado; respuesta en un mundo re-bloqueado (solo reparando datos); plazo sin margen.

## Anexo V. Comprobado como correcto (no requiere acción)

- **Aritmética exacta:**
  - `0.1 + 0.2 = 3/10`;
  - `2^53 + 1 − 2^53 = 1` con literales;
  - `-3^2 = -9` y `2^3^2 = 512` (convenios documentados);
  - `2^-1 = 1/2`;
  - `0^0` indefinido y `0^-1`, división entre cero;
  - potencias acotadas antes de calcular.
- **Ecuaciones:** solución única y exacta (299 813 comprobadas). La `x` en la respuesta se rechaza con un mensaje claro.
- **Plan de secuencia:** determinista por semilla (`crypto.randomInt`). Se guarda entero, sin exponer la semilla ni las soluciones. Se planifica rápido (p99 ≤ 1,8 ms).
- **Persistencia y concurrencia:**
  - una transición = una transacción con `FOR UPDATE` sobre la fila de progreso;
  - idempotencia con relectura, `UPDATE … WHERE PENDING` y `attemptId` único;
  - índices únicos parciales y CHECKs;
  - libro de puntos de solo inserción;
  - 4 `startAttempt` simultáneos → 1 secuencia;
  - en PostgreSQL 17 real con pool 10: 20 `startAttempt` simultáneos → 1 secuencia y 1 intento, en 8 repeticiones (Anexo VII).
- **Plazos y seguridad:**
  - el servidor es la única fuente de tiempo, con la frontera `<=` coherente;
  - el cronómetro del cliente se basa en `remainingMs` (inmune al desfase de reloj);
  - sin IDOR, con roles globales, `MaxLength(200)`, `forbidNonWhitelisted` y `ParseUUIDPipe`;
  - `WRONG_RESULT` ya no revela el valor esperado.
- **Contrato:** sin deriva campo a campo entre los DTO de la API y `apps/web/src/services/api/types.ts`.
- **Correcciones de la revisión anterior (§11):** se sostienen el aviso de reto vencido, el desbloqueo comprobado en cada reto, la tarjeta de inicio y el aviso de `x`. No se sostiene «mundo habilitado» (EUR-06).

## Anexo VI. Limitaciones de esta auditoría

- **Sin estudiantes reales.** Las conclusiones sobre tiempos y dificultad son mediciones del generador, simulaciones sintéticas o razonamiento pedagógico. Ningún dato de rendimiento estudiantil fue inventado.
- **PostgreSQL real, pero local.** La concurrencia se verificó en PostgreSQL 17.12 (Docker) con pool 10 en la misma máquina que la API y el cliente. No se probó la red real, un proxy, una BD gestionada ni carga sostenida durante horas.
- **Ráfagas en una sola máquina:** macOS limita la cola de conexiones TCP pendientes (`somaxconn = 128`), así que la ráfaga de 600 peticiones se ejecutó con un máximo de 120 en vuelo (Anexo VII).
- **El juego en navegador y los escenarios del agente de QA** usaron PGlite. Las pruebas en PostgreSQL real fueron por HTTP y con la suite de integración.
- **Navegador:** se usó el navegador integrado de Orca (Chromium) a 1280, 375 y 320 px. No se probaron dispositivos iOS ni Android reales, ni lectores de pantalla.
- **`prisma migrate diff --from-migrations`** no se pudo usar sin añadir `shadowDatabaseUrl` a `prisma.config.ts`. Se comparó en su lugar la BD desplegada con `migrate deploy` contra el esquema, que es equivalente para detectar deriva.
- **Los atajos medidos son cotas inferiores** (conjunto pequeño de envoltorios). No miden cuántos alumnos los descubrirían.
- **El panel docente** solo se revisó en lo que afecta a los datos del juego.

## Anexo VII. Verificación en PostgreSQL 17 real (PG-REAL)

**Entorno:**

- Contenedor desechable `postgres:17-alpine` (PostgreSQL 17.12, `TimeZone=UTC`, `max_connections=200`, `log_lock_waits=on` con umbral de 200 ms), ligado a 127.0.0.1 y eliminado al terminar (`--rm`). No se usaron `docker-compose.yml` ni ningún `.env` del repositorio.
- API compilada (`apps/api/dist/main.js`) con `DATABASE_POOL_MAX` sin fijar, es decir, el pool por defecto de `pg` de 10 conexiones, igual que en producción.
- Catálogo sembrado con `prisma/seed.ts`.
- Scripts en la carpeta temporal de la sesión (`…/scratchpad/orchestrator/realpg/`), fuera del proyecto.

**1. Migraciones y esquema:**

- `prisma migrate deploy` aplica las 5 migraciones sin errores.
- `prisma migrate diff` de la BD desplegada frente a `schema.prisma`: **sin diferencias**.
- Existen todas las garantías escritas a mano:
  - 6 índices únicos parciales: un intento PENDING, una secuencia ACTIVE y una sesión abierta por alumno y mundo, más los de grupos y tokens;
  - 19 restricciones CHECK;
  - 4 triggers, incluidos los del libro de puntos de solo inserción (UPDATE y DELETE).

**2. Suite de integración existente con pool 10:** 18 suites y **247/247** pruebas OK. Los 4 archivos de migración usan internamente su propio PGlite.

**3. Carreras del mismo alumno** (`races.mjs`, 8 repeticiones × 20 peticiones simultáneas, 800 en total):

| Escenario                                                                                                  | Respuestas             | Invariante comprobado                                                                              | Resultado |
| ---------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- | --------- |
| T1: 20 «iniciar sesión» en el primer acceso a un mundo                                                     | 152×200, 8×201         | 1 fila de progreso, 1 sesión abierta, `created=true` una sola vez                                  | OK        |
| T2: 20 «iniciar reto» (crea la secuencia)                                                                  | 152×200, 8×201         | 1 secuencia, 1 intento PENDING, el mismo `attemptId` para todos                                    | OK        |
| T3: 20 respuestas correctas idénticas                                                                      | 160×200                | 1 con `replayed:false`; **1 fila** en el libro                                                     | OK        |
| T4: 10 correctas + 10 incorrectas                                                                          | 80×200, 80×409         | 1 ganadora; reenvíos de la misma expresión → 200; distinta → 409; libro coherente con el resultado | OK        |
| T5: respuesta + 5 «iniciar reto» + 5 lecturas de progreso + 3 «reto actual» + fin de sesión + nueva sesión | 107×200, 6×201, 15×409 | ≤ 1 PENDING y ≤ 1 ACTIVE                                                                           | OK        |

Cero 5xx. En el log de PostgreSQL no hubo interbloqueos ni esperas de bloqueo de 200 ms o más.

**4. Carga: alumnos jugando a la vez sin pausas** (`load.mjs`; 12 respuestas por alumno, 20 % incorrectas, lecturas de progreso y clasificación tras cada respuesta). Latencias en ms.

| Alumnos | Peticiones | Duración | Errores | Responder p50/p95/máx | Progreso p50/p95/máx | Retraso de `submittedAt` p50/p99/máx |
| ------- | ---------- | -------- | ------- | --------------------- | -------------------- | ------------------------------------ |
| 30      | 1 514      | 2,2 s    | 0       | 62 / 90 / 101         | 57 / 82 / 100        | —                                    |
| 60      | 3 025      | 4,1 s    | 0       | 121 / 150 / 164       | 118 / 183 / 227      | 106 / 144 / 150                      |

Es una carga muy superior a la de una clase real, porque no hay tiempo de reflexión. El retraso con el que el servidor fecha la respuesta (EUR-19) se queda en ≤ 150 ms incluso así.

**5. Ráfagas simultáneas** (`burst.mjs`; cada alumno lanza a la vez responder, progreso, siguiente reto y clasificación):

| Ráfaga                                                    | Resultado                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 50 alumnos (200 peticiones)                               | 0 errores; todas resueltas en 327 ms                                                                                                                                                                                                                                                                                             |
| 150 alumnos (600 peticiones), sin límite en el cliente    | 245 fallos de **red del cliente**. macOS tiene `somaxconn = 128`: la cola TCP de la máquina se desborda antes de que la petición llegue a la API. La API no registró ningún error, siguió sana y los intentos procesados son coherentes (90 aciertos = 90 filas del libro). Es un artefacto del banco de pruebas, no un defecto. |
| 150 alumnos (600 peticiones) con 120 en vuelo como máximo | **0 errores**; máximo de 1 025 ms; 150 aciertos = 150 filas del libro; 0 intentos colgados                                                                                                                                                                                                                                       |

La espera máxima de conexión de las transacciones (`maxWait` de 5 s) quedó lejos en todos los casos.

**6. Invariantes globales tras todas las pruebas** (`invariants.mjs`, sobre 448 alumnos, 1 669 intentos, 741 secuencias y 1 205 filas del libro). **0 violaciones** en los 14:

1. caché de puntos = suma del libro;
2. una fila del libro por acierto;
3. ninguna fila para un intento no acertado;
4. puntos del intento = puntos del libro;
5. como mucho una secuencia ACTIVE, un intento PENDING y una sesión abierta por alumno y mundo;
6. `completionsCount` = secuencias COMPLETED;
7. aciertos dentro del plazo;
8. secuencias COMPLETED con todas sus posiciones acertadas;
9. secuencias FAILED con un fallo;
10. posición del intento = posición del reto;
11. un intento por reto;
12. racha guardada = racha recalculada desde el historial.

**Conclusión:**

- El diseño de concurrencia (bloqueo `FOR UPDATE` por fila de progreso, `UPDATE … WHERE PENDING` e índices únicos parciales) se sostiene en PostgreSQL real con varias conexiones. La limitación del §12 del plan queda cubierta a nivel local.
- Lo que falta es repetir la prueba en la infraestructura concreta del piloto.
- Recomendación: añadir a CI la ejecución de la suite de integración contra PostgreSQL real (como aquí).
