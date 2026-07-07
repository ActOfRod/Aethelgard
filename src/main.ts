import './style.css';
import * as THREE from 'three';
import { buildTerrain, buildWater, animateWater } from './world/terrain';
import { buildNature, buildCastle, buildVillage } from './world/props';
import { Input } from './core/input';
import { Player } from './game/player';
import { Pawn } from './game/pawn';
import { Goblin, Troll } from './game/enemies';
import { Hud } from './game/hud';
import { clamp, damp, lerp } from './utils/math';
import { mulberry32 } from './utils/noise';

const app = document.getElementById('app')!;

// ------------------------------------------------------------ renderer

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8ec8e8');
scene.fog = new THREE.Fog('#a8d4ea', 90, 380);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------ lights

const hemi = new THREE.HemisphereLight('#bfe3ff', '#5a7a45', 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight('#fff2d8', 2.0);
sun.position.set(120, 160, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 500;
const SHADOW_EXTENT = 90;
sun.shadow.camera.left = -SHADOW_EXTENT;
sun.shadow.camera.right = SHADOW_EXTENT;
sun.shadow.camera.top = SHADOW_EXTENT;
sun.shadow.camera.bottom = -SHADOW_EXTENT;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target);

// ------------------------------------------------------------ world

scene.add(buildTerrain());
const water = buildWater();
scene.add(water);
scene.add(buildNature());
scene.add(buildCastle());
scene.add(buildVillage());

// drifting low-poly clouds
const clouds: THREE.Mesh[] = [];
{
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, transparent: true, opacity: 0.92 });
  const crand = mulberry32(2024);
  for (let i = 0; i < 14; i++) {
    const geo = new THREE.IcosahedronGeometry(6 + crand() * 9, 0);
    geo.scale(1.7, 0.55, 1.1);
    const m = new THREE.Mesh(geo, cloudMat);
    m.position.set((crand() - 0.5) * 700, 95 + crand() * 45, (crand() - 0.5) * 700);
    scene.add(m);
    clouds.push(m);
  }
}

// ------------------------------------------------------------ entities

const input = new Input(renderer.domElement);
const hud = new Hud(document.body);

const player = new Player(scene);
let brineCd = 0;
player.onBrine = () => {
  if (brineCd > 0) return;
  brineCd = 6;
  hud.bark('IDRIS', 'Stay clear of deep water, Arisen — the Brine hungers!', 3.5);
};
const pawn = new Pawn(scene);
pawn.onBark = (text) => hud.bark('IDRIS', text);

const goblins: Goblin[] = [];
const GOBLIN_CAMPS: [number, number][] = [
  [-10, 50],
  [-15, 56],
  [-4, 57],
  [10, 30],
  [14, 36],
  [5, 34],
  [-50, -95],
  [-45, -90],
  [-55, -100],
  [122, 0],
  [126, 8],
];
for (const [x, z] of GOBLIN_CAMPS) {
  const g = new Goblin(scene, x, z);
  g.onHitPlayer = (dmg) => {
    const dealt = player.takeDamage(dmg);
    if (dealt > 0) {
      hud.damageNumber(player.pos.clone().add(new THREE.Vector3(0, 1.6, 0)), dealt, camera, 'player-hurt');
    }
  };
  goblins.push(g);
}

const troll = new Troll(scene, 100, -60);
troll.onRoar = () => {
  hud.centerMessage('THE VALLEY TROLL AWAKENS', 3.5);
  hud.setObjective('Slay the Valley Troll — climb it and strike the rune!');
};
troll.onHitPlayer = (dmg, radius, origin) => {
  if (player.pos.distanceTo(origin) < radius) {
    const dealt = player.takeDamage(dmg);
    if (dealt > 0) {
      hud.damageNumber(player.pos.clone().add(new THREE.Vector3(0, 1.6, 0)), dealt, camera, 'player-hurt');
    }
  }
  if (pawn.pos.distanceTo(origin) < radius) pawn.takeDamage(dmg);
};

// ------------------------------------------------------------ combat wiring

const KILL_GOAL = 8;
let kills = 0;
let trollIntroduced = false;
let victory = false;

