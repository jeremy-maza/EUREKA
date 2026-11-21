import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { GamePage } from '@/features/game/pages/GamePage'
import { ResultsPage } from '@/features/game/pages/ResultsPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GamePage />} />
        <Route path="/juego" element={<GamePage />} />
        <Route path="/final" element={<ResultsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
