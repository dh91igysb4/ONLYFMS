import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../platform/auth/AuthProvider.tsx'
import { AppRoutes } from './routes.tsx'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
