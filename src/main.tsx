import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import '@fontsource/exo-2/latin-800-italic.css'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './app/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
