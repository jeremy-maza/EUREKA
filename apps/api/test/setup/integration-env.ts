// `TEST_DATABASE_URL` la fija el globalSetup de PGlite antes de crear los workers.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Una sola conexión: PGlite comparte sesión y, además, detecta consultas fuera de transacción dentro de una.
process.env.DATABASE_POOL_MAX = '1';
// Las pruebas fijan la IP del cliente con `X-Forwarded-For` (un salto de proxy de confianza).
process.env.TRUST_PROXY = '1';
