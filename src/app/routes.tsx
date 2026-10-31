import { Route, Routes } from 'react-router-dom'
import { LoginPage } from '../platform/auth/LoginPage.tsx'
import { WelcomePage } from '../platform/auth/WelcomePage.tsx'
import { RequireAdmin, RequireApproved } from '../platform/auth/Guard.tsx'
import { Layout } from '../platform/layout/Layout.tsx'
import { AdminPage, ContestsPage, HomePage, LeaderboardPage, ProfilePage } from './placeholders.tsx'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route element={<RequireApproved><Layout /></RequireApproved>}>
        <Route path="/" element={<HomePage />} />
        <Route path="/contests" element={<ContestsPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/u/:handle" element={<ProfilePage />} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
      </Route>
    </Routes>
  )
}
