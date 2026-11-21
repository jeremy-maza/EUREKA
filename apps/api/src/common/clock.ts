/**
 * Fuente de tiempo del SERVIDOR. Todo instante que determine plazos o intentos sale de aquí
 * (nunca del cliente). Es inyectable para poder controlar el reloj en las pruebas.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
