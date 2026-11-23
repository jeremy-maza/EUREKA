# Datos de demostración

Cuentas y escenarios **reproducibles** para demostrar el juego sin crear cuentas a mano ni jugar cada caso.
**Solo desarrollo.** No hay ningún endpoint de demo: son scripts de línea de comandos que usan el motor real.

## Cómo funciona

- Los datos se generan **jugando contra el `GameService` real** con un reloj retrasado (intentos, libro de puntos,
  estadísticas, secuencias y reglas dominadas son los que produce el juego; no hay filas escritas a mano ni respuestas
  simuladas en el frontend). Código: [`apps/api/prisma/demo/`](../apps/api/prisma/demo).
- Es **determinista**: mismas cuentas, respuestas y resultados en cada ejecución (solo cambian ids y marcas de tiempo,
  calculadas relativas al momento de ejecutar).
- **Aislamiento:** solo se tocan cuentas cuyo correo termina en `@demo.eureka.local` y el grupo demo que ellas crearon.
  Nunca se lee, modifica ni borra otro usuario. El grupo demo se conserva si tiene algún miembro que no sea cuenta demo.
- **Producción:** ambos comandos se niegan a ejecutarse con `NODE_ENV=production`. El código vive en `prisma/` (fuera de
  `src/`), así que no forma parte de `apps/api/dist`.

## Comandos

```bash
npm run db:up && npm run db:migrate && npm run db:seed   # requisito: el catálogo de los 5 mundos
npm run db:seed:demo                                     # (re)crea las cuentas y escenarios demo
npm run db:demo:reset                                    # elimina SOLO las cuentas demo y lo que cuelga de ellas
```

`db:seed:demo` es idempotente: borra antes los datos demo anteriores y los vuelve a crear en su estado inicial (úsalo
para «volver a empezar» tras una demostración). Contraseña de todas las cuentas: `demo-eureka-2026`
(cámbiala con la variable de entorno `DEMO_PASSWORD` al ejecutar el seed).

> El libro de puntos es de solo inserción (trigger de la base de datos). Para borrar las cuentas demo, `db:demo:reset`
> desactiva ese trigger **dentro de una transacción** y **solo** elimina filas de ids demo; el trigger queda activo
> (hay una prueba que lo comprueba). Requiere que `DATABASE_URL` sea de un rol propietario de las tablas (el de desarrollo).

## Escenarios

Las secuencias se planifican con semillas fijas por escenario, así que qué reglas tocan (y en qué orden) es siempre lo mismo
en cada ejecución, aunque distinto entre escenarios.

| Esc. | Cuenta (`@demo.eureka.local`) | Estado inicial                                                                                     | Qué demuestra                                                                                                |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A    | `demo.a.nuevo`                | Sin progreso; solo el Mundo 1 desbloqueado                                                         | Jugador nuevo: el reto 1 sale sin reglas; los mundos 2–5 aparecen bloqueados (403 si se intenta entrar)      |
| B    | `demo.b.progreso`             | Mundo 1: 3 aciertos, 450 pts, racha 3, 2 reglas dominadas; reto 4 sin empezar                      | Reglas que se acumulan dentro de la secuencia: el reto 4 muestra 3 reglas (la nueva resaltada)               |
| C    | `demo.c.fallo`                | Mundo 1: falló el reto 4 rompiendo reglas: racha 0, mejor racha 3, 450 pts                         | Fallo: reglas de la secuencia descartadas, puntos intactos; la siguiente secuencia sortea reglas nuevas      |
| D    | `demo.d.avanzado`             | Mundo 1 completado 2 veces (2.ª en dificultad intensa): 2 700 pts, racha 9, ×5; Mundo 2 completado | Dificultad adaptativa, «Jugar de nuevo» (el primer acierto vale ×5 = 500 pts) y Mundo 3 desbloqueado         |
| E    | `demo.e.expirado`             | Mundo 1: reto 3 abierto hace 12 min y sin responder (plazo vencido); 250 pts                       | Al entrar, el servidor lo cierra por TIMEOUT: aviso «Tiempo agotado», racha 0, reglas descartadas            |
| F    | `demo.f.explorador`           | Mundos 1–4 completados (700 pts en cada uno)                                                       | Mundo 5 (Caos matemático) desbloqueado: decimales, potencias y ecuaciones mezclados                          |
| —    | `demo.docente`                | Docente del «Grupo Demo»                                                                           | Panel docente y clasificación con los 6 estudiantes demo (la clasificación solo compara compañeros de grupo) |

Para provocar un fallo: una sintaxis inválida (`3 *`), un resultado erróneo o una regla rota (desde el reto 2, enviar el
enunciado tal cual siempre rompe alguna regla). Las soluciones de referencia están en `sequence_challenges` (solo para
depurar: nunca se exponen por la API).

> Cada escenario se «gasta» al jugarlo (cambia su progreso); ejecuta `npm run db:seed:demo` para restaurarlo.
> El escenario E depende del tiempo: se genera ya vencido, por lo que siempre se muestra el TIMEOUT al entrar.

## Pruebas

`apps/api/test/integration/demo-fixtures.int-spec.ts` ejecuta el seeder sobre PostgreSQL (PGlite) y comprueba cada
escenario **a través de la API HTTP real**, la reproducibilidad (dos ejecuciones → mismo estado), el aislamiento de
usuarios reales (incluido un correo parecido), la conservación del trigger del libro de puntos y la negativa en producción.
