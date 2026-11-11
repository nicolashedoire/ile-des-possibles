import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext'
import { placeAnnotations, type Rect } from './annotation-layout'

type IslandSceneProps = {
  productionMW: number
  consumptionMW: number
  batteryMWh: number
  deficitMW: number
}

type SceneValues = IslandSceneProps

/** A small, deliberately schematic 3D representation, not a power-flow simulation. */
export default function IslandScene(values: IslandSceneProps) {
  const host = useRef<HTMLDivElement>(null)
  const currentValues = useRef<SceneValues>(values)
  const refreshAnnotations = useRef<(() => void) | null>(null)
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  currentValues.current = values
  useEffect(() => { refreshAnnotations.current?.() }, [values.productionMW, values.consumptionMW, values.batteryMWh])

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      setWebglUnavailable(true)
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.setClearColor(0x090909, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    element.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(11.5, 10.8, 15)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.5, 0)
    controls.enablePan = false
    controls.enableZoom = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minPolarAngle = Math.PI * 0.16
    controls.maxPolarAngle = Math.PI * 0.46
    controls.update()

    scene.add(new THREE.HemisphereLight(0xe9efff, 0x343a36, 2.5))
    const key = new THREE.DirectionalLight(0xffffff, 3.5)
    key.position.set(-5, 12, 8)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -9
    key.shadow.camera.right = 9
    key.shadow.camera.top = 9
    key.shadow.camera.bottom = -9
    key.shadow.camera.near = 0.1
    key.shadow.camera.far = 35
    key.shadow.bias = -0.0003
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x8da4c8, 1.2)
    rim.position.set(6, 5, -8)
    scene.add(rim)

    const mat = (color: THREE.ColorRepresentation, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
    const concrete = mat(0x888d8c)
    const concreteLight = mat(0xcbd0cf)
    const concreteDark = mat(0x424846)
    const blackMetal = mat(0x222b2b, 0.5, 0.6)
    const glass = mat(0x344444, 0.22, 0.58)
    const roofMaterial = mat(0x525a59, 0.74, 0.15)
    const surfaceMaterial = mat(0x626d66)
    const roadMaterial = mat(0x383e3c)
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xe7f4ef })
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xa7c4b3, transparent: true, opacity: 0.15 })
    const system = new THREE.Group()
    scene.add(system)

    // A beveled geological base gives the installation scale and depth.
    const shape = new THREE.Shape()
    shape.moveTo(-4.6, -1.8)
    shape.bezierCurveTo(-4.6, -2.8, -3.4, -3.3, -2.2, -3.4)
    shape.lineTo(1.5, -3.35)
    shape.bezierCurveTo(3.4, -3.2, 4.8, -2.2, 4.7, -0.8)
    shape.lineTo(4.2, 1.9)
    shape.bezierCurveTo(3.8, 3.25, 2.7, 3.6, 1.0, 3.5)
    shape.lineTo(-2.9, 3.0)
    shape.bezierCurveTo(-4.2, 2.7, -4.8, 1.7, -4.75, 0.4)
    shape.closePath()
    const islandGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.66, steps: 1, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.16, bevelSegments: 3, curveSegments: 18 })
    islandGeometry.rotateX(-Math.PI / 2)
    const island = new THREE.Mesh(islandGeometry, [surfaceMaterial, concreteDark])
    island.position.y = -0.68
    island.receiveShadow = true
    island.castShadow = true
    system.add(island)
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(islandGeometry, 32), edgeMaterial)
    edge.position.y = -0.68
    system.add(edge)

    const addBox = (parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, cast = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
      mesh.position.set(x, y + h / 2, z)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }
    const addCylinder = (parent: THREE.Object3D, x: number, y: number, z: number, top: number, bottom: number, height: number, material: THREE.Material, sides = 16) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, sides), material)
      mesh.position.set(x, y + height / 2, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }

    // A discrete technical grid, with the island remaining the focal point.
    const grid = new THREE.GridHelper(22, 44, 0x202b28, 0x161a19)
    grid.position.y = -1.35
    grid.material.transparent = true
    grid.material.opacity = 0.32
    scene.add(grid)

    // Road routes: wide dark lines with subtle center markings.
    const makePath = (points: THREE.Vector3[], radius: number, material: THREE.Material) => {
      const curve = new THREE.CatmullRomCurve3(points)
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 56, radius, 6, false), material)
      mesh.receiveShadow = true
      system.add(mesh)
      return curve
    }
    const roadPoints = [new THREE.Vector3(-3.4, 0.17, -0.8), new THREE.Vector3(-2, 0.17, -0.3), new THREE.Vector3(0, 0.17, 0.4), new THREE.Vector3(2, 0.17, 0.5), new THREE.Vector3(3.45, 0.17, -0.1)]
    makePath(roadPoints, 0.13, roadMaterial)

    // Discrete sites: steel turbines, an energy-storage facility and a neighborhood.
    const rotors: THREE.Group[] = []
    const turbineGroups: THREE.Group[] = []
    const addTurbine = (x: number, z: number, scale: number) => {
      const group = new THREE.Group()
      group.position.set(x, 0.15, z)
      group.scale.setScalar(scale)
      system.add(group)
      turbineGroups.push(group)
      addCylinder(group, 0, 0, 0, 0.24, 0.3, 0.12, concrete, 32)
      addCylinder(group, 0, 0.1, 0, 0.045, 0.09, 3.5, concreteLight, 16)
      const nacelle = addBox(group, 0, 3.57, 0.05, 0.3, 0.16, 0.38, concreteLight)
      nacelle.position.z = 0
      const rotor = new THREE.Group()
      rotor.position.set(0, 3.66, 0.22)
      group.add(rotor)
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), concreteLight)
      hub.scale.z = 0.65
      rotor.add(hub)
      for (let index = 0; index < 3; index++) {
        const blade = new THREE.Group()
        blade.rotation.z = (index * Math.PI * 2) / 3
        const bladeShape = new THREE.Shape()
        bladeShape.moveTo(-0.045, 0.05)
        bladeShape.quadraticCurveTo(-0.12, 0.6, -0.038, 1.35)
        bladeShape.quadraticCurveTo(0, 1.42, 0.025, 1.32)
        bladeShape.lineTo(0.06, 0.12)
        bladeShape.closePath()
        const bladeMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014, bevelSegments: 2, curveSegments: 8 }), concreteLight)
        bladeMesh.castShadow = true
        blade.add(bladeMesh)
        rotor.add(blade)
      }
      rotors.push(rotor)
    }
    addTurbine(-3.1, -1.7, 0.83)
    addTurbine(-1.4, -2.2, 0.68)
    addTurbine(-3.3, 0.1, 0.56)

    const battery = new THREE.Group()
    battery.position.set(0.3, 0.16, -1.55)
    system.add(battery)
    addBox(battery, 0, 0, 0, 1.75, 0.12, 1.18, concreteDark)
    addBox(battery, 0, 0.12, 0, 1.52, 0.78, 0.95, concreteLight)
    addBox(battery, 0, 0.9, 0, 1.62, 0.08, 1.05, blackMetal)
    for (let x = -0.51; x <= 0.51; x += 0.34) {
      addBox(battery, x, 0.2, 0.483, 0.25, 0.58, 0.02, concreteDark, false)
      addBox(battery, x, 0.37, 0.5, 0.12, 0.018, 0.012, lineMaterial, false)
      addBox(battery, x, 0.29, 0.5, 0.12, 0.018, 0.012, lineMaterial, false)
    }
    addBox(battery, -0.45, 0.99, 0, 0.35, 0.08, 0.38, concreteDark)
    addBox(battery, 0.13, 0.99, 0, 0.35, 0.08, 0.38, concreteDark)

    const houseGroups: THREE.Group[] = []
    const addHouse = (x: number, z: number, scale: number, rotation = 0) => {
      const house = new THREE.Group()
      house.position.set(x, 0.16, z)
      house.rotation.y = rotation
      house.scale.setScalar(scale)
      system.add(house)
      houseGroups.push(house)
      addBox(house, 0, 0, 0, 0.8, 0.55, 0.65, concreteLight)
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.67, 0.38, 4, 1), roofMaterial)
      roof.rotation.y = Math.PI / 4
      roof.scale.z = 0.86
      roof.position.y = 0.73
      roof.castShadow = true
      house.add(roof)
      addBox(house, -0.19, 0.17, 0.33, 0.16, 0.18, 0.015, glass, false)
      addBox(house, 0.18, 0.17, 0.33, 0.16, 0.18, 0.015, glass, false)
      addBox(house, 0, 0.03, 0.332, 0.12, 0.28, 0.016, blackMetal, false)
    }
    addHouse(2.2, -1.6, 0.8, -0.2)
    addHouse(3.3, -0.95, 0.72, -0.12)
    addHouse(2.4, 0.75, 0.85, 0.1)
    addHouse(3.45, 1.0, 0.7, 0.1)
    addHouse(1.35, 1.9, 0.68, 0.15)

    // Industrial load, kept distinct from the residential buildings.
    const factory = new THREE.Group()
    factory.position.set(-0.85, 0.16, 1.55)
    system.add(factory)
    addBox(factory, 0, 0, 0, 1.55, 0.6, 1.04, concrete)
    addBox(factory, 0, 0.6, 0, 1.62, 0.08, 1.12, blackMetal)
    addBox(factory, -0.37, 0.16, 0.53, 0.42, 0.27, 0.02, glass, false)
    addBox(factory, 0.34, 0.16, 0.53, 0.42, 0.27, 0.02, glass, false)
    addCylinder(factory, 0.48, 0.66, -0.25, 0.09, 0.1, 0.62, blackMetal)
    addBox(factory, -0.25, 0.7, -0.06, 0.36, 0.16, 0.3, concreteDark)

    const linkMaterial = new THREE.MeshBasicMaterial({ color: 0x8fb4a2, transparent: true, opacity: 0.78 })
    const paths = [
      [new THREE.Vector3(-2.8, 0.23, -1.5), new THREE.Vector3(-1.7, 0.24, -1.05), new THREE.Vector3(-0.9, 0.24, -0.55), new THREE.Vector3(0.3, 0.24, -0.42)],
      [new THREE.Vector3(0.3, 0.24, -1.0), new THREE.Vector3(0.3, 0.24, -0.42), new THREE.Vector3(1.25, 0.24, 0.05), new THREE.Vector3(2.4, 0.24, -0.6)],
      [new THREE.Vector3(0.3, 0.24, -0.42), new THREE.Vector3(-0.3, 0.24, 0.2), new THREE.Vector3(-0.85, 0.24, 1.0)],
    ].map(points => makePath(points, 0.018, linkMaterial))
    const movingMarkers: { mesh: THREE.Mesh; path: THREE.CatmullRomCurve3; phase: number }[] = []
    paths.forEach((path, pathIndex) => {
      for (let index = 0; index < 3; index++) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), lineMaterial)
        system.add(marker)
        movingMarkers.push({ mesh: marker, path, phase: index / 3 + pathIndex * 0.17 })
      }
    })
    const centralNode = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), lineMaterial)
    centralNode.position.set(0.3, 0.24, -0.42)
    system.add(centralNode)

    // Annotate actual installations using their projected 3D bounding boxes. The
    // backing positions are recalculated as the camera moves, without rebuilding
    // the scene. The corresponding accessible selectors remain outside the view.
    const annotations = document.createElement('div')
    Object.assign(annotations.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' })
    annotations.setAttribute('aria-hidden', 'true')
    element.appendChild(annotations)
    const nodes = ['production', 'battery', 'consumption'].map(id => {
      const node = document.createElement('div')
      Object.assign(node.style, { position: 'absolute', display: 'none', padding: '7px 9px', color: '#f5f5f5', background: 'rgba(12, 12, 14, .9)', border: '1px solid rgba(255,255,255,.25)', borderRadius: '6px', font: '12px Arial', lineHeight: '16px', boxSizing: 'border-box', whiteSpace: 'pre', boxShadow: '0 3px 12px rgba(0,0,0,.25)' })
      node.dataset.annotation = id
      annotations.appendChild(node)
      return node
    })
    const siteBoxes = [
      new THREE.Box3(new THREE.Vector3(-3.7, 0, -2.3), new THREE.Vector3(-2.5, 4.5, -1.1)),
      new THREE.Box3().setFromObject(battery),
      new THREE.Box3().setFromObject(factory),
    ]
    const otherBoxes = [...turbineGroups.slice(1), ...houseGroups].map(group => new THREE.Box3().setFromObject(group))
    const projectBox = (box: THREE.Box3, width: number, height: number): Rect | null => {
      const points: THREE.Vector3[] = []
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z).project(camera))
      if (points.every(p => p.x < -1) || points.every(p => p.x > 1) || points.every(p => p.y < -1) || points.every(p => p.y > 1)) return null
      const xs = points.map(p => (p.x + 1) * width / 2)
      const ys = points.map(p => (1 - p.y) * height / 2)
      return { minX: Math.max(0, Math.min(...xs) - 4), minY: Math.max(0, Math.min(...ys) - 4), maxX: Math.min(width, Math.max(...xs) + 4), maxY: Math.min(height, Math.max(...ys) + 4) }
    }
    let annotationFrame = 0
    let annotationTimer: ReturnType<typeof setTimeout> | undefined
    let lastAnnotation = 0
    let cachedLabels: { text: string; lines: string[]; height: number }[] = []
    let cachedKey = ''
    const renderAnnotations = () => {
      annotationFrame = 0
      lastAnnotation = performance.now()
      const width = element.clientWidth, height = element.clientHeight
      if (width < 520 || height < 240) { nodes.forEach(node => { node.style.display = 'none' }); return }
      camera.updateMatrixWorld()
      const boxes = siteBoxes.map(box => projectBox(box, width, height))
      const values = currentValues.current
      const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n)
      const texts = [`Production totale : ${fmt(values.productionMW)} MW`, `Batterie : ${fmt(values.batteryMWh)} MWh disponibles`, `Consommation : ${fmt(values.consumptionMW)} MW`]
      const key = texts.join('|')
      if (key !== cachedKey) {
        try {
          cachedLabels = texts.map(text => {
            const result = layoutWithLines(prepareWithSegments(text, '12px Arial'), 128, 16)
            return { text, lines: result.lines.map(line => line.text), height: result.lines.length * 16 + 16 }
          })
          cachedKey = key
        } catch { nodes.forEach(node => { node.style.display = 'none' }); return }
      }
      const obstacles = [...boxes, ...otherBoxes.map(box => projectBox(box, width, height))].filter((box): box is Rect => box !== null)
      const requests = boxes.flatMap((box, i) => box ? [{ id: String(i), anchor: box, width: 146, height: cachedLabels[i].height }] : [])
      let placed
      try { placed = placeAnnotations(requests, width, height, obstacles) }
      catch { nodes.forEach(node => { node.style.display = 'none' }); return }
      nodes.forEach((node, i) => {
        const placement = placed.find(item => item.id === String(i))
        if (!placement) { node.style.display = 'none'; return }
        const label = cachedLabels[i]
        if (node.dataset.text !== label.text) { node.textContent = label.lines.join('\n'); node.dataset.text = label.text }
        node.style.width = `${placement.width}px`
        node.style.transform = `translate(${Math.round(placement.x)}px, ${Math.round(placement.y)}px)`
        node.style.display = 'block'
      })
    }
    const scheduleAnnotations = () => {
      if (annotationFrame || annotationTimer) return
      const delay = Math.max(0, 40 - (performance.now() - lastAnnotation))
      if (delay > 0) annotationTimer = setTimeout(() => { annotationTimer = undefined; annotationFrame = requestAnimationFrame(renderAnnotations) }, delay)
      else annotationFrame = requestAnimationFrame(renderAnnotations)
    }
    refreshAnnotations.current = scheduleAnnotations
    controls.addEventListener('change', scheduleAnnotations)
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = mediaQuery.matches
    const onMotionPreference = (event: MediaQueryListEvent) => { reducedMotion = event.matches }
    mediaQuery.addEventListener('change', onMotionPreference)
    const homeDirection = new THREE.Vector3(11.5, 10.3, 15).normalize()
    let homeDistance = 19
    const resize = () => {
      const width = Math.max(1, element.clientWidth)
      const height = Math.max(1, element.clientHeight)
      camera.aspect = width / height
      camera.fov = 36
      camera.updateProjectionMatrix()
      // Fit the entire modeled scene, not a fixed distance: the same framing
      // therefore remains usable for narrow, square and wide panels.
      system.updateWorldMatrix(true, true)
      const bounds = new THREE.Box3().setFromObject(system)
      const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
      camera.position.copy(controls.target).addScaledVector(direction, 20)
      camera.lookAt(controls.target)
      camera.updateMatrixWorld()
      const inverseRotation = camera.quaternion.clone().invert()
      const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      let distance = 1
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).sub(controls.target).applyQuaternion(inverseRotation)
        distance = Math.max(distance, point.z + Math.abs(point.x) / (vertical * camera.aspect * 0.88), point.z + Math.abs(point.y) / (vertical * 0.88))
      }
      homeDistance = distance
      camera.position.copy(controls.target).addScaledVector(direction, distance)
      controls.update()
      renderer.setSize(width, height, false)
      scheduleAnnotations()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()

    const onKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
      event.preventDefault()
      if (event.key === 'Home') {
        camera.position.copy(controls.target).addScaledVector(homeDirection, homeDistance)
      } else {
        const direction = new THREE.Vector3().subVectors(camera.position, controls.target)
        const spherical = new THREE.Spherical().setFromVector3(direction)
        if (event.key === 'ArrowLeft') spherical.theta -= 0.12
        if (event.key === 'ArrowRight') spherical.theta += 0.12
        if (event.key === 'ArrowUp') spherical.phi = Math.max(controls.minPolarAngle, spherical.phi - 0.1)
        if (event.key === 'ArrowDown') spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + 0.1)
        camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(controls.target))
      }
      controls.update()
      renderer.render(scene, camera)
    }
    element.addEventListener('keydown', onKeyDown)

    let frame = 0
    const clock = new THREE.Clock()
    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05)
      const elapsed = clock.elapsedTime
      if (!reducedMotion) {
        const speed = 0.24 + Math.min(currentValues.current.productionMW, 100) * 0.004
        rotors.forEach((rotor, index) => { rotor.rotation.z -= delta * speed * (1 + index * 0.05) })
      }
      const stressed = currentValues.current.deficitMW > 0
      linkMaterial.color.setHex(stressed ? 0xd4b88c : 0x8fb4a2)
      for (const marker of movingMarkers) {
        marker.path.getPointAt((marker.phase + (reducedMotion ? 0 : elapsed * 0.055)) % 1, marker.mesh.position)
      }
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      if (annotationFrame) cancelAnimationFrame(annotationFrame)
      if (annotationTimer) clearTimeout(annotationTimer)
      controls.removeEventListener('change', scheduleAnnotations)
      refreshAnnotations.current = null
      annotations.remove()
      mediaQuery.removeEventListener('change', onMotionPreference)
      element.removeEventListener('keydown', onKeyDown)
      observer.disconnect()
      controls.dispose()
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry)
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
          objectMaterials.forEach(material => materials.add(material))
        }
      })
      geometries.forEach(geometry => geometry.dispose())
      materials.forEach(material => material.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div
    ref={host}
    role="img"
    tabIndex={0}
    aria-label={`Maquette 3D stylisée de l’île : production totale ${values.productionMW} MW, batterie ${values.batteryMWh} MWh, consommation ${values.consumptionMW} MW. Faites glisser pour tourner la vue ; au clavier, utilisez les flèches et la touche début pour réinitialiser.`}
    style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280, overflow: 'hidden', background: '#090909', cursor: webglUnavailable ? 'default' : 'grab', outlineOffset: '-3px' }}
  >{webglUnavailable && <div style={{ color: '#a1a1aa', padding: '2rem', fontSize: '0.875rem', lineHeight: 1.6 }}>La vue 3D n’est pas disponible dans ce navigateur. Les paramètres et les résultats restent accessibles dans les panneaux autour de la carte.</div>}</div>
}
