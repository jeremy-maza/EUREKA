# Datos de demostración

Cuentas y escenarios **reproducibles** para demostrar el juego sin crear cuentas a mano ni jugar cada caso.
**Solo desarrollo.** No hay ningún endpoint de demo: son scripts de línea de comandos que usan el motor real.

## Cómo funciona

- Los datos se generan **jugando contra el `GameService` real** con un reloj retrasado (intentos, libro de puntos,
  estadísticas y reglas desbloqueadas son los que produce el juego; no hay filas escritas a mano ni respuestas
  simuladas en el frontend). Código: [`apps/api/prisma/demo/`](../apps/api/prisma/demo).
- Es **determinista**: mismas cuentas, respuestas y resultados en cada ejecución (solo cambian ids y marcas de tiempo,
  calculadas relativas al momento de ejecutar).
- **Aislamiento:** solo se tocan cuentas cuyo correo termina en `@demo.eureka.local` y el grupo demo que ellas crearon.
  Nunca se lee, modifica ni borra otro usuario. El grupo demo se conserva si tiene algún miembro que no sea cuenta demo.
- **Producción:** ambos comandos se niegan a ejecutarse con `NODE_ENV=production`. El código vive en `prisma/` (fuera de
  `src/`), así que no forma parte de `apps/api/dist`.

## Comandos

```bash
npm run db:up && npm run db:migrate && npm run db:seed   # requisito: el catálogo del Mundo 1
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

| Esc. | Cuenta (`@demo.eureka.local`) | Estado inicial                                                                            | Qué demuestra                                                                                                |
| ---- | ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A    | `demo.a.nuevo`                | Sin progreso, 0 puntos, racha 0, 0 reglas                                                 | Jugador nuevo: el reto 1 sale sin reglas; la 1.ª regla aparece en el reto 2                                  |
| B    | `demo.b.progreso`             | 3 aciertos: 450 pts, racha 3, 2 reglas, siguiente ×2,5; reto 4 sin empezar                | Reglas que se acumulan: el reto 4 muestra 3 reglas (la nueva resaltada) y puntos 100 → 150 → 200 → 250       |
| C    | `demo.c.fallo`                | Falló el reto 4 (valor correcto, reglas rotas): racha 0, mejor racha 3, 450 pts, 2 reglas | Fallo: racha a 0, puntos históricos intactos; al reiniciar, el reto 1 ya trae las 2 reglas activas           |
| D    | `demo.d.avanzado`             | Mundo 1 completado 2 veces: 2 200 pts, racha 8, 3 reglas, siguiente ×5                    | Pantalla final y «Jugar de nuevo»: 3 reglas desde el reto 1; el primer acierto vale ×5 (tope) = 500 pts      |
| E    | `demo.e.expirado`             | Reto 3 abierto hace 12 min y sin responder (plazo vencido); 250 pts, 1 regla              | Al entrar, el servidor lo cierra por TIMEOUT: aviso «Tiempo agotado», racha 0, conserva puntos y regla       |
| —    | `demo.docente`                | Docente del «Grupo Demo»                                                                  | Panel docente y clasificación con los 5 estudiantes demo (la clasificación solo compara compañeros de grupo) |

Respuestas válidas con todas las reglas (para jugar los escenarios): `7 * 1 * 3`, `7 * 1 * 6`, `7 * 1`, `7 * 1 * 4 + 3 * 4`.
Para provocar un fallo: una sintaxis inválida (`3 *`), un resultado erróneo (`22`) o una regla rota (`21 * 2`).

> Cada escenario se «gasta» al jugarlo (cambia su progreso); ejecuta `npm run db:seed:demo` para restaurarlo.
> El escenario E depende del tiempo: se genera ya vencido, por lo que siempre se muestra el TIMEOUT al entrar.

## Pruebas

`apps/api/test/integration/demo-fixtures.int-spec.ts` ejecuta el seeder sobre PostgreSQL (PGlite) y comprueba cada
escenario **a través de la API HTTP real**, la reproducibilidad (dos ejecuciones → mismo estado), el aislamiento de
usuarios reales (incluido un correo parecido), la conservación del trigger del libro de puntos y la negativa en producción.
