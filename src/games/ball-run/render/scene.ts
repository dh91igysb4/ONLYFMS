// 볼 런 Three.js 장면(설계 §6.2). React를 쓰지 않는다. 시뮬은 읽기만 한다.
// 좌표: 시뮬 mm → 장면 m(÷1000). 장면 x = 시뮬 x, y = 시뮬 y, z = -시뮬 z(three 카메라 기본 시선이 -z라서
// 공 뒤에서 앞을 볼 때 시뮬 +x가 화면 오른쪽이 되도록 z만 뒤집는다).
// 장면 내부 색은 theme 토큰 규칙의 승인된 예외다.
import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  Texture,
  WebGLRenderer,
} from 'three'
import { G, R, ROW } from '../constants.ts'
import type { Course, SegmentInfo } from '../course.ts'
import type { SimState } from '../sim.ts'
import { colOf, floorAt, rowOf } from '../sim.ts'
import { buildingsFor, segmentBoxes } from './layout.ts'
import { BALL_COLOR, BLOCK_COLOR, ballTexture, blockTexture, buildingTexture, gridTexture, shadowTexture } from './textures.ts'

const BG = '#05030f'
const FLOOR_SIDE = '#14183f'
const ARCH_COLOR = '#8ea4ff'
const HEMI_SKY = '#8ea4ff'
const POINT_COLOR = '#ffffff'

const M = 1 / 1000
const AHEAD_ROWS = 80
const BEHIND_ROWS = 10
const FOG_NEAR = 30
const FOG_FAR = 80
const CAM_BACK = 6
const CAM_UP = 3
const CAM_LOOK_AHEAD = 5
const CAM_LOOK_UP = 0.3
const CAM_LERP = 0.15
const HIT_SECONDS = 0.4
const FALL_MAX_TICKS = 180
const BUILDING_DEPTH = 40 // 건물은 조각 base에서 이만큼(m) 아래부터 세운다.
const ARCH_EVERY = 3
const ARCH_X = 3.85
const ARCH_H = 3.6
const ARCH_T = 0.3
const MAX_DPR = 2

export type SceneHandle = {
  render(prev: SimState, cur: SimState, alpha: number): void
  resize(w: number, h: number, dpr: number): void
  dispose(): void
}

type SegmentMeshes = { meshes: InstancedMesh[] }