player.onAttack = (e) => {
  let hitAny = false;
  for (const g of goblins) {
    if (g.dead) continue;
    const to = new THREE.Vector3().subVectors(g.pos, player.pos);
    to.y = 0;
    const d = to.length();
    if (d > e.range) continue;
    to.normalize();
    if (to.dot(e.dir) < Math.cos(e.arc)) continue;
    const crit = Math.random() < 0.18;
    const dmg = e.damage * (crit ? 1.8 : 1);
    g.takeDamage(dmg);
    hud.damageNumber(g.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), dmg, camera, crit ? 'crit' : '');
    hitAny = true;
    if (g.dead) {
      kills++;
      hud.setKills(kills, KILL_GOAL);
      if (kills >= KILL_GOAL && !trollIntroduced) {
        trollIntroduced = true;
        hud.centerMessage('QUEST COMPLETE', 2.5);
        setTimeout(() => {
          hud.setObjective('A great beast slumbers south of the castle hill...');
          hud.bark('IDRIS', 'Well fought! But something larger stirs to the east...', 5);
        }, 2600);
      }
    }
  }

  // troll body / rune hits
  if (!troll.dead) {
    if (player.climbing) {
      // strikes while climbing hit the rune
      const dmg = e.damage;
      troll.takeDamage(dmg, true);
      hud.damageNumber(troll.runeWorld, dmg * 3, camera, 'crit');
      hitAny = true;
    } else {
      const d = player.pos.distanceTo(troll.pos);
      if (d < e.range + 2.4) {
        troll.takeDamage(e.damage);
        hud.damageNumber(
          troll.pos.clone().add(new THREE.Vector3(0, 3, 0)),
          e.damage,
          camera,
          '',
        );
        hitAny = true;
      }
    }
  }

  if (hitAny) shake = Math.max(shake, e.heavy ? 0.35 : 0.15);
};

// ------------------------------------------------------------ camera rig

let camYaw = Math.PI * 0.9;
let camPitch = 0.32;
let camDist = 7.5;
let shake = 0;
const camPos = new THREE.Vector3(0, 10, 10);
const camLook = new THREE.Vector3();

function updateCamera(dt: number): void {
  camYaw -= input.mouseDX * 0.0026;
  camPitch = clamp(camPitch + input.mouseDY * 0.0022, -0.5, 1.15);

  const targetDist = player.climbing ? 9.5 : 7.5;
  camDist = lerp(camDist, targetDist, damp(4, dt));

  const anchor = player.pos.clone().add(new THREE.Vector3(0, 2.1, 0));
  const off = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch),
  ).multiplyScalar(camDist);
  const desired = anchor.clone().add(off);

  // keep camera above terrain
  const terrainY = Math.max(
    ...[0, 0.4, 0.8].map((f) => {
      const p = anchor.clone().lerp(desired, f === 0 ? 1 : f);
      return groundSafe(p.x, p.z) + 0.6;
    }),
  );
  if (desired.y < terrainY) desired.y = terrainY;

  camPos.lerp(desired, damp(12, dt));
  camLook.lerp(anchor, damp(16, dt));

  camera.position.copy(camPos);
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.6);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  }
  camera.lookAt(camLook);
}

import { heightAt } from './world/terrain';
function groundSafe(x: number, z: number): number {
  return heightAt(x, z);
}

// ------------------------------------------------------------ climbing

let climbShakeGrace = 0;

function updateClimb(dt: number): void {
  if (player.dead || troll.dead) {
    if (player.climbing) detach();
    return;
  }

  if (!player.climbing) {
    const nearLatch = player.pos.distanceTo(troll.latchPoint) < 3.4;
    if (troll.climbable && nearLatch) {
      hud.setPrompt('Climb the troll');
      if (input.justPressed('Space')) {
        player.climbing = true;
        climbShakeGrace = 0.6;
        hud.bark('IDRIS', 'Now! Strike the rune upon its back!', 3);
      }
    } else {
      hud.setPrompt(null);
    }
    return;
  }

  hud.setPrompt(null);

  // stick to the troll's back, facing into it
  player.pos.copy(troll.latchPoint);
  player.heading = troll.heading;

  climbShakeGrace = Math.max(0, climbShakeGrace - dt);

  // shaken off or out of stamina
  if ((troll.shaking && climbShakeGrace <= 0 && Math.random() < dt * 2.2) || player.sp <= 0) {
    detach(true);
    return;
  }

  if (input.justPressed('Space')) detach();
}

function detach(thrown = false): void {
  player.climbing = false;
  // Push away from the troll's back (opposite its facing)
  const away = new THREE.Vector3(-Math.sin(troll.heading), 0, -Math.cos(troll.heading));
  player.pos.add(away.multiplyScalar(2.5));
  player.vel.set(away.x * (thrown ? 9 : 3), thrown ? 7 : 3, away.z * (thrown ? 9 : 3));
  if (thrown) {
    player.takeDamage(8);
    shake = 0.4;
  }
}

// ------------------------------------------------------------ overlays

