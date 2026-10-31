import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // CSS 원문을 ?raw로 읽는 테스트(palettes.test.ts)용: 기본값은 CSS를 빈 문자열로 바꾼다
    css: { include: [/\.css\?raw$/] },
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'supabase/functions/play/engine.test.ts'],
  },
})
