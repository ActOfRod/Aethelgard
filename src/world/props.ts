import * as THREE from 'three';
import { heightAt, slopeAt, WATER_LEVEL, WORLD_SIZE } from './terrain';
import { mulberry32 } from '../utils/noise';
import { randRange } from '../utils/math';

export interface Collider {
  x: number;
  z: number;
  radius: number;
}

export const colliders: Collider[] = [];

function flatMat(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

const MAT = {
  pineWood: flatMat('#7a5230'),
  pineLeaf: flatMat('#3e7d3a'),
  pineLeafDark: flatMat('#2f6330'),
  oakLeaf: flatMat('#79b34a'),
  rock: flatMat('#8d8a85'),
  rockDark: flatMat('#75726e'),
};

// ---------------------------------------------------------------- trees

function makePineGeo(): THREE.BufferGeometry[] {
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 1.6, 5);
  trunk.translate(0, 0.8, 0);
  const tiers: THREE.BufferGeometry[] = [];
  let y = 1.4;
  let r = 1.5;
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.ConeGeometry(r, 1.9, 6);
    cone.translate(0, y + 0.95, 0);
    tiers.push(cone);
    y += 1.15;
    r *= 0.72;
  }
  return [trunk, ...tiers];
}

function makeOakGeo(): THREE.BufferGeometry[] {
  const trunk = new THREE.CylinderGeometry(0.28, 0.42, 1.9, 5);
  trunk.translate(0, 0.95, 0);
  const crown = new THREE.IcosahedronGeometry(1.7, 0);
  crown.translate(0, 3.1, 0);
  return [trunk, crown];
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Manual merge (avoids importing examples/jsm utils)
  let total = 0;
  const nonIndexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of nonIndexed) total += g.attributes.position.count;
  const posArr = new Float32Array(total * 3);
  const normArr = new Float32Array(total * 3);
  let off = 0;
  for (const g of nonIndexed) {
    posArr.set(g.attributes.position.array as Float32Array, off * 3);
    normArr.set(g.attributes.normal.array as Float32Array, off * 3);
    off += g.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  return merged;
}

interface Placement {
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
}

function scatter(
  rand: () => number,
  count: number,
  opts: {
    minH?: number;
    maxSlope?: number;
    minScale: number;
    maxScale: number;
    avoid?: { x: number; z: number; r: number }[];
  },
): Placement[] {
  const out: Placement[] = [];
  const half = WORLD_SIZE / 2 - 14;
  let tries = 0;
  while (out.length < count && tries < count * 30) {
    tries++;
    const x = randRange(rand, -half, half);
    const z = randRange(rand, -half, half);
    const h = heightAt(x, z);
    if (h < (opts.minH ?? WATER_LEVEL + 1.4)) continue;
    if (h > 48) continue;
    if (slopeAt(x, z) > (opts.maxSlope ?? 0.6)) continue;
    if (opts.avoid?.some((a) => Math.hypot(x - a.x, z - a.z) < a.r)) continue;
    out.push({ x, z, y: h, scale: randRange(rand, opts.minScale, opts.maxScale), rot: rand() * Math.PI * 2 });
  }
  return out;
}

const AVOID_ZONES = [
  { x: -40, z: 10, r: 26 }, // village clearing
  { x: 95, z: -110, r: 40 }, // castle plateau
];

function instanced(
  geos: THREE.BufferGeometry[],
  mats: THREE.Material[],
  placements: Placement[],
  collideRadius: number,
  group: THREE.Group,
): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  geos.forEach((geo, gi) => {
    const inst = new THREE.InstancedMesh(geo, mats[Math.min(gi, mats.length - 1)], placements.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    placements.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
      inst.setMatrixAt(i, m);
    });
    group.add(inst);
  });
  if (collideRadius > 0) {
    for (const p of placements) colliders.push({ x: p.x, z: p.z, radius: collideRadius * p.scale });
  }
}

// ---------------------------------------------------------------- castle

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeTower(stone: THREE.Material, roof: THREE.Material, h: number, r: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, h, 8), stone);
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.22, r * 1.22, h * 0.08, 8), stone);
  rim.position.y = h * 0.99;
  rim.castShadow = true;
  g.add(rim);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, h * 0.55, 8), roof);
  cone.position.y = h + h * 0.55 * 0.5;
  cone.castShadow = true;
  g.add(cone);
  return g;
}

