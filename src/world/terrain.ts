import * as THREE from 'three';
import { Noise2D } from '../utils/noise';
import { clamp } from '../utils/math';

export const WORLD_SIZE = 440; // metres, square
export const WATER_LEVEL = 0.0;

const SEGMENTS = 190;

const noise = new Noise2D(20260707);
const detail = new Noise2D(998877);

/**
 * Terrain height function — the single source of truth used by the mesh,
 * character grounding, and object scattering.
 */
export function heightAt(x: number, z: number): number {
  const half = WORLD_SIZE / 2;

  // Base rolling hills
  let h = noise.fbm(x * 0.008, z * 0.008, 4) * 14;
  // Broad valley shape
  h += noise.fbm(x * 0.0022 + 5, z * 0.0022 - 3, 2) * 20;
  // Fine detail
  h += detail.fbm(x * 0.05, z * 0.05, 2) * 1.2;

  // Castle hill: a plateau in the north-east
  const chx = 95;
  const chz = -110;
  const cd = Math.hypot(x - chx, z - chz);
  const hillR = 78;
  if (cd < hillR) {
    const t = 1 - cd / hillR;
    const s = t * t * (3 - 2 * t);
    const plateau = 20 - Math.max(0, h);
    h += s * plateau;
    // Flatten the very top for the castle footprint
    if (cd < 34) h = h * 0.15 + 20 * 0.85;
  }

  // Lake basin in the south, like the screenshot's teal cove
  const lx = -70;
  const lz = 120;
  const ld = Math.hypot(x - lx, z - lz);
  const lakeR = 95;
  if (ld < lakeR) {
    const t = 1 - ld / lakeR;
    const s = t * t * (3 - 2 * t);
    h -= s * (14 + Math.max(0, h) * 0.9);
  }

  // Mountain rim so the world reads as a valley (like the canyon backdrop)
  const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
  if (edge > 0.72) {
    const t = (edge - 0.72) / 0.28;
    h += t * t * 85 + noise.fbm(x * 0.02, z * 0.02, 3) * t * 26;
  }

  // Village clearing near spawn (centre-west) so combat has an arena
  const vd = Math.hypot(x + 40, z - 10);
  if (vd < 45) {
    const t = 1 - vd / 45;
    const s = t * t * (3 - 2 * t);
    h = h * (1 - s * 0.8) + 4.0 * s * 0.8;
  }

  return h;
}

export function slopeAt(x: number, z: number): number {
  const e = 0.9;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

// -- palette (matched to the reference screenshots) ------------------------

const C_GRASS_A = new THREE.Color('#6fae3f');
const C_GRASS_B = new THREE.Color('#8bc653');
const C_DIRT = new THREE.Color('#9a7748');
const C_ROCK_A = new THREE.Color('#8d8a85');
const C_ROCK_B = new THREE.Color('#b3b0ab');
const C_SAND = new THREE.Color('#d8c98f');
const C_SNOW = new THREE.Color('#eef0f2');

function colorFor(h: number, slope: number, jitter: number): THREE.Color {
  const c = new THREE.Color();
  if (h < WATER_LEVEL + 1.2) {
    c.copy(C_SAND);
  } else if (slope > 0.85 || h > 42) {
    c.lerpColors(C_ROCK_A, C_ROCK_B, clamp(jitter * 0.5 + 0.5, 0, 1));
    if (h > 66) c.lerp(C_SNOW, clamp((h - 66) / 18, 0, 1));
  } else if (slope > 0.55) {
    c.copy(C_DIRT).lerp(C_ROCK_A, (slope - 0.55) / 0.3);
  } else {
    c.lerpColors(C_GRASS_A, C_GRASS_B, clamp(jitter * 0.5 + 0.5, 0, 1));
  }
  // Slight per-face variance to sell the faceted look
  c.offsetHSL(0, 0, jitter * 0.03);
  return c;
}

export function buildTerrain(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }

  // Flat shading with per-face colors requires non-indexed geometry
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();

  const fpos = flat.attributes.position;
  const colors = new Float32Array(fpos.count * 3);
  const jn = new Noise2D(424242);
  for (let f = 0; f < fpos.count; f += 3) {
    const cx = (fpos.getX(f) + fpos.getX(f + 1) + fpos.getX(f + 2)) / 3;
    const cy = (fpos.getY(f) + fpos.getY(f + 1) + fpos.getY(f + 2)) / 3;
    const cz = (fpos.getZ(f) + fpos.getZ(f + 1) + fpos.getZ(f + 2)) / 3;
    const col = colorFor(cy, slopeAt(cx, cz), jn.noise(cx * 0.35, cz * 0.35));
    for (let v = 0; v < 3; v++) {
      colors[(f + v) * 3] = col.r;
      colors[(f + v) * 3 + 1] = col.g;
      colors[(f + v) * 3 + 2] = col.b;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(flat, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function buildWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.4, WORLD_SIZE * 1.4, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color: '#2fbccc',
    transparent: true,
    opacity: 0.82,
    flatShading: true,
    shininess: 90,
    specular: new THREE.Color('#bff4ff'),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.name = 'water';
  return mesh;
}

/** Gentle vertex bob for the water surface. */
export function animateWater(water: THREE.Mesh, time: number): void {
  const pos = (water.geometry as THREE.PlaneGeometry).attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, Math.sin(x * 0.14 + time * 1.1) * 0.16 + Math.cos(z * 0.11 + time * 0.8) * 0.16);
  }
  pos.needsUpdate = true;
}
