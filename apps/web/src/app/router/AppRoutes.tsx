import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthContext';
import { RequireAuth } from '@/features/auth/components/RequireAuth';
import { RequireRole } from '@/features/auth/components/RequireRole';
import { AuthPage } from '@/features/auth/pages/AuthPage';
import { GamePage } from '@/features/game/pages/GamePage';
import { ResultsPage } from '@/features/game/pages/ResultsPage';
import { HomePage } from '@/features/home/pages/HomePage';
import { LeaderboardPage } from '@/features/leaderboard/pages/LeaderboardPage';
import { ProgressPage } from '@/features/progress/pages/ProgressPage';
import { TeacherDashboardPage } from '@/features/teacher/pages/TeacherDashboardPage';

/** Rutas de la aplicación. Se exporta sin router para poder montarla con `MemoryRouter` en las pruebas. */
export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/acceso" element={<AuthPage mode="login" />} />
        <Route path="/registro" element={<AuthPage mode="register" />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<HomePage />} />
          <Route element={<RequireRole role="STUDENT" />}>
            <Route path="/juego" element={<GamePage />} />
            <Route path="/final" element={<ResultsPage />} />
            <Route path="/progreso" element={<ProgressPage />} />
            <Route path="/clasificaciones" element={<LeaderboardPage />} />
          </Route>
          <Route element={<RequireRole role="TEACHER" />}>
            <Route path="/docente" element={<TeacherDashboardPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