// 세로 화면에서도 트랙이 너무 좁게 보이지 않게 가로 시야각을 약 50°로 맞추되, 세로 시야각은 60°~75°.
function fovFor(aspect: number): number {
  const v = (2 * Math.atan(Math.tan((25 * Math.PI) / 180) / aspect) * 180) / Math.PI
  return Math.min(75, Math.max(60, v))
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

  const camera = new PerspectiveCamera(60, 1, 0.1, FOG_FAR + 20)

  scene.add(new HemisphereLight(HEMI_SKY, BG, 0.6))
  scene.add(new AmbientLight(POINT_COLOR, 0.25))
  const sun = new DirectionalLight(POINT_COLOR, 1.2)
  sun.position.set(2, 10, 6) // 방향만 쓴다(그림자 없음).
  scene.add(sun)
  const point = new PointLight(POINT_COLOR, 30, 14, 2) // 카메라 근처에서 공 하이라이트
  scene.add(point)

  // ---- 공유 자원(조각마다 다시 만들지 않는다)
  const textures: Texture[] = []
  const tex = <T extends Texture>(t: T): T => {
    textures.push(t)
    return t
  }
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy())
  const grid = tex(gridTexture())
  grid.anisotropy = aniso
  const buildingTex = tex(buildingTexture())
  buildingTex.anisotropy = aniso
  const blockTex = tex(blockTexture())
  const ballTex = tex(ballTexture())
  const shadowTex = tex(shadowTexture())

  // 단위 상자. 바닥용은 윗면(+y, 인덱스 12..17)만 격자 재질, 나머지 면은 어두운 옆면 재질.
  const unitBox = new BoxGeometry(1, 1, 1)
  const floorBox = new BoxGeometry(1, 1, 1)
  floorBox.clearGroups()
  floorBox.addGroup(0, 12, 0)
  floorBox.addGroup(12, 6, 1)
  floorBox.addGroup(18, 18, 0)

  const floorSideMat = new MeshBasicMaterial({ color: FLOOR_SIDE })
  const floorTopMat = new MeshBasicMaterial({ map: grid })
  const blockMat = new MeshLambertMaterial({
    color: BLOCK_COLOR, map: blockTex, emissive: BLOCK_COLOR, emissiveMap: blockTex, emissiveIntensity: 0.7,
  })
  const buildingMat = new MeshBasicMaterial({ map: buildingTex })
  const archMat = new MeshBasicMaterial({ color: ARCH_COLOR })
  const ballMat = new MeshStandardMaterial({
    color: '#ffffff', map: ballTex, metalness: 0.3, roughness: 0.15, emissive: BALL_COLOR, emissiveIntensity: 0.12,
  })
  const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  const materials: Material[] = [floorSideMat, floorTopMat, blockMat, buildingMat, archMat, ballMat, shadowMat]

  const ballGeo = new SphereGeometry(R * M, 32, 24)
  const shadowGeo = new CircleGeometry(R * M * 1.2, 24)
  const geometries = [unitBox, floorBox, ballGeo, shadowGeo]

  const ball = new Mesh(ballGeo, ballMat)
  scene.add(ball)
  const shadow = new Mesh(shadowGeo, shadowMat)
  shadow.renderOrder = 1
  scene.add(shadow)

  // ---- 조각 메시
  const tmp = new Object3D()
  const segments = new Map<number, SegmentMeshes>()

  function instanced(geo: BoxGeometry, mat: Material | Material[], count: number, fill: (i: number) => void): InstancedMesh {
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

  function buildSegment(info: SegmentInfo): SegmentMeshes {
    const meshes: InstancedMesh[] = []
    const boxes = segmentBoxes(course, info)
    const floors = boxes.filter((b) => b.kind === 'floor')
    const blocks = boxes.filter((b) => b.kind === 'block')

    if (floors.length > 0) {
      meshes.push(instanced(floorBox, [floorSideMat, floorTopMat], floors.length, (i) => {
        const b = floors[i]
        // 경사 칸: 윗면 가운데가 칸 가운데 바닥 높이에 오도록, 기울인 법선 방향으로 두께 절반만큼 내린다.
        const angle = Math.atan2(b.slope, ROW)
        const half = (b.h / 2) * M
        const top = b.cy * M + half
        tmp.rotation.x = angle
        tmp.position.set(b.cx * M, top - Math.cos(angle) * half, -b.cz * M - Math.sin(angle) * half)
        tmp.scale.set(b.w * M, b.h * M, (Math.hypot(ROW, b.slope) / ROW) * b.d * M)
      }))
    }
    if (blocks.length > 0) {
      meshes.push(instanced(unitBox, blockMat, blocks.length, (i) => {
        const b = blocks[i]
        tmp.position.set(b.cx * M, b.cy * M, -b.cz * M)
        tmp.scale.set(b.w * M, b.h * M, b.d * M)
      }))
    }

    const buildings = buildingsFor(course.seed, info.startRow, info.startRow + info.length)
    if (buildings.length > 0) {
      const base = info.base * M
      meshes.push(instanced(unitBox, buildingMat, buildings.length, (i) => {
        const k = buildings[i]
        const h = k.h * M + BUILDING_DEPTH
        tmp.position.set(k.cx * M, base - BUILDING_DEPTH + h / 2, -k.cz * M)
        tmp.scale.set(k.w * M, h, k.d * M)
      }))
    }

    if (info.kind === 'tunnel') {
      // 아치 하나 = 기둥 2 + 들보 1. 터널 조각에는 구멍이 없어 가운데 열 바닥이 늘 있다.
      const rows: { z: number; y: number }[] = []
      for (let row = info.startRow + 1; row < info.startRow + info.length - 1; row += ARCH_EVERY) {
        const f = course.cell(0, row).floor
        if (f) rows.push({ z: -(row * ROW + ROW / 2) * M, y: Math.max(f.h0, f.h1) * M })
      }
      if (rows.length > 0) {
        meshes.push(instanced(unitBox, archMat, rows.length * 3, (i) => {
          const a = rows[Math.floor(i / 3)]
          const part = i % 3
          if (part === 2) {
            tmp.position.set(0, a.y + ARCH_H - ARCH_T / 2, a.z)
            tmp.scale.set(ARCH_X * 2 + ARCH_T, ARCH_T, ARCH_T)
          } else {
            tmp.position.set(part === 0 ? -ARCH_X : ARCH_X, a.y + ARCH_H / 2, a.z)
            tmp.scale.set(ARCH_T, ARCH_H, ARCH_T)
          }
        }))
      }
    }

    for (const m of meshes) scene.add(m)
    return { meshes }
  }

  function dropSegment(s: SegmentMeshes): void {
    // 공유 geometry·material은 그대로 두고, 조각마다 만든 인스턴스 버퍼만 해제한다.
    for (const m of s.meshes) {
      scene.remove(m)
      m.dispose()
    }
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

  // ---- 카메라·사망 연출 상태
  let camX = Number.NaN
  let camY = Number.NaN
  let death: null | { kind: 'hit' | 'fall' | 'give_up'; t0: number; from: SimState; camY: number } = null

  function render(prev: SimState, cur: SimState, alpha: number): void {
    const a = Math.min(1, Math.max(0, alpha))
    let x = prev.x + (cur.x - prev.x) * a
    let y = prev.y + (cur.y - prev.y) * a
    let z = prev.z + (cur.z - prev.z) * a
    let scale = 1

    if (cur.dead === null) death = null
    else if (death === null || death.kind !== cur.dead) {
      death = { kind: cur.dead, t0: performance.now(), from: cur, camY: Number.isNaN(camY) ? cur.y * M + CAM_UP : camY }
    }
    if (death) {
      const t = (performance.now() - death.t0) / 1000
      const s = death.from
      x = s.x
      y = s.y
      z = s.z
      if (death.kind === 'hit') {
        // 멈칫하며 떨리다가 0.4초에 걸쳐 줄어든다.
        const k = Math.min(1, t / HIT_SECONDS)
        scale = 1 - k
        x += Math.sin(t * 90) * 40 * (1 - k)
      } else if (death.kind === 'fall') {
        const ticks = Math.min(FALL_MAX_TICKS, t * 60)
        y = s.y + s.vy * ticks - (G * ticks * ticks) / 2
        z = s.z + s.vz * ticks
      }
    }

    updateSegments(z)

    const bx = x * M
    const by = y * M
    const bz = -z * M
    ball.position.set(bx, by, bz)
    ball.rotation.x = -z / R // 굴러간 거리 / 반지름 (진행 방향 -z)
    ball.scale.setScalar(Math.max(scale, 0.0001))
    ball.visible = scale > 0

    // 그림자: 바닥 위에서만, 높이 뜰수록 옅게. 경사 칸에서는 경사만큼 기울인다.
    const fy = floorAt(course, x, z)
    const lift = fy === null ? Infinity : y - R - fy
    if (fy === null || lift > 2500 || lift < -R || !ball.visible) shadow.visible = false
    else {
      const f = course.cell(colOf(x), rowOf(z)).floor
      const angle = f ? Math.atan2(f.h1 - f.h0, ROW) : 0
      shadow.visible = true
      shadow.position.set(bx, fy * M + 0.005, bz)
      shadow.rotation.x = angle - Math.PI / 2 // 원은 xy 평면 → 바닥 법선(0, cos, sin)을 향하게
      shadowMat.opacity = Math.min(1, Math.max(0, 1 - lift / 2500))
    }

    // 카메라: z는 공을 그대로 따라가고, x·y는 프레임마다 0.15씩 다가간다. 낙하 중에는 높이를 고정한다.
    const tx = bx
    const ty = death?.kind === 'fall' ? death.camY : by + CAM_UP
    if (Number.isNaN(camX)) {
      camX = tx
      camY = ty
    } else {
      camX += (tx - camX) * CAM_LERP
      camY += (ty - camY) * CAM_LERP
    }
    camera.position.set(camX, camY, bz + CAM_BACK)
    camera.lookAt(camX, camY - CAM_UP + CAM_LOOK_UP, bz - CAM_LOOK_AHEAD)
    point.position.set(camX + 1, camY + 0.5, bz + CAM_BACK - 2)

    renderer.render(scene, camera)
  }

  function resize(w: number, h: number, dpr: number): void {
    if (w <= 0 || h <= 0) return
    renderer.setPixelRatio(Math.min(dpr || 1, MAX_DPR))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.fov = fovFor(camera.aspect)
    camera.updateProjectionMatrix()
  }

  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const s of segments.values()) dropSegment(s)
    segments.clear()
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
    for (const t of textures) t.dispose()
    renderer.dispose()
  }

  return { render, resize, dispose }
}
