// Variables mínimas para arrancar AppModule en tests (nunca son secretos reales).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-only-secret-that-is-at-least-32-chars-long';
