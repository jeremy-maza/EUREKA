/** Clave de `localStorage` del token de acceso. Cambiarla cerraría la sesión de todos los usuarios. */
const TOKEN_KEY = 'eureka.token';

/** Persistencia del token de acceso (JWT) entre recargas de la página. */
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null): void {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* almacenamiento no disponible: la sesión solo dura mientras la pestaña esté abierta */
    }
  },
};
