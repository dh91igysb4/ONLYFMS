import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // CSS 원문을 ?raw로 읽는 테스트(palettes.test.ts)용: 기본값은 CSS를 빈 문자열로 바꾼다
    css: { include: [/\.css\?raw$/] },
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts', 'supabase/functions/play/engine.test.ts'],
    // 느린 통과 게이트는 `npm run test:gate`(vitest.gate.config.ts)로 따로 돈다
    exclude: [...configDefaults.exclude, '**/*.gate.test.ts'],
  },
})