export function buildCastle(): THREE.Group {
  const g = new THREE.Group();
  const stone = flatMat('#9b978f');
  const stoneDark = flatMat('#7e7a72');
  const roof = flatMat('#d0662a');
  const roofDark = flatMat('#b5521f');
  const wood = flatMat('#6f4a2a');

  const cx = 95;
  const cz = -110;
  const baseY = heightAt(cx, cz);

  // Curtain wall — an octagonal ring of wall segments with corner towers
  const wallR = 30;
  const sides = 8;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const x0 = Math.cos(a0) * wallR;
    const z0 = Math.sin(a0) * wallR;
    const x1 = Math.cos(a1) * wallR;
    const z1 = Math.sin(a1) * wallR;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;

    // Leave a gate opening on the south-west segment
    if (i !== 5) {
      const wall = box(len, 7, 2.4, stone, mx, 3.5, mz, ang);
      g.add(wall);
      // battlements
      for (let b = -len / 2 + 1; b < len / 2 - 0.5; b += 2.2) {
        const merlon = box(1.1, 1.1, 2.6, stoneDark, mx + Math.cos(ang) * b, 7.5, mz - Math.sin(ang) * b, ang);
        g.add(merlon);
      }
    }

    const tower = makeTower(stone, i % 2 === 0 ? roof : roofDark, 12, 2.6);
    tower.position.set(x0, 0, z0);
    g.add(tower);
    colliders.push({ x: cx + x0, z: cz + z0, radius: 3.2 });
  }

  // Gatehouse flanking the opening
  const gateA = (5.5 / sides) * Math.PI * 2;
  const gx = Math.cos(gateA) * wallR;
  const gz = Math.sin(gateA) * wallR;
  const gateL = makeTower(stone, roof, 14, 3.0);
  gateL.position.set(gx + 5, 0, gz + 3);
  g.add(gateL);
  const gateR = makeTower(stone, roof, 14, 3.0);
  gateR.position.set(gx - 4, 0, gz - 4.5);
  g.add(gateR);
  colliders.push({ x: cx + gx + 5, z: cz + gz + 3, radius: 3.6 });
  colliders.push({ x: cx + gx - 4, z: cz + gz - 4.5, radius: 3.6 });

  // Keep — central hall with tall towers, orange roofs like the screenshot
  const keep = new THREE.Group();
  keep.add(box(16, 12, 12, stone, 0, 6, 0));
  const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(11.5, 7, 4), roof);
  keepRoof.rotation.y = Math.PI / 4;
  keepRoof.position.y = 15.5;
  keepRoof.castShadow = true;
  keep.add(keepRoof);
  const t1 = makeTower(stone, roof, 20, 3.2);
  t1.position.set(9, 0, 7);
  keep.add(t1);
  const t2 = makeTower(stone, roofDark, 25, 2.7);
  t2.position.set(-8, 0, -6);
  keep.add(t2);
  const t3 = makeTower(stone, roof, 17, 2.4);
  t3.position.set(-9, 0, 7);
  keep.add(t3);
  // Great hall annex
  keep.add(box(9, 7, 7, stoneDark, 12, 3.5, -5));
  const annexRoof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 4.5, 4), roofDark);
  annexRoof.rotation.y = Math.PI / 4;
  annexRoof.position.set(12, 9.2, -5);
  annexRoof.castShadow = true;
  keep.add(annexRoof);
  g.add(keep);
  colliders.push({ x: cx, z: cz, radius: 11 });
  colliders.push({ x: cx + 12, z: cz - 5, radius: 5.5 });

  // Banners on the keep towers
  const bannerMat = flatMat('#c0392b');
  for (const [bx, bz, by] of [
    [9, 7, 32],
    [-8, -6, 39],
  ] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 4), wood);
    pole.position.set(bx, by, bz);
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), bannerMat);
    flag.material.side = THREE.DoubleSide;
    flag.position.set(bx + 0.85, by + 1.1, bz);
    g.add(flag);
  }

  g.position.set(cx, baseY - 0.4, cz);
  return g;
}

// ---------------------------------------------------------------- village

