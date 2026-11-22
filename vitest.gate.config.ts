// 느린 통과 게이트(*.gate.test.ts)만 도는 설정: `npm run test:gate`. 기본 설정(vitest.config.ts)은 이 파일들을 뺀다.
// mergeConfig는 배열을 이어 붙이므로, 기본 설정의 include·exclude를 비운 뒤 합친다.
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.ts'

const { include: _include, exclude: _exclude, ...baseTest } = base.test ?? {}

export default mergeConfig(
  { ...base, test: baseTest },
  defineConfig({ test: { include: ['src/**/*.gate.test.ts'], exclude: [...configDefaults.exclude] } }),
)
