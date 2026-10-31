import { Route, Routes } from 'react-router-dom'
import { LoginPage } from '../platform/auth/LoginPage.tsx'
import { WelcomePage } from '../platform/auth/WelcomePage.tsx'
import { RequireAdmin, RequireApproved } from '../platform/auth/Guard.tsx'
import { Layout } from '../platform/layout/Layout.tsx'
import { AdminPage } from './placeholders.tsx'
import { LeaderboardPage } from '../platform/leaderboard/LeaderboardPage.tsx'
import { ProfilePage } from '../platform/profile/ProfilePage.tsx'
import { HomePage } from '../platform/games/HomePage.tsx'
import { DailyPage } from '../platform/games/DailyPage.tsx'
import { FreePage } from '../platform/games/FreePage.tsx'
import { ContestListPage } from '../platform/contests/ContestListPage.tsx'
import { ContestNewPage } from '../platform/contests/ContestNewPage.tsx'
import { ContestPage } from '../platform/contests/ContestPage.tsx'
import { ContestItemPage } from '../platform/contests/ContestItemPage.tsx'
import { JoinPage } from '../platform/contests/JoinPage.tsx'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route element={<RequireApproved><Layout /></RequireApproved>}>
        <Route path="/" element={<HomePage />} />
        <Route path="/play/:game/daily" element={<DailyPage />} />
        <Route path="/play/:game/free" element={<FreePage />} />
        <Route path="/contests" element={<ContestListPage />} />
        <Route path="/contests/new" element={<ContestNewPage />} />
        <Route path="/contests/:id" element={<ContestPage />} />
        <Route path="/contests/:id/:position" element={<ContestItemPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/u/:handle" element={<ProfilePage />} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
      </Route>
    </Routes>
  )
}
