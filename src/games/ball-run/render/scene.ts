// 볼 런 Three.js 장면(설계 §6.2, v2 §4). React를 쓰지 않는다. 시뮬은 읽기만 한다.
// 좌표: 시뮬 mm → 장면 m(÷1000). 장면 x = 시뮬 x, y = 시뮬 y, z = -시뮬 z(three 카메라 기본 시선이 -z라서
// 공 뒤에서 앞을 볼 때 시뮬 +x가 화면 오른쪽이 되도록 z만 뒤집는다).
// 장면 내부 색은 theme 토큰 규칙의 승인된 예외다.
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Texture,
  WebGLRenderer,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { G, R, ROW } from '../constants.ts'
import type { Course, SegmentInfo } from '../course.ts'
import type { SimState } from '../sim.ts'
import { colOf, floorAt, rowOf } from '../sim.ts'
import { BANK_ANGLE, CAM_BACK, LOOK_AHEAD, bankOffset, buildingsFor, cameraTarget, segmentBoxes } from './layout.ts'
import type { Box } from './layout.ts'
import {
  BALL_COLOR, CHEVRON_P, CHEVRON_W, FLOOR_COLOR, FLOOR_LINE, WINDOW_H, WINDOW_W, ballEnvTexture, blockTexture, buildingTexture,
  chevronTexture, gridTexture, shadowTexture, wallTexture,
} from './textures.ts'

const BG = '#000000'
const BEAM_COLOR = '#e258f4'
const SHARD_COLORS = ['#ff4fd8', '#ff8be6', '#4fd8ff', '#9ff0ff', '#ffffff']

const M = 1 / 1000
const AHEAD_ROWS = 90
const BEHIND_ROWS = 10
const FOG_NEAR = 25
const FOG_FAR = 90
const CAM_Y_RATE = 9 // 카메라 높이 보간(1/s). 단차·낙하에서 덜컹이지 않게.
const VFOV = 48 // 세로 시야각(°)
const FALL_MAX_TICKS = 180
const BUILDING_DEPTH = 60 // 건물은 조각 base에서 이만큼(m) 아래부터 세운다.
const BUILDING_LEAN = (7 * Math.PI) / 180 // 건물 윗부분이 바깥으로 기우는 각
const WALL_H = 2.2 // 터널 마젠타 벽 높이(m)
const WALL_OUT = 0.9 // 벽 위 가장자리가 바깥으로 기우는 정도(m)
const ARCH_SIDES = 7 // 아치 다각형 변 수
const ARCH_RIB = 1.5 // 아치 판 격자 길이(m)
const BEAM_SECONDS = 2
const BEAM_FADE = 0.5
const BEAM_LEN = 9
const BEAM_W = 1.0 // 공 지름보다 조금 넓게(녹화)
const SHARDS = 24
const SHARD_SECONDS = 1
const MAX_DPR = 2

export type SceneHandle = {
  render(prev: SimState, cur: SimState, alpha: number): void
  resize(w: number, h: number, dpr: number): void
  dispose(): void
}

type SegmentMeshes = { meshes: Mesh[]; geometries: BufferGeometry[] }

// 면마다 UV를 실제 길이 ÷ 무늬 한 장 크기로 늘린 상자(텍스처는 RepeatWrapping). BoxGeometry 면 순서: +x, -x, +y, -y, +z, -z.
function tiledBox(w: number, h: number, d: number, cu: number, cv: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d)
  const uv = g.getAttribute('uv')
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k
      uv.setXY(i, (uv.getX(i) * spans[f][0]) / cu, (uv.getY(i) * spans[f][1]) / cv)
    }
  }
  return g
}

