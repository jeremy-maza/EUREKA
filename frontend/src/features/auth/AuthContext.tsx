import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from '@/shared/api/client'
import type { UserProfile } from '@/shared/api/types'

type AuthState = {
  /** `loading` mientras se valida un token guardado; `anonymous` sin sesión. */
  status: 'loading' | 'anonymous' | 'authenticated'
  user: UserProfile | null
  /** `true` si el servidor rechazó el token guardado (sesión caducada o revocada). */
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<void>
  /** Crea la cuenta y entra directamente. */
  register: (email: string, displayName: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [status, setStatus] = useState<AuthState['status']>(() => (tokenStore.get() ? 'loading' : 'anonymous'))

  const clear = useCallback(() => {
    tokenStore.set(null)
    setUser(null)
    setStatus('anonymous')
  }, [])

  const expire = useCallback(() => {
    clear()
    setSessionExpired(true)
  }, [clear])

  useEffect(() => {
    setUnauthorizedHandler(expire)
    return () => setUnauthorizedHandler(null)
  }, [expire])

  // Restaura la sesión al recargar la página.
  useEffect(() => {
    if (!tokenStore.get()) return
    let cancelled = false
    api
      .me()
      .then((profile) => {
        if (cancelled) return
        setUser(profile)
        setStatus('authenticated')
      })
      .catch(() => {
        if (!cancelled) clear()
      })
    return () => {
      cancelled = true
    }
  }, [clear])

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken } = await api.login({ email, password })
    tokenStore.set(accessToken)
    try {
      setUser(await api.me())
      setSessionExpired(false)
      setStatus('authenticated')
    } catch (error) {
      tokenStore.set(null)
      throw error
    }
  }, [])

  const register = useCallback(
    async (email: string, displayName: string, password: string) => {
      await api.register({ email, displayName, password })
      await login(email, password)
    },
    [login],
  )

  const logout = useCallback(async () => {
    try {
      await api.logout() // revoca la sesión en el servidor; si falla, igualmente se cierra en local
    } catch {
      /* sin conexión o token ya inválido */
    }
    clear()
  }, [clear])

  const value = useMemo<AuthState>(
    () => ({ status, user, sessionExpired, login, register, logout }),
    [status, user, sessionExpired, login, register, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>.')
  return context
}
