import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext'
import { placeAnnotations, type Rect } from './annotation-layout'

type IslandSceneProps = {
  productionMW: number
  consumptionMW: number
  batteryMWh: number
  deficitMW: number
  chargeMW?: number
  dischargeMW?: number
  unservedMW?: number
  selected?: 'production' | 'consommation' | 'batterie'
  onSelect?: (id: 'production' | 'consommation' | 'batterie') => void
  /** Space occupied by UI overlays, excluded when placing 3D labels. */
  annotationBottomInset?: number
  annotationRightInset?: number
}

type SceneValues = IslandSceneProps

/** Generated interactive island, with a procedural fallback; not a power-flow simulation. */
export default function IslandScene(values: IslandSceneProps) {
  const host = useRef<HTMLDivElement>(null)
  const currentValues = useRef<SceneValues>(values)
  const refreshAnnotations = useRef<(() => void) | null>(null)
  const focusInstallation = useRef<((id: 'production' | 'consommation' | 'batterie') => void) | null>(null)
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const [modelUnavailable, setModelUnavailable] = useState(false)
  const formatAccessible = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
  currentValues.current = values
  useEffect(() => { refreshAnnotations.current?.() }, [values.productionMW, values.consumptionMW, values.batteryMWh, values.annotationBottomInset, values.annotationRightInset])
  useEffect(() => { if (values.selected) focusInstallation.current?.(values.selected) }, [values.selected])

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
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    element.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(11.5, 7.4, 18)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.5, 0)
    controls.enablePan = false
    controls.enableZoom = false
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minPolarAngle = Math.PI * 0.16
    controls.maxPolarAngle = Math.PI * 0.46
    controls.update()

    scene.add(new THREE.HemisphereLight(0xfff4e5, 0x1b211a, 2.0))
    const key = new THREE.DirectionalLight(0xffe2bd, 3.2)
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
    const rim = new THREE.DirectionalLight(0xb5d7bf, 0.8)
    rim.position.set(6, 5, -8)
    scene.add(rim)

    const mat = (color: THREE.ColorRepresentation, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
    const concrete = mat(0x8f8c80)
    const concreteLight = mat(0xe6e4d9)
    const concreteDark = mat(0x4a4940)
    const blackMetal = mat(0x242a29, 0.5, 0.6)
    const glass = new THREE.MeshStandardMaterial({ color: 0x89704c, emissive: 0xe0a950, emissiveIntensity: 0.55, roughness: 0.32, metalness: 0.15 })
    const roofMaterial = mat(0x3a403d, 0.74, 0.15)
    const roadMaterial = mat(0x3b3b33)
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xa3f5d3 })
    const system = new THREE.Group()
    scene.add(system)
    // A generated model is loaded asynchronously. Until it is ready the
    // procedural island remains the complete, interactive fallback.
    const generatedIsland = new THREE.Group()
    generatedIsland.visible = false
    scene.add(generatedIsland)
    let usingGeneratedIsland = false
    let generatedGroundY = .19
    let destroyed = false
    type GeneratedFlow = { path: THREE.CatmullRomCurve3; tube: THREE.Mesh; markers: THREE.Mesh[]; kind: 'production' | 'load' | 'battery'; phase: number }
    const generatedFlows: GeneratedFlow[] = []
    const generatedFlowMaterial = new THREE.MeshBasicMaterial({ color: 0x9bf5d2, transparent: true, opacity: .83, depthWrite: false })
    // Both the markers and the connections respect the mesh's depth so the
    // schematic animation does not float through the building facades.
    const generatedMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xa7dbbe, transparent: true, opacity: .72, depthTest: true, depthWrite: false })

    // A layered, asymmetrical rock shelf and an irregular grass cap. Every
    // vertex is deterministic so camera rotations preserve the same island.
    const sides = 96
    const radius = (angle: number) => 1 + 0.08 * Math.sin(3 * angle + .4) + .045 * Math.cos(7 * angle - .7) + .027 * Math.sin(11 * angle)
    const shelfPositions: number[] = [], shelfColors: number[] = [], shelfIndices: number[] = []
    const levels = 7
    for (let level = 0; level < levels; level++) {
      const fraction = level / (levels - 1)
      for (let i = 0; i < sides; i++) {
        const a = i * Math.PI * 2 / sides
        const crag = .03 * Math.sin(i * 2.41 + level * 1.91) + .025 * Math.cos(i * .73 - level * 2)
        const r = radius(a) * (1 - .24 * fraction + crag)
        shelfPositions.push(Math.cos(a) * 5.5 * r, .11 - fraction * (1.28 + .2 * Math.sin(2 * a)), Math.sin(a) * 3.15 * r)
        const shade = Math.max(.2, .47 - fraction * .18 + .045 * Math.sin(i * 1.23 + level * 2.3))
        shelfColors.push(shade * 1.03, shade, shade * .88)
      }
    }
    for (let j = 0; j < levels - 1; j++) for (let i = 0; i < sides; i++) {
      const a = j * sides + i, b = j * sides + (i + 1) % sides, c = (j + 1) * sides + i, d = (j + 1) * sides + (i + 1) % sides
      shelfIndices.push(a, c, b, b, c, d)
    }
    const shelfGeometry = new THREE.BufferGeometry()
    shelfGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shelfPositions, 3))
    shelfGeometry.setAttribute('color', new THREE.Float32BufferAttribute(shelfColors, 3))
    shelfGeometry.setIndex(shelfIndices)
    shelfGeometry.computeVertexNormals()
    const shelf = new THREE.Mesh(shelfGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98, side: THREE.DoubleSide }))
    shelf.castShadow = true; shelf.receiveShadow = true; system.add(shelf)

    const groundPositions: number[] = [], groundColors: number[] = [], groundUVs: number[] = [], groundIndices: number[] = []
    const rings = 24
    for (let j = 0; j <= rings; j++) for (let i = 0; i < sides; i++) {
      const a = i * Math.PI * 2 / sides, rr = j / rings * radius(a)
      const x = Math.cos(a) * 5.5 * rr, z = Math.sin(a) * 3.15 * rr
      const relief = .025 * Math.sin(x * 3.2 + z * 1.7) * Math.cos(z * 3.5) + .035 * Math.sin(x * 1.8 - z * 2.7)
      groundPositions.push(x, .12 + relief, z)
      groundUVs.push(x * .38, z * .38)
      const shade = .82 + .12 * Math.sin(x * 4 + z * 3) * Math.cos(z * 5 - x * 2)
      groundColors.push(.30 * shade, .38 * shade, .20 * shade)
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
      const a = j * sides + i, b = j * sides + (i + 1) % sides, c = (j + 1) * sides + i, d = (j + 1) * sides + (i + 1) % sides
      groundIndices.push(a, b, c, b, d, c)
    }
    const groundGeometry = new THREE.BufferGeometry()
    groundGeometry.setAttribute('position', new THREE.Float32BufferAttribute(groundPositions, 3))
    groundGeometry.setAttribute('color', new THREE.Float32BufferAttribute(groundColors, 3))
    groundGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(groundUVs, 2))
    groundGeometry.setIndex(groundIndices)
    groundGeometry.computeVertexNormals()
    // Fine grain reads as meadow in close-up; the generated tile is entirely
    // local and does not depend on external assets or network requests.
    const textureCanvas = document.createElement('canvas'); textureCanvas.width = 256; textureCanvas.height = 256
    const textureContext = textureCanvas.getContext('2d')
    let meadowTexture: THREE.CanvasTexture | null = null
    if (textureContext) {
      const pixels = textureContext.createImageData(256, 256)
      let randomState = 821
      for (let i = 0; i < pixels.data.length; i += 4) {
        randomState = (randomState * 1664525 + 1013904223) >>> 0
        const tone = 195 + (randomState >>> 27)
        pixels.data[i] = tone; pixels.data[i + 1] = tone; pixels.data[i + 2] = tone - 8; pixels.data[i + 3] = 255
      }
      textureContext.putImageData(pixels, 0, 0)
      meadowTexture = new THREE.CanvasTexture(textureCanvas)
      meadowTexture.wrapS = meadowTexture.wrapT = THREE.RepeatWrapping
      meadowTexture.colorSpace = THREE.SRGBColorSpace
    }
    const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, map: meadowTexture, roughness: 1, side: THREE.DoubleSide }))
    ground.receiveShadow = true; system.add(ground)

    // Layered fractured outcrops and boulders visually tie the shelf to the
    // reference image without requiring large external texture downloads.
    const rockMaterials = [mat(0x69685d), mat(0x55574d), mat(0x77766a)]
    for (let i = 0; i < 34; i++) {
      const a = i * 2.399, rr = 2.0 + .5 * Math.sin(i * 6.7), x = Math.cos(a) * rr * 1.35, z = Math.sin(a) * rr * .78
      if (x > -.8 && z > -.5) continue
      const s = .13 + .11 * (.5 + .5 * Math.sin(i * 13.5))
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMaterials[i % rockMaterials.length])
      rock.position.set(x, .15 + s * .24, z); rock.scale.set(1.4, .55, 1.05); rock.rotation.set(i * .7, i * 1.2, i * .4)
      rock.castShadow = true; rock.receiveShadow = true; system.add(rock)
    }
    const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), rockMaterials[0])
    hill.scale.set(1.7, .6, .75); hill.position.set(-.1, .03, -2.35); hill.rotation.y = .3; hill.receiveShadow = true; system.add(hill)

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

    // Roads and energy paths rest on the terrain, not on a backdrop grid.
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
      group.userData.installation = 'production'
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
    addTurbine(-3.35, -1.25, .82)

    const battery = new THREE.Group()
    battery.position.set(0.3, 0.16, -1.55)
    battery.userData.installation = 'batterie'
    system.add(battery)
    // Pavilion with a recessed bank of individually visible battery modules.
    addBox(battery, 0, 0, 0, 2.0, 0.10, 1.25, concrete)
    addBox(battery, 0, 0.10, -.51, 1.8, .90, .15, concreteLight)
    addBox(battery, -.86, .10, 0, .16, .90, 1.10, concreteLight)
    addBox(battery, .86, .10, 0, .16, .90, 1.10, concreteLight)
    addBox(battery, 0, 1.0, 0, 2.02, .12, 1.25, concreteLight)
    addBox(battery, 0, .94, .48, 1.85, .06, .08, mat(0xa3875e))
    const batteryMetal = mat(0x303e3a, .42, .58)
    for (let i = 0; i < 4; i++) {
      const x = -.57 + i * .38
      addBox(battery, x, .12, .04, .30, .65, .66, batteryMetal)
      addBox(battery, x, .49, .38, .20, .022, .015, lineMaterial, false)
      addBox(battery, x, .34, .38, .20, .012, .015, concrete, false)
    }

    const houseGroups: THREE.Group[] = []
    const solarMaterial = mat(0x283c47, .3, .42)
    const addHouse = (x: number, z: number, scale: number, rotation = 0) => {
      const house = new THREE.Group()
      house.position.set(x, 0.16, z)
      house.rotation.y = rotation
      house.scale.setScalar(scale)
      house.userData.installation = 'consommation'
      system.add(house)
      houseGroups.push(house)
      addBox(house, 0, 0, 0, 1, .64, .78, concreteLight)
      const roofShape = new THREE.Shape()
      roofShape.moveTo(-.56, .62); roofShape.lineTo(0, 1.02); roofShape.lineTo(.56, .62); roofShape.closePath()
      const roofGeometry = new THREE.ExtrudeGeometry(roofShape, { depth: .88, bevelEnabled: false })
      const roof = new THREE.Mesh(roofGeometry, roofMaterial)
      roof.position.z = -.44
      roof.castShadow = true
      house.add(roof)
      const slope = Math.atan2(.4, .56)
      for (const side of [-1, 1]) {
        const panelGeometry = new THREE.PlaneGeometry(.54, .72)
        panelGeometry.rotateX(-Math.PI / 2); panelGeometry.rotateZ(-side * slope)
        const panel = new THREE.Mesh(panelGeometry, solarMaterial)
        panel.position.set(side * .28, .835, 0); house.add(panel)
        for (let i = -1; i <= 1; i++) {
          const line = new THREE.Mesh(new THREE.BoxGeometry(.008, .006, .72), concrete)
          line.position.set(side * .28 + i * .13, .844 - side * i * .09, 0); house.add(line)
        }
      }
      addBox(house, -.26, .19, .397, .28, .26, .016, blackMetal, false)
      addBox(house, -.26, .21, .407, .23, .22, .012, glass, false)
      addBox(house, .24, .08, .397, .36, .48, .016, blackMetal, false)
      addBox(house, .24, .1, .407, .31, .43, .012, glass, false)
      addBox(house, 0, .04, .397, .10, .42, .016, roofMaterial, false)
    }
    addHouse(2.15, -1.55, .86, -.2)
    addHouse(3.3, -.6, .76, -.12)
    addHouse(2.2, .65, .94, .1)
    addHouse(3.35, 1.1, .72, .1)
    addHouse(1.15, 1.85, .70, .15)

    // Small broadleaf trees soften the miniature and echo the source artwork.
    const trunk = mat(0x605344), foliage = [mat(0x3b5235), mat(0x4d6240), mat(0x677849)]
    const addTree = (x: number, z: number, scale: number, seed: number) => {
      const tree = new THREE.Group(); tree.position.set(x, .16, z); tree.scale.setScalar(scale); system.add(tree)
      addCylinder(tree, 0, 0, 0, .035, .06, .55, trunk, 8)
      for (let i = 0; i < 7; i++) {
        const a = i * 2.399 + seed, r = i ? .16 + .04 * (i % 3) : 0
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.19 + .035 * (i % 3), 1), foliage[(i + Math.floor(seed)) % foliage.length])
        crown.position.set(Math.cos(a) * r, .53 + .08 * (i % 3), Math.sin(a) * r); crown.scale.set(1.05, .8, .85); crown.castShadow = true; tree.add(crown)
      }
    }
    ;[[-2.3, .75, .68], [-1.8, 2.05, .8], [-.2, 2.55, .65], [.9, -.85, .72], [1.15, -.05, .5], [3.9, -.05, .7], [3.8, 1.9, .52], [1.5, 2.55, .58], [-3.75, 1.2, .60]].forEach(([x, z, s], i) => addTree(x, z, s, i))

    // Industrial load, kept distinct from the residential buildings.
    const factory = new THREE.Group()
    factory.position.set(-0.85, 0.16, 1.55)
    factory.userData.installation = 'consommation'
    system.add(factory)
    addBox(factory, 0, 0, 0, 1.55, 0.6, 1.04, concrete)
    addBox(factory, 0, 0.6, 0, 1.62, 0.08, 1.12, blackMetal)
    addBox(factory, -0.37, 0.16, 0.53, 0.42, 0.27, 0.02, glass, false)
    addBox(factory, 0.34, 0.16, 0.53, 0.42, 0.27, 0.02, glass, false)
    addCylinder(factory, 0.48, 0.66, -0.25, 0.09, 0.1, 0.62, blackMetal)
    addBox(factory, -0.25, 0.7, -0.06, 0.36, 0.16, 0.3, concreteDark)

    const linkMaterial = new THREE.MeshBasicMaterial({ color: 0x90f6cc, transparent: true, opacity: 0.95 })
    const pathPoints = [
      [new THREE.Vector3(-2.8, 0.23, -1.5), new THREE.Vector3(-1.7, 0.24, -1.05), new THREE.Vector3(-0.9, 0.24, -0.55), new THREE.Vector3(0.3, 0.24, -0.42)],
      [new THREE.Vector3(0.3, 0.24, -0.42), new THREE.Vector3(1.25, 0.24, 0.05), new THREE.Vector3(2.4, 0.24, -0.6)],
      [new THREE.Vector3(0.3, 0.24, -0.42), new THREE.Vector3(-0.3, 0.24, 0.2), new THREE.Vector3(-0.85, 0.24, 1.0)],
      [new THREE.Vector3(0.3, 0.24, -1.0), new THREE.Vector3(0.3, 0.24, -0.7), new THREE.Vector3(0.3, 0.24, -0.42)],
    ]
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x79edbd, transparent: true, opacity: .18, depthWrite: false })
    const paths = pathPoints.map(points => { makePath(points, .045, glowMaterial); return makePath(points, .018, linkMaterial) })
    const movingMarkers: { mesh: THREE.Mesh; path: THREE.CatmullRomCurve3; phase: number; pathIndex: number }[] = []
    paths.forEach((path, pathIndex) => {
      for (let index = 0; index < 3; index++) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), lineMaterial)
        system.add(marker)
        movingMarkers.push({ mesh: marker, path, phase: index / 3 + pathIndex * 0.17, pathIndex })
      }
    })
    const centralNode = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), lineMaterial)
    centralNode.position.set(0.3, 0.24, -0.42)
    system.add(centralNode)

    // Clicking a physical installation opens the equivalent HTML control.
    // The callback never changes the energy model by itself.
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const selectable: THREE.Object3D[] = [...turbineGroups, battery, factory, ...houseGroups]
    let pointerStart: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY } }
    const pickInstallation = (event: PointerEvent, precise = false): 'production' | 'consommation' | 'batterie' | undefined => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (!rect.width || !rect.height) return undefined
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      if (usingGeneratedIsland && precise) {
        // A broad transparent box may cross the ray before the visible target.
        // Classify the actual surface point instead; only clicks perform this
        // expensive full-mesh raycast, never pointer movement or animation.
        const model = generatedIsland.children[0]
        const hit = model && raycaster.intersectObject(model, true)[0]
        if (!hit) return undefined
        const ids = ['production', 'batterie', 'consommation'] as const
        const candidates = siteBoxes.map((box, i) => ({ box, id: ids[i] })).filter(item => item.box.containsPoint(hit.point))
        if (candidates.length === 0) return undefined
        candidates.sort((a, b) => a.box.getCenter(new THREE.Vector3()).distanceToSquared(hit.point) - b.box.getCenter(new THREE.Vector3()).distanceToSquared(hit.point))
        return candidates[0].id
      }
      const hit = raycaster.intersectObjects(selectable, true)[0]
      let target: THREE.Object3D | null | undefined = hit?.object
      while (target && !target.userData.installation) target = target.parent
      const id = target?.userData.installation
      return id === 'production' || id === 'consommation' || id === 'batterie' ? id : undefined
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) { pointerStart = null; return }
      pointerStart = null
      const id = pickInstallation(event, true)
      if (id) currentValues.current.onSelect?.(id)
    }
    const onPointerMove = (event: PointerEvent) => {
      renderer.domElement.style.cursor = pointerStart ? 'grabbing' : pickInstallation(event) ? 'pointer' : 'grab'
    }
    const onPointerCancel = () => { pointerStart = null; renderer.domElement.style.cursor = 'grab' }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointercancel', onPointerCancel)

    const focusPosition: Record<'production' | 'consommation' | 'batterie', THREE.Vector3> = {
      production: new THREE.Vector3(-3.35, .85, -1.25),
      consommation: new THREE.Vector3(1.8, .55, .45),
      batterie: new THREE.Vector3(.3, .55, -1.55),
    }
    const homeTarget = new THREE.Vector3(0, .5, 0)
    const desiredTarget = new THREE.Vector3()
    let focusing = false
    focusInstallation.current = (id) => {
      // On narrow screens the context panel occupies much of the view. A
      // focus pan pushes the island outside the viewport, so selection still
      // opens the panel and highlights the site without moving the camera.
      if (element.clientWidth < 700) { focusing = false; return }
      desiredTarget.copy(focusPosition[id]); focusing = true
    }
    const selectionMaterial = new THREE.MeshBasicMaterial({ color: 0xa7ffdc, transparent: true, opacity: .85, side: THREE.DoubleSide })
    const selectionRing = new THREE.Mesh(new THREE.RingGeometry(.66, .69, 64), selectionMaterial)
    selectionRing.rotation.x = -Math.PI / 2
    selectionRing.visible = false
    scene.add(selectionRing)

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
      new THREE.Box3().setFromObject(turbineGroups[0]),
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
      const values = currentValues.current
      const usableWidth = Math.max(0, width - Math.max(0, values.annotationRightInset ?? 0))
      const usableHeight = Math.max(0, height - Math.max(0, values.annotationBottomInset ?? 0))
      if (usableWidth < 520 || usableHeight < 200) { nodes.forEach(node => { node.style.display = 'none' }); return }
      camera.updateMatrixWorld()
      const boxes = siteBoxes.map(box => projectBox(box, width, height))
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
      try { placed = placeAnnotations(requests, usableWidth, usableHeight, obstacles) }
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
    const homeDirection = new THREE.Vector3(11.5, 7.4, 18).normalize()
    let homeDistance = 19
    const resize = () => {
      const width = Math.max(1, element.clientWidth)
      const height = Math.max(1, element.clientHeight)
      if (width < 700 && controls.target.distanceToSquared(homeTarget) > .0001) {
        camera.position.add(homeTarget.clone().sub(controls.target))
        controls.target.copy(homeTarget)
        focusing = false
      }
      camera.aspect = width / height
      camera.fov = 36
      camera.updateProjectionMatrix()
      // Fit the entire modeled scene, not a fixed distance: the same framing
      // therefore remains usable for narrow, square and wide panels.
      const visibleIsland = usingGeneratedIsland ? generatedIsland : system
      visibleIsland.updateWorldMatrix(true, true)
      const objectCorners: THREE.Vector3[] = []
      visibleIsland.traverse(object => {
        if (!(object instanceof THREE.Mesh) || object === selectionRing || object.userData.installation) return
        const geometry = object.geometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        const box = geometry.boundingBox
        if (!box) return
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          objectCorners.push(new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld))
        }
      })
      const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize()
      camera.position.copy(controls.target).addScaledVector(direction, 20)
      camera.lookAt(controls.target)
      camera.updateMatrixWorld()
      const inverseRotation = camera.quaternion.clone().invert()
      const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      let distance = 1
      for (const corner of objectCorners) {
        const point = corner.sub(controls.target).applyQuaternion(inverseRotation)
        distance = Math.max(distance, point.z + Math.abs(point.x) / (vertical * camera.aspect * 0.94), point.z + Math.abs(point.y) / (vertical * 0.94))
      }
      // The generated island's bounds include empty corners around its tall
      // turbine; a modest mobile crop reduction makes the real geometry legible.
      if (usingGeneratedIsland && width < 600) distance *= .88
      homeDistance = distance
      camera.position.copy(controls.target).addScaledVector(direction, distance)
      controls.update()
      renderer.setSize(width, height, false)
      scheduleAnnotations()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()

    // Meshy assets can contain just one fused mesh. The invisible pick volumes
    // are therefore independent of mesh names, and serve as the same anchors for
    // picking, camera focus and projected explanatory labels. They are calibrated
    // against the normalized island once the actual generated model is available.
    const disposeGenerated = (root: THREE.Object3D) => {
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      const textures = new Set<THREE.Texture>()
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        geometries.add(object.geometry)
        const itemMaterials = Array.isArray(object.material) ? object.material : [object.material]
        itemMaterials.forEach(material => {
          materials.add(material)
          Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value) })
        })
      })
      geometries.forEach(geometry => geometry.dispose())
      textures.forEach(texture => texture.dispose())
      materials.forEach(material => material.dispose())
    }
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(`${import.meta.env.BASE_URL}assets/meshy/island.glb`, gltf => {
      const model = gltf.scene
      if (destroyed) { disposeGenerated(model); return }
      const bounds = new THREE.Box3().setFromObject(model)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      const span = Math.max(size.x, size.z)
      if (!Number.isFinite(span) || span < 1e-6 || !Number.isFinite(size.y)) {
        disposeGenerated(model)
        setModelUnavailable(true)
        return
      }
      const scale = 10 / span
      model.scale.setScalar(scale)
      model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        object.castShadow = true
        object.receiveShadow = true
      })
      generatedIsland.add(model)
      generatedIsland.updateWorldMatrix(true, true)
      const normalized = new THREE.Box3().setFromObject(model)
      const dimensions = normalized.getSize(new THREE.Vector3())
      const baseY = normalized.min.y
      const height = dimensions.y
      generatedGroundY = baseY + height * .38
      const definitions: Array<{ id: 'production' | 'batterie' | 'consommation'; x: number; y: number; z: number; w: number; h: number; d: number }> = [
        { id: 'production', x: normalized.min.x + dimensions.x * .22, y: baseY + height * .62, z: normalized.min.z + dimensions.z * .50, w: dimensions.x * .18, h: height * .76, d: dimensions.z * .20 },
        { id: 'batterie', x: normalized.min.x + dimensions.x * .29, y: baseY + height * .46, z: normalized.min.z + dimensions.z * .73, w: dimensions.x * .24, h: height * .28, d: dimensions.z * .25 },
        { id: 'consommation', x: normalized.min.x + dimensions.x * .64, y: baseY + height * .46, z: normalized.min.z + dimensions.z * .82, w: dimensions.x * .42, h: height * .32, d: dimensions.z * .35 },
      ]
      const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
      const hits = definitions.map(({ id, x, y, z, w, h, d }) => {
        const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMaterial)
        hit.position.set(x, y, z)
        hit.userData.installation = id
        generatedIsland.add(hit)
        focusPosition[id].set(x, Math.max(baseY, y - h * .25), z)
        return hit
      })
      generatedIsland.updateWorldMatrix(true, true)
      siteBoxes[0].setFromObject(hits[0])
      siteBoxes[1].setFromObject(hits[1])
      siteBoxes[2].setFromObject(hits[2])
      otherBoxes.length = 0
      selectable.splice(0, selectable.length, ...hits)
      // These light paths are symbolic links, not a physical network model.
      // Their visibility and movement are driven by the hour's calculated
      // production, served demand and battery charge/discharge values.
      // The imported mesh's modeled terrain rises above its nominal base;
      // keep the schematic links just clear of that irregular surface.
      const y = generatedGroundY + .48
      const point = (x: number, z: number) => new THREE.Vector3(x, y, z)
      const turbine = point(definitions[0].x, definitions[0].z)
      const store = point(definitions[1].x, definitions[1].z)
      const load = point(definitions[2].x, definitions[2].z)
      const junction = point(normalized.min.x + dimensions.x * .43, normalized.min.z + dimensions.z * .61)
      const specifications: Array<{ kind: GeneratedFlow['kind']; points: THREE.Vector3[] }> = [
        { kind: 'production', points: [turbine, point(turbine.x + .35, turbine.z + .65), junction] },
        { kind: 'load', points: [junction, point(junction.x + .9, junction.z + .85), load] },
        { kind: 'battery', points: [junction, point(store.x + .15, store.z - .4), store] },
      ]
      for (const spec of specifications) {
        const path = new THREE.CatmullRomCurve3(spec.points)
        const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 36, .024, 6, false), generatedFlowMaterial)
        generatedIsland.add(tube)
        const markers = Array.from({ length: 3 }, () => {
          const marker = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), generatedMarkerMaterial)
          marker.renderOrder = 5
          generatedIsland.add(marker)
          return marker
        })
        generatedFlows.push({ path, tube, markers, kind: spec.kind, phase: 0 })
      }
      system.visible = false
      usingGeneratedIsland = true
      generatedIsland.visible = true
      homeTarget.set(0, Math.min(height * .4, 1.1), 0)
      controls.target.copy(homeTarget)
      resize()
      scheduleAnnotations()
    }, undefined, () => {
      // No generated asset (or network/format failure): keep the existing island
      // and tell the visitor that the fallback is shown.
      if (!destroyed) setModelUnavailable(true)
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
      event.preventDefault()
      if (event.key === 'Home') {
        focusing = false
        controls.target.copy(homeTarget)
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
      if (!reducedMotion) {
        const speed = Math.min(currentValues.current.productionMW, 100) * 0.006
        rotors.forEach((rotor, index) => { rotor.rotation.z -= delta * speed * (1 + index * 0.05) })
      }
      const state = currentValues.current
      const stressed = (state.unservedMW ?? state.deficitMW) > 0
      linkMaterial.color.setHex(stressed ? 0xf2ba75 : 0x90f6cc)
      glowMaterial.color.setHex(stressed ? 0xf2ba75 : 0x79edbd)
      const selected = state.selected
      selectionRing.visible = Boolean(selected)
      if (selected) {
        const pos = focusPosition[selected]
        selectionRing.position.set(pos.x, usingGeneratedIsland ? generatedGroundY : .19, pos.z)
      }
      if (focusing) {
        const before = controls.target.clone()
        // Keep the camera's easing consistent across display refresh rates.
        controls.target.lerp(desiredTarget, reducedMotion ? 1 : 1 - Math.exp(-5.66 * delta))
        camera.position.add(controls.target.clone().sub(before))
        if (controls.target.distanceToSquared(desiredTarget) < .0001) focusing = false
      }
      for (const marker of movingMarkers) {
        const power = marker.pathIndex === 0 ? state.productionMW : marker.pathIndex === 3 ? Math.max(state.chargeMW ?? 0, state.dischargeMW ?? 0) : Math.max(0, state.consumptionMW - (state.unservedMW ?? 0))
        marker.mesh.visible = power > .001
        const direction = marker.pathIndex === 3 && (state.chargeMW ?? 0) > 0 ? -1 : 1
        // Advance from the current position so a change of direction does not teleport particles.
        if (!reducedMotion && power > .001) marker.phase = ((marker.phase + direction * delta * .055) % 1 + 1) % 1
        marker.path.getPointAt(marker.phase, marker.mesh.position)
      }
      if (usingGeneratedIsland) {
        generatedFlowMaterial.color.setHex(stressed ? 0xf2ba75 : 0x9bf5d2)
        generatedMarkerMaterial.color.setHex(stressed ? 0xd6a678 : 0xa7dbbe)
        for (const flow of generatedFlows) {
          const power = flow.kind === 'production'
            ? Math.min(Math.max(0, state.productionMW), Math.max(0, state.consumptionMW) + Math.max(0, state.chargeMW ?? 0))
            : flow.kind === 'load' ? Math.max(0, state.consumptionMW - (state.unservedMW ?? 0)) : Math.max(state.chargeMW ?? 0, state.dischargeMW ?? 0)
          flow.tube.visible = power > .001
          const reverse = flow.kind === 'battery' && (state.dischargeMW ?? 0) > 0
          if (!reducedMotion && power > .001) flow.phase = ((flow.phase + (reverse ? -1 : 1) * delta * .055) % 1 + 1) % 1
          flow.markers.forEach((marker, i) => {
            marker.visible = power > .001
            const progress = (i / flow.markers.length + flow.phase) % 1
            flow.path.getPointAt(progress, marker.position)
          })
        }
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
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel)
      focusInstallation.current = null
      destroyed = true
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      const textures = new Set<THREE.Texture>()
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry)
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
          objectMaterials.forEach(material => {
            materials.add(material)
            Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value) })
          })
        }
      })
      geometries.forEach(geometry => geometry.dispose())
      textures.forEach(texture => texture.dispose())
      materials.forEach(material => material.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div
    ref={host}
    role="img"
    tabIndex={0}
    aria-label={webglUnavailable ? 'La vue 3D est indisponible. Les paramètres et les résultats restent accessibles dans les panneaux.' : `${modelUnavailable ? 'Vue simplifiée : modèle généré indisponible. ' : ''}Maquette 3D de l’île : production totale ${formatAccessible(values.productionMW)} MW, batterie ${formatAccessible(values.batteryMWh)} MWh, consommation ${formatAccessible(values.consumptionMW)} MW. Cliquez sur une installation pour ouvrir ses réglages. Faites glisser pour tourner la vue ; au clavier, utilisez les flèches et la touche début pour réinitialiser. Les boutons d'installation associés permettent aussi l'accès au clavier.`}
    style={{ position: 'relative', width: '100%', height: '100%', minHeight: 280, overflow: 'hidden', background: '#090909', cursor: webglUnavailable ? 'default' : 'grab', outlineOffset: '-3px' }}
  >{webglUnavailable && <div style={{ color: '#a1a1aa', padding: '2rem', fontSize: '0.875rem', lineHeight: 1.6 }}>La vue 3D n’est pas disponible dans ce navigateur. Les paramètres et les résultats restent accessibles dans les panneaux autour de la carte.</div>}
  {modelUnavailable && !webglUnavailable && <div role="status" style={{ position: 'absolute', left: 12, bottom: Math.max(12, (values.annotationBottomInset ?? 0) + 8), zIndex: 2, padding: '5px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,.22)', background: 'rgba(15,15,17,.86)', color: '#e4e4e7', fontSize: 11, lineHeight: 1.4, pointerEvents: 'none' }}>Vue simplifiée · modèle indisponible</div>}</div>
}
