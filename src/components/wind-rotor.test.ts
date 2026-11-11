import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { isolateWindRotor } from './wind-rotor.ts'

test('splits calibrated triangle indices without copying or changing UVs and material', () => {
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.BufferAttribute(new Float32Array(357270 * 3), 3)
  const uv = new THREE.BufferAttribute(new Float32Array(357270 * 2), 2)
  const index = new Uint32Array(1919988)
  for (let i = 0; i < index.length; i++) index[i] = i % position.count
  geometry.setAttribute('position', position)
  geometry.setAttribute('uv', uv)
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  const material = new THREE.MeshStandardMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  const pivot = isolateWindRotor(mesh)
  assert.ok(pivot)
  const blades = pivot.children[0] as THREE.Mesh
  assert.equal(blades.material, material)
  assert.equal(blades.geometry.getAttribute('position'), position)
  assert.equal(blades.geometry.getAttribute('uv'), uv)
  assert.equal(blades.geometry.getIndex()!.count, 4936 * 3)
  assert.equal(mesh.geometry.getIndex()!.count + blades.geometry.getIndex()!.count, index.length)
  mesh.updateMatrixWorld(true)
  const initial = blades.localToWorld(new THREE.Vector3(15000, 34000, 31900))
  assert.ok(initial.distanceTo(new THREE.Vector3(15000, 34000, 31900)) < 1e-9)
  pivot.rotation.z = Math.PI / 2
  mesh.updateMatrixWorld(true)
  const rotated = blades.localToWorld(new THREE.Vector3(15000, 34000, 31900))
  assert.ok(rotated.distanceTo(new THREE.Vector3(11600, 34900, 31900)) < 1e-9)
})

test('does not alter an unrelated model', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  assert.equal(isolateWindRotor(mesh), null)
  assert.equal(mesh.children.length, 0)
})