function makeOverlay(title: string, subtitle: string, button: string, death = false): { el: HTMLElement; btn: HTMLElement } {
  const el = document.createElement('div');
  el.className = `overlay${death ? ' death' : ''}`;
  el.innerHTML = `
    <h1>${title}</h1>
    <div class="subtitle">${subtitle}</div>
    <button class="play">${button}</button>
    ${
      death
        ? ''
        : `<div class="controls">
      <b>WASD</b><span>Move</span>
      <b>MOUSE</b><span>Look</span>
      <b>LMB</b><span>Light attack</span>
      <b>E</b><span>Heavy attack</span>
      <b>RMB hold</b><span>Block</span>
      <b>Q</b><span>Dodge roll</span>
      <b>SHIFT</b><span>Sprint</span>
      <b>SPACE</b><span>Jump · Climb</span>
    </div>`
    }
  `;
  document.body.appendChild(el);
  return { el, btn: el.querySelector('.play') as HTMLElement };
}

const title = makeOverlay('AETHELGARD', 'A low-poly fantasy adventure', 'Begin the Journey');
let started = false;
title.btn.addEventListener('click', () => {
  title.el.classList.add('hidden');
  started = true;
  input.requestLock();
  hud.setKills(0, KILL_GOAL);
  hud.bark('IDRIS', 'Aught you need, Arisen — my sword is yours.', 4);
});

renderer.domElement.addEventListener('click', () => {
  if (started) input.requestLock();
});

let deathOverlay: { el: HTMLElement; btn: HTMLElement } | null = null;

function showDeath(): void {
  if (deathOverlay) return;
  deathOverlay = makeOverlay('YOU DIED', 'The Seneschal claims another', 'Rise Again', true);
  deathOverlay.btn.addEventListener('click', () => {
    deathOverlay!.el.remove();
    deathOverlay = null;
    // respawn at the village
    player.dead = false;
    player.hp = player.maxHp;
    player.sp = player.maxSp;
    player.pos.set(-40, 0, 22);
    player.pos.y = groundSafe(-40, 22);
    player.vel.set(0, 0, 0);
    player.rig.state = 'idle';
    player.rig.root.rotation.set(0, 0, 0);
    input.requestLock();
  });
}

function showVictory(): void {
  if (victory) return;
  victory = true;
  hud.setBoss(null);
  hud.centerMessage('THE VALLEY TROLL IS SLAIN', 5);
  hud.setObjective('Victory! Explore the valley as you please.');
  setTimeout(() => hud.bark('IDRIS', 'A deed worthy of legend, Arisen!', 5), 1800);
}

// ------------------------------------------------------------ main loop

let lastTime = performance.now();
let elapsed = 0;

// Debug/testing hook (harmless in production, invaluable for automated QA)
declare global {
  interface Window {
    __game?: {
      player: Player;
      troll: Troll;
      goblins: Goblin[];
      pawn: Pawn;
      input: Input;
      setCam: (yaw: number, pitch: number) => void;
    };
  }
}
window.__game = {
  player,
  troll,
  goblins,
  pawn,
  input,
  setCam: (yaw: number, pitch: number) => {
    camYaw = yaw;
    camPitch = pitch;
  },
};

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  elapsed += dt;

  animateWater(water, elapsed);
  for (const c of clouds) {
    c.position.x += dt * 1.6;
    if (c.position.x > 380) c.position.x = -380;
  }

  if (started) {
    brineCd = Math.max(0, brineCd - dt);
    updateClimb(dt);
    player.update(dt, input, camYaw);
    pawn.update(dt, player.pos, goblins, troll);

    for (let i = goblins.length - 1; i >= 0; i--) {
      const remove = goblins[i].update(dt, player);
      if (remove) {
        scene.remove(goblins[i].rig.root);
        goblins.splice(i, 1);
      }
    }

    troll.update(dt, player, player.climbing);

    // boss bar visibility
    if (!troll.dead && troll.phase !== 'sleep') {
      hud.setBoss('THE VALLEY TROLL', troll.hp / troll.maxHp);
    } else {
      hud.setBoss(null);
    }
    if (troll.dead) showVictory();

    if (player.dead) showDeath();

    hud.setVitals(player.hp, player.maxHp, player.sp, player.maxSp);
    hud.update(dt);
  }

  updateCamera(dt);

  // keep the shadow camera centred on the player so shadows stay crisp
  sun.position.set(player.pos.x + 90, 140, player.pos.z + 45);
  sun.target.position.set(player.pos.x, player.pos.y, player.pos.z);

  renderer.render(scene, camera);
  input.endFrame();
}

frame();