function makeHouse(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const wallMat = flatMat(rand() > 0.5 ? '#c9b28a' : '#b39a76');
  const roofMat = flatMat(rand() > 0.4 ? '#c2542a' : '#8a5a33');
  const w = randRange(rand, 3.6, 5.2);
  const d = randRange(rand, 3.2, 4.4);
  const h = randRange(rand, 2.4, 3.1);
  g.add(box(w, h, d, wallMat, 0, h / 2, 0));

  // Rectangular pyramid roof: rotate a 4-sided cone so its corners sit on the
  // diagonals, then scale to the house footprint (plus a small overhang).
  const roofGeo = new THREE.ConeGeometry(1, 1, 4);
  roofGeo.rotateY(Math.PI / 4);
  const roofH = 1.6 + rand() * 0.6;
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.scale.set((w / 2 + 0.45) / 0.707, roofH, (d / 2 + 0.45) / 0.707);
  roof.position.y = h + roofH / 2;
  roof.castShadow = true;
  g.add(roof);

  const chimney = box(0.5, 1.4, 0.5, flatMat('#8d8a85'), w * 0.25, h + 1.2, d * 0.2);
  g.add(chimney);
  return g;
}

export function buildVillage(): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(777);
  const spots: [number, number, number][] = [
    [-52, 2, 0.4],
    [-44, 20, 2.2],
    [-30, 16, 1.1],
    [-28, -2, -0.6],
    [-50, -10, 2.6],
  ];
  for (const [x, z, ry] of spots) {
    const house = makeHouse(rand);
    house.position.set(x, heightAt(x, z) - 0.15, z);
    house.rotation.y = ry;
    g.add(house);
    colliders.push({ x, z, radius: 3.4 });
  }

  // A well at the village centre
  const well = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.9, 7), flatMat('#8d8a85'));
  ring.position.y = 0.45;
  ring.castShadow = true;
  well.add(ring);
  const roofP1 = box(0.14, 1.8, 0.14, flatMat('#6f4a2a'), -0.9, 1.4, 0);
  const roofP2 = box(0.14, 1.8, 0.14, flatMat('#6f4a2a'), 0.9, 1.4, 0);
  well.add(roofP1, roofP2);
  const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.0, 4), flatMat('#c2542a'));
  wellRoof.rotation.y = Math.PI / 4;
  wellRoof.position.y = 2.7;
  wellRoof.castShadow = true;
  well.add(wellRoof);
  well.position.set(-40, heightAt(-40, 10), 10);
  g.add(well);
  colliders.push({ x: -40, z: 10, radius: 1.5 });

  return g;
}

// ---------------------------------------------------------------- scatter all

export function buildNature(): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(31415);

  const pineGeos = makePineGeo();
  const pinePlacements = scatter(rand, 420, {
    minScale: 0.8,
    maxScale: 1.9,
    maxSlope: 0.55,
    avoid: AVOID_ZONES,
  });
  instanced(pineGeos, [MAT.pineWood, MAT.pineLeaf, MAT.pineLeafDark, MAT.pineLeaf], pinePlacements, 0.5, g);

  const oakGeos = makeOakGeo();
  const oakPlacements = scatter(rand, 130, {
    minScale: 0.8,
    maxScale: 1.5,
    maxSlope: 0.45,
    avoid: AVOID_ZONES,
  });
  instanced(oakGeos, [MAT.pineWood, MAT.oakLeaf], oakPlacements, 0.55, g);

  // Rocks — some huge like the screenshot boulders
  const rockGeo = mergeGeos([new THREE.IcosahedronGeometry(1, 0)]);
  const rockPlacements = scatter(rand, 180, {
    minH: WATER_LEVEL - 3,
    minScale: 0.5,
    maxScale: 3.4,
    maxSlope: 1.6,
  });
  instanced([rockGeo], [MAT.rock], rockPlacements, 0.85, g);

  const bigRockPlacements = scatter(rand, 26, {
    minH: WATER_LEVEL - 4,
    minScale: 4,
    maxScale: 9,
    maxSlope: 2.0,
  });
  instanced([rockGeo], [MAT.rockDark], bigRockPlacements, 0.8, g);

  // Bushes
  const bushGeo = mergeGeos([new THREE.IcosahedronGeometry(0.7, 0)]);
  const bushPlacements = scatter(rand, 260, {
    minScale: 0.6,
    maxScale: 1.4,
    maxSlope: 0.5,
    avoid: AVOID_ZONES,
  });
  instanced([bushGeo], [MAT.oakLeaf], bushPlacements, 0, g);

  return g;
}
