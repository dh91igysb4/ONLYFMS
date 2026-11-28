// 레이스 3D 장면 (레이싱 설계 §5.4·§5.5): 네온 밤 도시 위 고가 도로, 내 차, 추격 카메라.
// 테스트하지 않는 얇은 그리기 계층이다. 계산(카메라·건물 배치)은 camera.ts·city.ts에 있다.
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Fog,
  Group, HemisphereLight, InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D,
  PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Vector3, WebGLRenderer,
} from 'three'
import { CAR_HALF } from '../constants.ts'
import { buildRoad } from '../course/road.ts'
import type { Course } from '../course/types.ts'
import { quatYPR } from '../physics/world.ts'
import type { RaceSnapshot } from '../race.ts'
import { chaseCamera, type CamPose } from './camera.ts'
import { cityBlocks } from './city.ts'

export type Scene3D = {
  draw(snap: RaceSnapshot, alpha: number): void
  resize(w: number, h: number, dpr: number): void
  dispose(): void
}

const BG = '#07041a'
const MAX_DPR = 2
const FOG_NEAR = 80
const FOG_FAR = 650

export function createScene(canvas: HTMLCanvasElement, course: Course): Scene3D {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true })
  } catch {
    throw new Error('webgl')
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR))
  renderer.setClearColor(BG)
  const scene = new Scene()
  scene.background = new Color(BG)
  scene.fog = new Fog(BG, FOG_NEAR, FOG_FAR)
  const camera = new PerspectiveCamera(65, 1, 0.1, FOG_FAR + 50)
  scene.add(new HemisphereLight('#b9a8ff', '#120a2a', 1.1))

  const geometries: BufferGeometry[] = []
  const materials: Material[] = []
  const g = <T extends BufferGeometry>(x: T) => (geometries.push(x), x)
  const m = <T extends Material>(x: T) => (materials.push(x), x)

  // ---- 도로·벽
  const road = buildRoad(course)
  const roadGeo = g(new BufferGeometry())
  roadGeo.setAttribute('position', new BufferAttribute(road.positions, 3))
  roadGeo.setIndex(new BufferAttribute(road.indices, 1))
  roadGeo.computeVertexNormals()
  scene.add(new Mesh(roadGeo, m(new MeshLambertMaterial({ color: '#2b2d3a' }))))
  if (road.walls.indices.length > 0) {
    const wallGeo = g(new BufferGeometry())
    wallGeo.setAttribute('position', new BufferAttribute(road.walls.positions, 3))
    wallGeo.setIndex(new BufferAttribute(road.walls.indices, 1))
    scene.add(new Mesh(wallGeo, m(new MeshBasicMaterial({ color: '#ffd23f', side: DoubleSide }))))
  }
  // 차선: 중심선 점선
  const dash = g(new PlaneGeometry(0.25, 3))
  const dashMat = m(new MeshBasicMaterial({ color: '#d9d9e6' }))
  const dashes = new InstancedMesh(dash, dashMat, Math.ceil(course.centerline.length / 3))
  const tmp = new Object3D()
  let dn = 0
  for (let i = 0; i + 1 < course.centerline.length; i += 3) {
    const p = course.centerline[i]
    const q = course.centerline[i + 1]
    tmp.position.set(p.x, p.y + 0.03, p.z)
    tmp.rotation.set(0, Math.atan2(q.x - p.x, q.z - p.z), 0)
    tmp.rotateX(-Math.PI / 2)
    tmp.updateMatrix()
    dashes.setMatrixAt(dn++, tmp.matrix)
  }
  dashes.count = dn
  scene.add(dashes)

  // ---- 점프대·착지대
  const rampMat = m(new MeshLambertMaterial({ color: '#ff2bd6', emissive: '#5a0a4c' }))
  const platMat = m(new MeshLambertMaterial({ color: '#3a3d52' }))
  for (const b of course.boxes) {
    const mesh = new Mesh(g(new BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2)), b.kind === 'platform' || (b.kind === 'shortcut' && b.half.z > 10) ? platMat : rampMat)
    const q = quatYPR(b.rot.yaw, b.rot.pitch, b.rot.roll)
    mesh.position.set(b.center.x, b.center.y, b.center.z)
    mesh.quaternion.set(q.x, q.y, q.z, q.w)
    scene.add(mesh)
  }

  // ---- 도시: 어두운 상자 + 위쪽 발광 띠
  const blocks = cityBlocks(course, 1)
  const unit = g(new BoxGeometry(1, 1, 1))
  const towers = new InstancedMesh(unit, m(new MeshLambertMaterial({ color: '#141228' })), blocks.length)
  const bands = new InstancedMesh(unit, m(new MeshBasicMaterial({ color: '#ffffff' })), blocks.length)
  const mat4 = new Matrix4()
  blocks.forEach((b, i) => {
    mat4.makeScale(b.half.x * 2, b.half.y * 2, b.half.z * 2).setPosition(b.center.x, b.center.y, b.center.z)
    towers.setMatrixAt(i, mat4)
    mat4.makeScale(b.half.x * 2 + 0.3, 1.2, b.half.z * 2 + 0.3).setPosition(b.center.x, b.center.y + b.half.y - 3, b.center.z)
    bands.setMatrixAt(i, mat4)
    bands.setColorAt(i, new Color(b.glow))
  })
  scene.add(towers, bands)

  // ---- 차
  const car = new Group()
  const body = new Mesh(g(new BoxGeometry(CAR_HALF.x * 2, CAR_HALF.y * 1.2, CAR_HALF.z * 2)), m(new MeshLambertMaterial({ color: '#ff3b5c' })))
  body.position.y = -0.1
  const cabin = new Mesh(g(new BoxGeometry(CAR_HALF.x * 1.6, CAR_HALF.y * 0.9, CAR_HALF.z * 0.9)), m(new MeshLambertMaterial({ color: '#1a1030' })))
  cabin.position.set(0, CAR_HALF.y * 0.5, -0.2)
  car.add(body, cabin)
  const wheelGeo = g(new CylinderGeometry(0.35, 0.35, 0.3, 14))
  const wheelMat = m(new MeshLambertMaterial({ color: '#0b0b10' }))
  for (const [x, z] of [[0.95, 1.45], [-0.95, 1.45], [0.95, -1.45], [-0.95, -1.45]]) {
    const w = new Mesh(wheelGeo, wheelMat)
    w.rotation.z = Math.PI / 2
    w.position.set(x, -0.5, z)
    car.add(w)
  }
  const glow = new Mesh(g(new PlaneGeometry(CAR_HALF.x * 2.4, CAR_HALF.z * 2.2)), m(new MeshBasicMaterial({ color: '#22e4ff', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false })))
  glow.rotation.x = -Math.PI / 2
  glow.position.y = -0.85
  car.add(glow)
  const flameMat = m(new MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }))
  const flames: Mesh[] = []
  for (const x of [0.5, -0.5]) {
    const f = new Mesh(g(new ConeGeometry(0.22, 1.4, 10)), flameMat)
    f.rotation.x = -Math.PI / 2
    f.position.set(x, -0.2, -CAR_HALF.z - 0.7)
    car.add(f)
    flames.push(f)
  }
  scene.add(car)

  // ---- 그리기: 직전 '틱' 자세(snap.prev)와 지금 틱 사이를 보간한다.
  // 직전 '프레임' 자세와 섞으면 한 프레임에 0틱·2틱이 번갈아 돌 때 차가 멈췄다 튀어 끊겨 보인다.
  const prevPos = new Vector3()
  const curPos = new Vector3()
  const prevQ = new Quaternion()
  const curQ = new Quaternion()
  let cam: CamPose | null = null
  let lastNow = 0

  function draw(snap: RaceSnapshot, alpha: number): void {
    const s = snap.car
    const p = snap.prev ?? { pos: s.pos, quat: s.quat }
    prevPos.set(p.pos.x, p.pos.y, p.pos.z)
    prevQ.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w)
    curPos.set(s.pos.x, s.pos.y, s.pos.z)
    curQ.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w)
    const a = Math.min(1, Math.max(0, alpha))
    car.position.lerpVectors(prevPos, curPos, a)
    car.quaternion.slerpQuaternions(prevQ, curQ, a)
    const flick = 0.8 + Math.random() * 0.4
    for (const f of flames) {
      f.visible = snap.nitro.burning
      f.scale.set(1, flick, 1)
    }
    const now = performance.now()
    const dt = lastNow === 0 ? 1 / 60 : Math.min(0.1, (now - lastNow) / 1000)
    lastNow = now
    cam = chaseCamera(cam, { pos: car.position, quat: car.quaternion, vel: s.vel }, dt)
    camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z)
    camera.lookAt(cam.look.x, cam.look.y, cam.look.z)
    if (Math.abs(camera.fov - cam.fov) > 0.05) {
      camera.fov = cam.fov
      camera.updateProjectionMatrix()
    }
    renderer.render(scene, camera)
  }

  function resize(w: number, h: number, dpr: number): void {
    renderer.setPixelRatio(Math.min(dpr || 1, MAX_DPR))
    renderer.setSize(w, h, false)
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
  }

  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    dashes.dispose()
    towers.dispose()
    bands.dispose()
    for (const x of geometries) x.dispose()
    for (const x of materials) x.dispose()
    renderer.dispose()
  }

  return { draw, resize, dispose }
}
