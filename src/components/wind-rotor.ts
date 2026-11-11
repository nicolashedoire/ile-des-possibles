import * as THREE from 'three'
import { rotorFaceOffsets, rotorPivot } from './wind-rotor-faces.ts'

/** Split the calibrated Meshy turbine blades without changing their UVs or material. */
export function isolateWindRotor(mesh: THREE.Mesh): THREE.Group | null {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  // The face offsets refer to one particular revision of the optimized island.
  if (!position || position.count !== 357270 || !index || index.count !== 1919988) return null

  const selected = new Set(rotorFaceOffsets)
  const rotorIndex = new Uint32Array(rotorFaceOffsets.length * 3)
  const islandIndex = new Uint32Array(index.count - rotorIndex.length)
  let islandCursor = 0, rotorCursor = 0
  for (let offset = 0; offset < index.count; offset += 3) {
    const belongsToRotor = selected.has(offset)
    const target = belongsToRotor ? rotorIndex : islandIndex
    let cursor = belongsToRotor ? rotorCursor : islandCursor
    target[cursor++] = index.getX(offset)
    target[cursor++] = index.getX(offset + 1)
    target[cursor++] = index.getX(offset + 2)
    if (belongsToRotor) rotorCursor = cursor
    else islandCursor = cursor
  }

  const rotorGeometry = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) rotorGeometry.setAttribute(name, attribute)
  rotorGeometry.setIndex(new THREE.BufferAttribute(rotorIndex, 1))
  geometry.setIndex(new THREE.BufferAttribute(islandIndex, 1))
  const rotor = new THREE.Mesh(rotorGeometry, mesh.material)
  rotor.castShadow = mesh.castShadow
  rotor.receiveShadow = mesh.receiveShadow
  rotor.position.set(-rotorPivot[0], -rotorPivot[1], -rotorPivot[2])
  const pivot = new THREE.Group()
  pivot.position.set(...rotorPivot)
  pivot.add(rotor)
  mesh.add(pivot)
  return pivot
}
