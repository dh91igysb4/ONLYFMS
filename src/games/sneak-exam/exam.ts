// 시드 하나로 정해지는 시험: 어떤 문제가, 어떤 정답으로, 어떤 감독관과 함께 나오는지.
import { N_CHOICE, N_Q, PROCTORS } from './constants.ts'
import { QUESTIONS } from './questions.ts'
import { nextRng, rngInt, seedInt } from './rng.ts'

export type Exam = { questionIds: number[]; answers: number[]; proctorType: 0 | 1 | 2; rng0: number }

const CACHE_SIZE = 8
const cache = new Map<string, Exam>()

function build(seed: string): Exam {
  // 문제 고르기: 부분 피셔-예이츠(앞 N_Q개만 섞는다).
  const pool = QUESTIONS.map((q) => q.id)
  let r = seedInt(seed, 1)
  for (let i = 0; i < N_Q; i++) {
    r = nextRng(r)
    const j = i + rngInt(r, pool.length - i)
    const t = pool[i]
    pool[i] = pool[j]
    pool[j] = t
  }
  const questionIds = pool.slice(0, N_Q)

  // 정답 번호는 문구와 무관하게 시드로만 정한다.
  const answers: number[] = []
  r = seedInt(seed, 2)
  for (let i = 0; i < N_Q; i++) {
    r = nextRng(r)
    answers.push(rngInt(r, N_CHOICE))
  }

  const proctorType = rngInt(nextRng(seedInt(seed, 3)), PROCTORS.length) as 0 | 1 | 2
  return { questionIds, answers, proctorType, rng0: seedInt(seed, 4) }
}

// seed별 캐시(최근 8개). 반환 객체는 읽기 전용으로 쓴다.
export function getExam(seed: string): Exam {
  const hit = cache.get(seed)
  if (hit) {
    cache.delete(seed)
    cache.set(seed, hit)
    return hit
  }
  const exam = build(seed)
  cache.set(seed, exam)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  return exam
}
