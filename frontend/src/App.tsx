import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthContext'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { RequireRole } from '@/features/auth/RequireRole'
import { AuthPage } from '@/features/auth/pages/AuthPage'
import { ClassificationsPage } from '@/features/classifications/pages/ClassificationsPage'
import { GamePage } from '@/features/game/pages/GamePage'
import { ResultsPage } from '@/features/game/pages/ResultsPage'
import { HomePage } from '@/features/home/pages/HomePage'
import { TeacherDashboardPage } from '@/features/teacher/pages/TeacherDashboardPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/acceso" element={<AuthPage mode="login" />} />
          <Route path="/registro" element={<AuthPage mode="register" />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<HomePage />} />
            <Route element={<RequireRole role="STUDENT" />}>
              <Route path="/juego" element={<GamePage />} />
              <Route path="/final" element={<ResultsPage />} />
              <Route path="/clasificaciones" element={<ClassificationsPage />} />
            </Route>
            <Route element={<RequireRole role="TEACHER" />}>
              <Route path="/docente" element={<TeacherDashboardPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
