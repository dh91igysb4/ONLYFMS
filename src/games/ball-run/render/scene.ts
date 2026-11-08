// 볼 런 Three.js 장면(설계 §6.2, v2 §4). React를 쓰지 않는다. 시뮬은 읽기만 한다.
// 좌표: 시뮬 mm → 장면 m(÷1000). 장면 x = 시뮬 x, y = 시뮬 y, z = -시뮬 z(three 카메라 기본 시선이 -z라서
// 공 뒤에서 앞을 볼 때 시뮬 +x가 화면 오른쪽이 되도록 z만 뒤집는다).
// 장면 내부 색은 theme 토큰 규칙의 승인된 예외다.
import {
  BoxGeometry,
  BufferGeometry,
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
import { BLOCK_H, G, R, ROW } from '../constants.ts'
import type { Course, SegmentInfo } from '../course.ts'
import type { SimState } from '../sim.ts'
import { colOf, floorAt, rowOf } from '../sim.ts'
import {
  BANK_ANGLE, FLOOR_T, VFOV, bankOffset, boostPull, buildingsFor, cameraRig, cameraTarget, descentTarget, lookPitch, plankAt,
  plankEase, segmentBoxes, smoothDescent,
  bankFollow, smoothEye,
} from './layout.ts'
import type { Box, Plank } from './layout.ts'
import {
  BALL_COLOR, CHEVRON_P, CHEVRON_W, FLOOR_COLOR, FLOOR_LINE, WINDOW_H, WINDOW_W, ballEnvTexture, blockTexture, buildingTexture,
  chevronTexture, gridTexture, wallTexture,
} from './textures.ts'

const BG = '#000000'
const BEAM_COLOR = '#f27cff'
const SHARD_COLORS = ['#ff4fd8', '#ff8be6', '#4fd8ff', '#9ff0ff', '#ffffff']

const M = 1 / 1000
const AHEAD_ROWS = 90
const BEHIND_ROWS = 10
const FOG_NEAR = 25
const FOG_FAR = 90
const LOOK_DIST = 10 // 시선 점까지 거리(m). 방향만 쓴다.
const FALL_MAX_TICKS = 180
const BUILDING_DEPTH = 60 // 건물은 조각 base에서 이만큼(m) 아래부터 세운다.
const BUILDING_LEAN = (7 * Math.PI) / 180 // 건물 윗부분이 바깥으로 기우는 각
const TUNNEL_HALF = 2.5 // 터널 벽 아래 가장자리(m). 바닥 5칸 끝.
const WALL_H = 3.2 // 터널 마젠타 벽 높이(m). 눈보다 높아 화면 양옆을 위까지 채운다(녹화 f_009).
const WALL_OUT = 0.8 // 벽 위 가장자리가 바깥으로 기우는 정도(m)
const ARCH_SIDES = 7 // 아치 다각형 변 수
const ARCH_RIB = 1.5 // 아치 판 격자 길이(m)
const BEAM_SECONDS = 2
const BEAM_FADE = 0.5
const BEAM_LEN = 9
const BEAM_W0 = 0.7 // 공 쪽 폭(공 지름)
const BEAM_W1 = 1.8 // 카메라 쪽 폭(녹화: 뒤로 갈수록 벌어진다)
const BEAM_OPACITY = 0.8
const BEAM_SEGS = 18
const SHARDS = 24
const SHARD_G = 9.8
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

// 기운 판 묶음 하나(장면 m). 행 묶음 [r0, r1)을 STEP마다 끊어, 각 z에서 굴림 각(판 처음·끝에서 0으로 줄어든다)만큼 판 윗면
// 가운데를 축으로 굴린 단면을 잇는다. 그룹 0 윗면(격자, u는 칸 1 m, v는 행 1 m), 그룹 1 옆면·앞뒤 면.
const PLANK_STEP = 125
function plankGeometry(p: Plank): BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const side: number[] = []
  const W = (p.hi - p.lo + 1) * 1000
  const pc = ((p.lo + p.hi) * 1000) / 2
  const S: number[] = []
  for (let k = 0; k <= p.hi - p.lo + 1; k++) S.push(-W / 2 + k * 1000)
  // z에서 단면: 윗면 점들과 아래 점들(mm).
  const section = (z: number): { top: [number, number][]; bot: [number, number][] } => {
    const roll = -p.bank * BANK_ANGLE * plankEase(p, z)
    const c = Math.cos(roll)
    const sn = Math.sin(roll)
    const top = S.map((s): [number, number] => [pc + s * c, p.h + s * sn])
    const bot = top.map(([x, y]): [number, number] => [x + FLOOR_T * sn, y - FLOOR_T * c])
    return { top, bot }
  }
  const zs: number[] = []
  for (let z = p.r0 * ROW; z < p.r1 * ROW; z += PLANK_STEP) zs.push(z)
  zs.push(p.r1 * ROW)
  const v3 = (out: number[], [x, y]: [number, number], z: number) => out.push(x * M, y * M, -z * M)
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d)
  for (let i = 0; i + 1 < zs.length; i++) {
    const za = zs[i]
    const zb = zs[i + 1]
    const A = section(za)
    const B = section(zb)
    const va = (za - p.r0 * ROW) / ROW
    const vb = (zb - p.r0 * ROW) / ROW
    for (let k = 0; k + 1 < S.length; k++) {
      const pts: number[][] = [[], [], [], []]
      v3(pts[0], A.top[k], za)
      v3(pts[1], A.top[k + 1], za)
      v3(pts[2], B.top[k + 1], zb)
      v3(pts[3], B.top[k], zb)
      quad(pos, pts[0], pts[1], pts[2], pts[3])
      const ua = k
      const ub = k + 1
      uv.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb)
    }
    for (const k of [0, S.length - 1]) {
      const pts: number[][] = [[], [], [], []]
      v3(pts[0], A.top[k], za)
      v3(pts[1], A.bot[k], za)
      v3(pts[2], B.bot[k], zb)
      v3(pts[3], B.top[k], zb)
      quad(side, pts[0], pts[1], pts[2], pts[3])
    }
  }
  for (const z of [p.r0 * ROW, p.r1 * ROW]) {
    const X = section(z)
    for (let k = 0; k + 1 < S.length; k++) {
      const pts: number[][] = [[], [], [], []]
      v3(pts[0], X.top[k], z)
      v3(pts[1], X.top[k + 1], z)
      v3(pts[2], X.bot[k + 1], z)
      v3(pts[3], X.bot[k], z)
      quad(side, pts[0], pts[1], pts[2], pts[3])
    }
  }
  const g = new BufferGeometry()
  const topCount = pos.length / 3
  g.setAttribute('position', new Float32BufferAttribute([...pos, ...side], 3))
  g.setAttribute('uv', new Float32BufferAttribute([...uv, ...new Array<number>((side.length / 3) * 2).fill(0)], 2))
  g.addGroup(0, topCount, 0)
  g.addGroup(topCount, side.length / 3, 1)
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

  const camera = new PerspectiveCamera(VFOV, 1, 0.05, FOG_FAR + 20)

  // 바닥·건물·블록은 조명 없는 평면색(원작처럼). 조명은 공 광택에만 쓴다.
  scene.add(new HemisphereLight('#ffd0f4', '#100620', 0.15))
  const sun = new DirectionalLight('#ffffff', 0.3)
  sun.position.set(0, 3, -10) // 앞 위에서 비춰 반사점이 공 윗면 너머에 숨는다(녹화에 점 하이라이트 없음)
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

  // 바닥 상자: 윗면(+y, 인덱스 12..17)만 격자, 나머지 면은 라벤더 옆면.
  const unitBox = new BoxGeometry(1, 1, 1)
  const floorBox = new BoxGeometry(1, 1, 1)
  floorBox.clearGroups()
  floorBox.addGroup(0, 12, 0)
  floorBox.addGroup(12, 6, 1)
  floorBox.addGroup(18, 18, 0)

  const floorSideMat = new MeshBasicMaterial({ color: FLOOR_LINE })
  const floorTopMat = new MeshBasicMaterial({ map: grid })
  const plankTopMat = new MeshBasicMaterial({ map: grid, side: DoubleSide })
  const plankSideMat = new MeshBasicMaterial({ color: FLOOR_LINE, side: DoubleSide })
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
    color: BALL_COLOR, metalness: 0.65, roughness: 0.07, envMap: envTex, envMapIntensity: 1.2,
  })
  const beamMat = new MeshBasicMaterial({
    color: BEAM_COLOR, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  })
  const shardMat = new MeshBasicMaterial({ color: '#ffffff' })
  const materials: Material[] = [
    floorSideMat, floorTopMat, plankTopMat, plankSideMat, tunnelTopMat, blockMat, lintelMat, buildingMat, archMat, wallMat, chevronMat,
    ballMat, beamMat, shardMat,
  ]

  const ballGeo = new SphereGeometry(R * M, 40, 28)
  // 빛줄기: 공 바닥에서 뒤(카메라 쪽)로 바닥을 따라 깔린 띠(공 쪽 BEAM_W0 → 끝 BEAM_W1). 공이 앞쪽 끝을 가린다.
  // 매 프레임 뒤 바닥 높이를 따라 꼭짓점을 옮긴다(내리막·단차에서 판 속에 묻히거나 카메라 앞을 가로막지 않게).
  const beamGeo = new BufferGeometry()
  const beamPos = new Float32BufferAttribute(new Float32Array((BEAM_SEGS + 1) * 2 * 3), 3)
  beamGeo.setAttribute('position', beamPos)
  {
    const idx: number[] = []
    for (let i = 0; i < BEAM_SEGS; i++) {
      const a = i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    beamGeo.setIndex(idx)
  }
  const geometries: BufferGeometry[] = [unitBox, floorBox, ballGeo, beamGeo]

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
  const beam = new Mesh(beamGeo, beamMat)
  beam.visible = false
  beam.frustumCulled = false
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

  function buildTunnel(info: SegmentInfo, meshes: Mesh[], geos: BufferGeometry[]): void {
    // 터널 안쪽 행(이음 행 제외)은 평평한 5칸이고 벽은 그 끝(±2.5 m)에 선다.
    const r0 = info.startRow + 1
    const r1 = info.startRow + info.length - 1
    const f = course.cell(0, r0).floor
    if (r1 <= r0 || f === null) return
    const y = f.h0 * M
    const z0 = -r0 * ROW * M
    const z1 = -r1 * ROW * M
    const half = TUNNEL_HALF
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
      pts.push([Math.cos(a) * topX, topY + Math.sin(a) * topX * 0.6])
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
    // 기운 칸은 판 묶음 메시로 따로 그린다(처음·끝 행에서 비틀어 평평한 이웃과 맞춘다).
    const flat = floors.filter((b) => b.bank === undefined)
    const plankKeys = new Set<string>()
    for (const b of floors) {
      if (b.bank === undefined) continue
      const p = plankAt(course, Math.round(b.cx / 1000), Math.floor(b.cz / ROW))
      if (p === null) continue
      const key = `${p.lo},${p.hi},${p.r0}`
      if (plankKeys.has(key)) continue
      plankKeys.add(key)
      const g = plankGeometry(p)
      geos.push(g)
      meshes.push(new Mesh(g, [plankTopMat, plankSideMat]))
    }

    if (flat.length > 0) {
      const floorMats = info.kind === 'tunnel' ? [tunnelTopMat, tunnelTopMat] : [floorSideMat, floorTopMat]
      meshes.push(instanced(floorBox, floorMats, flat.length, (i) => {
        const b = flat[i]
        const half = (b.h / 2) * M
        const top = b.cy * M + half
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

  // ---- 깨짐 조각: 공 자리에서 옆·뒤(카메라 쪽)로 낮게 흩어지고, 각자 아래 바닥에 떨어져 멈춘다. 아래가 구멍이면 계속 떨어진다.
  // 위치·속도는 장면 m. 블록 칸으로 들어가려 하면 옆 속도를 잃는다.
  type Shard = { p: [number, number, number]; v: [number, number, number]; s: number; spin: [number, number]; rot: [number, number]; rest: boolean }
  function makeShards(seed: number, at: [number, number, number]): Shard[] {
    const rnd = lcg(seed * 2654435761)
    const out: Shard[] = []
    for (let i = 0; i < SHARDS; i++) {
      const th = rnd() * Math.PI // 0..π: 옆과 뒤쪽 반원
      const sp = 0.8 + rnd() * 2.6
      const r = R * M * (0.2 + rnd() * 0.6)
      const dx = Math.cos(th)
      const dz = Math.sin(th) // 뒤(+z)
      out.push({
        p: [at[0] + dx * r, at[1] - R * M * 0.3 + rnd() * R * M * 0.9, at[2] + dz * r * 0.5],
        v: [dx * sp, 0.4 + rnd() * 1.6, dz * sp * 0.7],
        s: 0.05 + rnd() * 0.09,
        spin: [rnd() * 14 - 7, rnd() * 14 - 7],
        rot: [rnd() * 6, rnd() * 6],
        rest: false,
      })
    }
    return out
  }

  function stepShards(list: Shard[], dt: number): void {
    for (const sh of list) {
      if (sh.rest || dt <= 0) continue
      const [px, py, pz] = sh.p
      sh.v[1] -= SHARD_G * dt
      let nx = px + sh.v[0] * dt
      let nz = pz + sh.v[2] * dt
      const ny = py + sh.v[1] * dt
      // 블록 칸 안(블록 꼭대기 아래)으로는 들어가지 않는다.
      const cell = course.cell(colOf(nx / M), rowOf(-nz / M))
      if (cell.block && cell.floor !== null && ny * 1000 < Math.max(cell.floor.h0, cell.floor.h1) + (cell.blockH ?? BLOCK_H)) {
        nx = px
        nz = pz
        sh.v[0] = 0
        sh.v[2] = 0
      }
      const f = floorAt(course, nx / M, -nz / M)
      const half = sh.s / 2
      const fy = f === null ? null : f * M
      if (fy !== null && ny - half <= fy && py - half >= fy - 0.05) {
        // 바닥에 닿음: 조금 튀고, 느려지면 멈춘다.
        sh.p = [nx, fy + half, nz]
        sh.v = [sh.v[0] * 0.45, -sh.v[1] * 0.25, sh.v[2] * 0.45]
        if (Math.abs(sh.v[1]) < 0.35) sh.rest = true
        continue
      }
      sh.p = [nx, ny, nz]
      sh.rot = [sh.rot[0] + sh.spin[0] * dt, sh.rot[1] + sh.spin[1] * dt]
    }
  }

  // ---- 카메라·연출 상태
  let camEyeY = Number.NaN // mm
  let camPitch = 0
  let camDesc = 0 // 내리막 정도(0 평지 리그 ~ 1 먼 리그)
  let camBack = cameraRig(0).back // mm
  let bankDy = Number.NaN // mm, 화면에 쓰는 기운 판 높이 보정
  let bankVy = 0 // mm/s
  let lastT = Number.NaN
  let lastLevel = Number.NaN
  let boostAt = Number.NEGATIVE_INFINITY
  let death: null | {
    kind: 'hit' | 'fall' | 'give_up'; t0: number; from: SimState; eyeY: number; pitch: number; back: number; shards: Shard[]
  } = null

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
      const dy = Number.isNaN(bankDy) ? 0 : bankDy
      death = {
        kind: cur.dead, t0: now, from: cur,
        eyeY: Number.isNaN(camEyeY) ? cameraTarget(course, cur, cameraRig(camDesc)).eyeY : camEyeY,
        pitch: camPitch,
        back: camBack,
        shards: cur.dead === 'hit' ? makeShards(cur.tick + 1, [cur.x * M, (cur.y + dy) * M, -cur.z * M]) : [],
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

    // 기운 판 위에서는 굴린 면 높이에 맞춰 공을 그린다(시뮬 바닥은 칸 높이 그대로). 판 이음은 비틀어 이어지고, 면이
    // 내려가면 중력으로 떨어져 닿는다(빠를 때 한 프레임에 크게 튀지 않게).
    const grounded = death === null ? cur.grounded : death.kind !== 'fall'
    const dyTarget = grounded ? bankOffset(course, x, z) : 0
    if (Number.isNaN(bankDy)) bankDy = dyTarget
    else {
      const b = bankFollow({ dy: bankDy, vy: bankVy }, dyTarget, dt)
      bankDy = b.dy
      bankVy = b.vy
    }
    const bx = x * M
    const by = (y + bankDy) * M
    const bz = -z * M
    ball.position.set(bx, by, bz)
    ball.rotation.x = -z / R // 굴러간 거리 / 반지름 (진행 방향 -z)
    ball.visible = showBall

    // 깨짐 조각
    if (death?.kind === 'hit') {
      stepShards(death.shards, dt)
      shards.visible = true
      death.shards.forEach((sh, i) => {
        tmp.position.set(sh.p[0], sh.p[1], sh.p[2])
        tmp.rotation.set(sh.rot[0], sh.rot[1], 0)
        tmp.scale.setScalar(sh.s)
        tmp.updateMatrix()
        shards.setMatrixAt(i, tmp.matrix)
      })
      shards.instanceMatrix.needsUpdate = true
    } else shards.visible = false

    // 가속 빛줄기: 공 뒤 바닥(기운 판 면 포함)을 따라 깐다. 구멍 위는 앞 꼭짓점 높이를 잇는다.
    const bt = (now - boostAt) / 1000
    if (bt >= 0 && bt < BEAM_SECONDS && showBall && death === null) {
      let h = by - R * M
      for (let i = 0; i <= BEAM_SEGS; i++) {
        const d = (i / BEAM_SEGS) * BEAM_LEN
        const zs = z - d / M
        if (i > 0) {
          const f = floorAt(course, x, zs)
          if (f !== null) h = (f + bankOffset(course, x, zs)) * M
        }
        const w = (BEAM_W0 + ((BEAM_W1 - BEAM_W0) * i) / BEAM_SEGS) / 2
        beamPos.setXYZ(i * 2, bx - w, h + 0.02, -zs * M)
        beamPos.setXYZ(i * 2 + 1, bx + w, h + 0.02, -zs * M)
      }
      beamPos.needsUpdate = true
      beam.visible = true
      beamMat.opacity = BEAM_OPACITY * Math.min(1, (BEAM_SECONDS - bt) / BEAM_FADE)
    } else beam.visible = false

    // 카메라: x는 공 x 그대로, 눈 높이만 시간 기준으로 보간한다(내려갈 때 천천히). 시선 각은 눈→공 방향에서 고정 각만큼 위라
    // 공이 늘 화면 위에서 BALL_FRAC에 온다. 낙하 중에는 높이·각을 고정한다.
    // 내리막과 가속 직후에는 카메라가 뒤·위로 물러난다(cameraRig). 내리막 정도는 시간 기준으로 보간한다.
    if (death?.kind === 'fall') {
      camEyeY = death.eyeY
      camPitch = death.pitch
      camBack = death.back
    } else {
      if (death === null) {
        const want = Math.max(descentTarget(course, { x, z }), boostPull((now - boostAt) / 1000, cur.speedLevel))
        camDesc = Number.isNaN(camEyeY) ? want : smoothDescent(camDesc, want, dt)
      }
      const rig = cameraRig(camDesc)
      camBack = rig.back
      const t = cameraTarget(course, { x, y, z }, rig)
      camEyeY = Number.isNaN(camEyeY) ? t.eyeY : smoothEye(camEyeY, t.eyeY, t.minEyeY, dt)
      camPitch = lookPitch({ y: camEyeY, z: z - camBack }, { y: y + bankDy, z }, rig.minDown)
    }
    const ey = camEyeY * M
    const ez = bz + camBack * M
    camera.position.set(bx, ey, ez)
    camera.lookAt(bx, ey + Math.tan(camPitch) * LOOK_DIST, ez - LOOK_DIST)

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