// z0 → z1(장면 z)로 뻗는 띠들. 단면 점 [x, y] 사이마다 사각형 하나, u는 z 길이 ÷ uLen, v는 0..vRep.
function extrude(points: [number, number][], z0: number, z1: number, uLen: number, vRep: number): BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const u1 = Math.abs(z1 - z0) / uLen
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[i + 1]
    const n = pos.length / 3
    pos.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1)
    uv.push(0, 0, 0, vRep, u1, vRep, u1, 0)
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// 결정적 난수(화면 연출용). [0, 1).
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function createScene(canvas: HTMLCanvasElement, course: Course): SceneHandle {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true })
  } catch (e) {
    throw new Error(`WebGL을 만들 수 없어요: ${e instanceof Error ? e.message : String(e)}`)
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR))
  renderer.setClearColor(BG)

  const scene = new Scene()
  scene.background = new Color(BG)
  scene.fog = new Fog(BG, FOG_NEAR, FOG_FAR)

  const camera = new PerspectiveCamera(VFOV, 1, 0.1, FOG_FAR + 20)

  // 바닥·건물·블록은 조명 없는 평면색(원작처럼). 조명은 공 광택에만 쓴다.
  scene.add(new HemisphereLight('#ffd0f4', '#20103a', 0.3))
  const sun = new DirectionalLight('#ffffff', 0.9)
  sun.position.set(-3, 6, 8)
  scene.add(sun)

  // ---- 공유 자원(조각마다 다시 만들지 않는다)
  const textures: Texture[] = []
  const tex = <T extends Texture>(t: T): T => {
    textures.push(t)
    return t
  }
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const grid = tex(gridTexture())
  grid.anisotropy = aniso
  const buildingTex = tex(buildingTexture())
  buildingTex.anisotropy = aniso
  const blockTex = tex(blockTexture())
  const wallTex = tex(wallTexture())
  wallTex.anisotropy = aniso
  const chevronTex = tex(chevronTexture())
  chevronTex.anisotropy = aniso
  const envTex = tex(ballEnvTexture())
  const shadowTex = tex(shadowTexture())

  // 바닥 상자: 윗면(+y, 인덱스 12..17)만 격자, 나머지 면은 라벤더 옆면.
  const unitBox = new BoxGeometry(1, 1, 1)
  const floorBox = new BoxGeometry(1, 1, 1)
  floorBox.clearGroups()
  floorBox.addGroup(0, 12, 0)
  floorBox.addGroup(12, 6, 1)
  floorBox.addGroup(18, 18, 0)

  const floorSideMat = new MeshBasicMaterial({ color: FLOOR_LINE })
  const floorTopMat = new MeshBasicMaterial({ map: grid })
  // 터널 바닥은 격자 없이 남색(위에 화살표). 옆면도 같은 색이라 칸 사이 이음매가 비치지 않는다.
  const tunnelTopMat = new MeshBasicMaterial({ color: FLOOR_COLOR })
  const blockMat = new MeshBasicMaterial({ map: blockTex })
  const lintelMat = new MeshBasicMaterial({ map: grid })
  const buildingMat = new MeshBasicMaterial({ map: buildingTex })
  const archMat = new MeshBasicMaterial({ map: grid, side: DoubleSide })
  const wallMat = new MeshBasicMaterial({ map: wallTex, side: DoubleSide })
  const chevronMat = new MeshBasicMaterial({
    map: chevronTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  const ballMat = new MeshStandardMaterial({
    color: BALL_COLOR, metalness: 0.45, roughness: 0.2, envMap: envTex, envMapIntensity: 1.3,
  })
  const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  const beamMat = new MeshBasicMaterial({
    color: BEAM_COLOR, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  })
  const shardMat = new MeshBasicMaterial({ color: '#ffffff' })
  const materials: Material[] = [
    floorSideMat, floorTopMat, tunnelTopMat, blockMat, lintelMat, buildingMat, archMat, wallMat, chevronMat, ballMat, shadowMat, beamMat, shardMat,
  ]

  const ballGeo = new SphereGeometry(R * M, 40, 28)
  const shadowGeo = new CircleGeometry(R * M * 1.2, 24)
  const beamGeo = new PlaneGeometry(BEAM_W, BEAM_LEN)
  beamGeo.rotateX(-Math.PI / 2)
  beamGeo.translate(0, 0, BEAM_LEN / 2) // 공 바닥에서 뒤(+z, 카메라 쪽)로 바닥에 깔린다(공이 앞쪽 끝을 가린다)
  const geometries: BufferGeometry[] = [unitBox, floorBox, ballGeo, shadowGeo, beamGeo]

  // 블록 높이별 상자(1 m 무늬가 세로로 반복되게). 기둥 3 m, 문 2 m, 블록 1 m.
  const blockGeos = new Map<number, BoxGeometry>()
  function blockGeo(h: number): BoxGeometry {
    let g = blockGeos.get(h)
    if (!g) {
      g = tiledBox(1, h * M, 1, 1, 1)
      blockGeos.set(h, g)
      geometries.push(g)
    }
    return g
  }

  const ball = new Mesh(ballGeo, ballMat)
  scene.add(ball)
  const shadow = new Mesh(shadowGeo, shadowMat)
  shadow.renderOrder = 1
  shadow.rotation.order = 'ZXY' // 눕힌(X) 다음 기운 판만큼 굴린다(Z).
  scene.add(shadow)
  const beam = new Mesh(beamGeo, beamMat)
  beam.visible = false
  beam.renderOrder = 2
  scene.add(beam)
  const shards = new InstancedMesh(unitBox, shardMat, SHARDS)
  shards.visible = false
  shards.frustumCulled = false
  {
    const c = new Color()
    for (let i = 0; i < SHARDS; i++) shards.setColorAt(i, c.set(SHARD_COLORS[i % SHARD_COLORS.length]))
  }
  scene.add(shards)

  // ---- 조각 메시
  const tmp = new Object3D()
  tmp.rotation.order = 'ZXY'
  const segments = new Map<number, SegmentMeshes>()

  function instanced(geo: BufferGeometry, mat: Material | Material[], count: number, fill: (i: number) => void): InstancedMesh {
    const mesh = new InstancedMesh(geo, mat, count)
    for (let i = 0; i < count; i++) {
      tmp.position.set(0, 0, 0)
      tmp.rotation.set(0, 0, 0)
      tmp.scale.set(1, 1, 1)
      fill(i)
      tmp.updateMatrix()
      mesh.setMatrixAt(i, tmp.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    return mesh
  }

  // 기운 판: 같은 행에서 이어진 같은 방향 칸들을 한 판으로 보고, 판 윗면 가운데를 축으로 ±BANK_ANGLE 굴린다.
  // 칸 상자는 굴린 면을 따라 늘어놓는다. 반환: 칸 상자마다 [판 가운데 x(mm), 굴림 각(rad, three z축)].
  function bankPlanks(floors: Box[]): Map<Box, [number, number]> {
    const out = new Map<Box, [number, number]>()
    const banked = floors.filter((b) => b.bank !== undefined).sort((a, b) => a.cz - b.cz || a.cx - b.cx)
    for (let i = 0; i < banked.length; ) {
      let j = i + 1
      while (
        j < banked.length && banked[j].cz === banked[i].cz && banked[j].bank === banked[i].bank &&
        banked[j].cy === banked[i].cy && banked[j].cx === banked[j - 1].cx + 1000
      ) j++
      const pc = (banked[i].cx + banked[j - 1].cx) / 2
      const roll = -(banked[i].bank as number) * BANK_ANGLE // bank +1(오른쪽이 낮음) → +x가 내려가게
      for (let k = i; k < j; k++) out.set(banked[k], [pc, roll])
      i = j
    }
    return out
  }

  function buildTunnel(info: SegmentInfo, meshes: Mesh[], geos: BufferGeometry[]): void {
    // 터널 안쪽 행(이음 행 제외)은 평평한 7칸이다.
    const r0 = info.startRow + 1
    const r1 = info.startRow + info.length - 1
    const f = course.cell(0, r0).floor
    if (r1 <= r0 || f === null) return
    const y = f.h0 * M
    const z0 = -r0 * ROW * M
    const z1 = -r1 * ROW * M
    const half = 3.5
    const topX = half + WALL_OUT
    const topY = y + WALL_H
    for (const s of [-1, 1]) {
      const g = extrude([[s * half, y], [s * topX, topY]], z0, z1, 1, 1)
      geos.push(g)
      meshes.push(new Mesh(g, wallMat))
    }
    // 아치: 벽 위 가장자리 두 점을 잇는 반원 다각형.
    const pts: [number, number][] = []
    for (let i = 0; i <= ARCH_SIDES; i++) {
      const a = Math.PI - (i * Math.PI) / ARCH_SIDES
      pts.push([Math.cos(a) * topX, topY + Math.sin(a) * topX * 0.85])
    }
    const arch = extrude(pts, z0, z1, ARCH_RIB, 1)
    geos.push(arch)
    meshes.push(new Mesh(arch, archMat))
    // 바닥 가속 화살표(투명 판). 앞쪽 끝에서 무늬가 시작하게 v를 길이 ÷ 한 장 길이만큼 반복한다.
    const len = Math.abs(z1 - z0)
    const chev = new PlaneGeometry(CHEVRON_W, len)
    const uv = chev.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) - 1) * (len / CHEVRON_P))
    chev.rotateX(-Math.PI / 2)
    chev.translate(0, y + 0.002, (z0 + z1) / 2)
    geos.push(chev)
    const cm = new Mesh(chev, chevronMat)
    cm.renderOrder = 1
    meshes.push(cm)
  }

  function buildSegment(info: SegmentInfo): SegmentMeshes {
    const meshes: Mesh[] = []
    const geos: BufferGeometry[] = []
    const boxes = segmentBoxes(course, info)
    const floors = boxes.filter((b) => b.kind === 'floor')
    const blocks = boxes.filter((b) => b.kind === 'block')
    const lintels = boxes.filter((b) => b.kind === 'lintel')
    const planks = bankPlanks(floors)

    if (floors.length > 0) {
      const floorMats = info.kind === 'tunnel' ? [tunnelTopMat, tunnelTopMat] : [floorSideMat, floorTopMat]
      meshes.push(instanced(floorBox, floorMats, floors.length, (i) => {
        const b = floors[i]
        const half = (b.h / 2) * M
        const top = b.cy * M + half
        const plank = planks.get(b)
        if (plank) {
          // 판 가운데 윗면을 축으로 굴린 면 위에 칸을 놓는다(윗면 가운데가 굴린 면 위, 상자 중심은 법선 반대로 두께 절반).
          const [pc, roll] = plank
          const off = (b.cx - pc) * M
          tmp.rotation.z = roll
          tmp.position.set(pc * M + off * Math.cos(roll) + Math.sin(roll) * half, top + off * Math.sin(roll) - Math.cos(roll) * half, -b.cz * M)
          tmp.scale.set(b.w * M, b.h * M, b.d * M)
          return
        }
        // 경사 칸: 윗면 가운데가 칸 가운데 바닥 높이에 오도록, 기울인 법선 방향으로 두께 절반만큼 내린다.
        const angle = Math.atan2(b.slope, ROW)
        tmp.rotation.x = angle
        tmp.position.set(b.cx * M, top - Math.cos(angle) * half, -b.cz * M - Math.sin(angle) * half)
        tmp.scale.set(b.w * M, b.h * M, (Math.hypot(ROW, b.slope) / ROW) * b.d * M)
      }))
    }
    // 블록은 높이별로 묶는다(무늬가 1 m마다 반복되도록 높이별 geometry).
    const byH = new Map<number, Box[]>()
    for (const b of blocks) byH.set(b.h, [...(byH.get(b.h) ?? []), b])
    for (const [h, list] of byH) {
      meshes.push(instanced(blockGeo(h), blockMat, list.length, (i) => {
        const b = list[i]
        tmp.position.set(b.cx * M, b.cy * M, -b.cz * M)
      }))
    }
    for (const b of lintels) {
      const g = tiledBox(b.w * M, b.h * M, b.d * M, 1, 1)
      g.translate(b.cx * M, b.cy * M, -b.cz * M)
      geos.push(g)
      meshes.push(new Mesh(g, lintelMat))
    }

    const buildings = buildingsFor(course.seed, info.startRow, info.startRow + info.length)
    if (buildings.length > 0) {
      const base = info.base * M
      const lean = Math.tan(BUILDING_LEAN)
      const parts: BufferGeometry[] = []
      for (const k of buildings) {
        // 트랙 높이 아래는 곧게, 위는 바깥으로 기울인다(원작 화면의 바깥으로 벌어지는 고층 건물).
        const w = k.w * M
        const d = k.d * M
        const cx = k.cx * M
        const cz = -k.cz * M
        const lower = tiledBox(w, BUILDING_DEPTH, d, WINDOW_W, WINDOW_H)
        lower.translate(cx, base - BUILDING_DEPTH / 2, cz)
        const h = k.h * M
        const upper = tiledBox(w, h, d, WINDOW_W, WINDOW_H)
        upper.translate(cx, base + h / 2, cz)
        const pos = upper.getAttribute('position')
        const side = Math.sign(cx)
        for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + side * (pos.getY(i) - base) * lean)
        parts.push(lower, upper)
      }
      const merged = mergeGeometries(parts)
      for (const p of parts) p.dispose()
      if (merged) {
        geos.push(merged)
        meshes.push(new Mesh(merged, buildingMat))
      }
    }

    if (info.kind === 'tunnel') buildTunnel(info, meshes, geos)

    for (const m of meshes) scene.add(m)
    return { meshes, geometries: geos }
  }

  function dropSegment(s: SegmentMeshes): void {
    // 공유 geometry·material은 그대로 두고, 조각마다 만든 인스턴스 버퍼·geometry만 해제한다.
    for (const m of s.meshes) {
      scene.remove(m)
      if (m instanceof InstancedMesh) m.dispose()
    }
    for (const g of s.geometries) g.dispose()
  }

  let lastRow = Number.NaN
  function updateSegments(z: number): void {
    const row = rowOf(z)
    if (row === lastRow) return
    lastRow = row
    const want = course.segmentsBetween(row - BEHIND_ROWS, row + AHEAD_ROWS)
    const keep = new Set(want.map((s) => s.startRow))
    for (const [start, s] of segments) {
      if (!keep.has(start)) {
        dropSegment(s)
        segments.delete(start)
      }
    }
    for (const info of want) if (!segments.has(info.startRow)) segments.set(info.startRow, buildSegment(info))
  }

  // ---- 깨짐 조각: 공 자리에서 바깥·위로 흩어지고 1초 뒤 멈춘다.
  type Shard = { p: [number, number, number]; v: [number, number, number]; s: number; spin: [number, number] }
  function makeShards(seed: number, vz: number): Shard[] {
    const rnd = lcg(seed * 2654435761)
    const out: Shard[] = []
    for (let i = 0; i < SHARDS; i++) {
      // 구 안 무작위 방향
      const th = rnd() * Math.PI * 2
      const ph = Math.acos(2 * rnd() - 1)
      const dir: [number, number, number] = [Math.sin(ph) * Math.cos(th), Math.abs(Math.cos(ph)), Math.sin(ph) * Math.sin(th)]
      const sp = 1.5 + rnd() * 3.5
      const r = R * M * (0.3 + rnd() * 0.6)
      out.push({
        p: [dir[0] * r, dir[1] * r, dir[2] * r],
        // 진행 방향(-z) 속도는 부딪혀 거의 잃고 조금만 남긴다.
        v: [dir[0] * sp, 1 + dir[1] * sp, dir[2] * sp - vz * 0.15],
        s: 0.12 + rnd() * 0.16,
        spin: [rnd() * 12 - 6, rnd() * 12 - 6],
      })
    }
    return out
  }

  // ---- 카메라·연출 상태
  let camEyeY = Number.NaN
  let camLookY = Number.NaN
  let lastT = Number.NaN
  let lastLevel = Number.NaN
  let boostAt = Number.NEGATIVE_INFINITY
  let death: null | { kind: 'hit' | 'fall' | 'give_up'; t0: number; from: SimState; eyeY: number; lookY: number; shards: Shard[] } = null

  function render(prev: SimState, cur: SimState, alpha: number): void {
    const now = performance.now()
    const dt = Number.isNaN(lastT) ? 0 : Math.min(0.1, Math.max(0, (now - lastT) / 1000))
    lastT = now
    const a = Math.min(1, Math.max(0, alpha))
    let x = prev.x + (cur.x - prev.x) * a
    let y = prev.y + (cur.y - prev.y) * a
    let z = prev.z + (cur.z - prev.z) * a

    // 가속 빛줄기: 속도 단계가 오르면 2초.
    if (Number.isNaN(lastLevel) || cur.speedLevel < lastLevel) lastLevel = cur.speedLevel
    else if (cur.speedLevel > lastLevel) {
      lastLevel = cur.speedLevel
      boostAt = now
    }

    if (cur.dead === null) death = null
    else if (death === null || death.kind !== cur.dead) {
      death = {
        kind: cur.dead, t0: now, from: cur,
        eyeY: Number.isNaN(camEyeY) ? (cur.y + R) * M : camEyeY,
        lookY: Number.isNaN(camLookY) ? cur.y * M : camLookY,
        shards: cur.dead === 'hit' ? makeShards(cur.tick + 1, cur.vz * M * 60) : [],
      }
    }
    let showBall = true
    if (death) {
      const t = (now - death.t0) / 1000
      const s = death.from
      x = s.x
      y = s.y
      z = s.z
      if (death.kind === 'hit') showBall = false
      else if (death.kind === 'fall') {
        const ticks = Math.min(FALL_MAX_TICKS, t * 60)
        y = s.y + s.vy * ticks - (G * ticks * ticks) / 2
        z = s.z + s.vz * ticks
      }
    }

    updateSegments(z)

    // 기운 판 위에서는 굴린 면 높이에 맞춰 공을 그린다(시뮬 바닥은 칸 높이 그대로).
    const grounded = death === null ? cur.grounded : death.kind !== 'fall'
    const bankDy = grounded ? bankOffset(course, x, z) : 0
    const bx = x * M
    const by = (y + bankDy) * M
    const bz = -z * M
    ball.position.set(bx, by, bz)
    ball.rotation.x = -z / R // 굴러간 거리 / 반지름 (진행 방향 -z)
    ball.visible = showBall

    // 그림자: 바닥 위에서만, 높이 뜰수록 옅게. 경사·기운 판만큼 기울인다.
    const fy = floorAt(course, x, z)
    const lift = fy === null ? Infinity : y - R - fy
    if (fy === null || lift > 2500 || lift < -R || !showBall) shadow.visible = false
    else {
      const c = course.cell(colOf(x), rowOf(z))
      const f = c.floor
      const angle = f ? Math.atan2(f.h1 - f.h0, ROW) : 0
      shadow.visible = true
      shadow.position.set(bx, (fy + bankDy) * M + 0.005, bz)
      shadow.rotation.set(angle - Math.PI / 2, 0, c.bank !== undefined ? -c.bank * BANK_ANGLE : 0)
      shadowMat.opacity = Math.min(1, Math.max(0, 1 - lift / 2500))
    }

    // 깨짐 조각
    if (death?.kind === 'hit') {
      const t = Math.min(SHARD_SECONDS, (now - death.t0) / 1000)
      const floorY = fy === null ? -Infinity : fy * M
      shards.visible = true
      death.shards.forEach((sh, i) => {
        const px = bx + sh.p[0] + sh.v[0] * t
        const py = Math.max(floorY + sh.s / 2, by + sh.p[1] + sh.v[1] * t - 4.9 * t * t)
        const pz = bz + sh.p[2] + sh.v[2] * t
        tmp.position.set(px, py, pz)
        tmp.rotation.set(sh.spin[0] * t, sh.spin[1] * t, 0)
        tmp.scale.setScalar(sh.s)
        tmp.updateMatrix()
        shards.setMatrixAt(i, tmp.matrix)
      })
      shards.instanceMatrix.needsUpdate = true
    } else shards.visible = false

    // 가속 빛줄기
    const bt = (now - boostAt) / 1000
    if (bt >= 0 && bt < BEAM_SECONDS && showBall && death === null) {
      beam.visible = true
      beam.position.set(bx, by - R * M + 0.01, bz)
      beamMat.opacity = 0.65 * Math.min(1, (BEAM_SECONDS - bt) / BEAM_FADE)
    } else beam.visible = false

    // 카메라: x는 공 x 그대로, 높이(눈·시선)만 시간 기준으로 보간한다. 낙하 중에는 높이를 고정한다.
    // 시선은 공 앞 LOOK_AHEAD의 바닥 높이 쪽이라 내리막에서 아래로 숙인다.
    const target = cameraTarget(course, { x, y, z })
    const eyeT = death?.kind === 'fall' ? death.eyeY : target.eyeY * M
    const lookT = death?.kind === 'fall' ? death.lookY : target.lookY * M
    if (Number.isNaN(camEyeY)) {
      camEyeY = eyeT
      camLookY = lookT
    } else {
      const k = 1 - Math.exp(-dt * CAM_Y_RATE)
      camEyeY += (eyeT - camEyeY) * k
      camLookY += (lookT - camLookY) * k
    }
    camera.position.set(bx, camEyeY, bz + CAM_BACK * M)
    camera.lookAt(bx, camLookY, bz - LOOK_AHEAD * M)

    renderer.render(scene, camera)
  }

  function resize(w: number, h: number, dpr: number): void {
    if (w <= 0 || h <= 0) return
    renderer.setPixelRatio(Math.min(dpr || 1, MAX_DPR))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const s of segments.values()) dropSegment(s)
    segments.clear()
    shards.dispose()
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
    for (const t of textures) t.dispose()
    renderer.dispose()
  }

  return { render, resize, dispose }
}
