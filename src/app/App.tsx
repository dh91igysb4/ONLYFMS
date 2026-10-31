import { BrowserRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from '../platform/auth/AuthProvider.tsx'
import { useAppearance } from './appearance.ts'
import { AppRoutes } from './routes.tsx'

function AppearanceSync() {
  const { profile } = useAuth()
  useAppearance(profile?.palette, profile?.appearance)
  return null
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppearanceSync />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
