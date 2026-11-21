// `TEST_DATABASE_URL` la fija el globalSetup de PGlite antes de crear los workers.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Una sola conexión: PGlite comparte sesión y, además, detecta consultas fuera de transacción dentro de una.
process.env.DATABASE_POOL_MAX = '1';
