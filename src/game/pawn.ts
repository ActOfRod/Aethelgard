import * as THREE from 'three';
import { HumanoidRig } from '../characters/humanoid';
import { clamp, damp, lerpAngle } from '../utils/math';
import { groundY, isDeepWater, resolveStatics } from './physics';
import { mulberry32 } from '../utils/noise';
import type { Goblin, Troll } from './enemies';

const rand = mulberry32(9090);

const BARKS_IDLE = [
  'A fine day for adventure, Arisen.',
  'The castle to the north-east — shall we scout it?',
  'I sense goblins nearby. Stay sharp.',
  "'Tis a beautiful valley, is it not?",
];
const BARKS_COMBAT = [
  'Goblins! Ware their clubs!',
  'For the Arisen!',
  'Strike now — they falter!',
  "I'll draw their eyes!",
];
const BARKS_TROLL = [
  "A troll! Climb its back — aim for the glowing rune!",
  "Its hide is thick — the rune is its weakness!",
  'Hold fast, Arisen!',
];

export class Pawn {
  rig: HumanoidRig;
  pos = new THREE.Vector3(-37, 0, 24);
  hp = 160;
  maxHp = 160;
  dead = false;

  private heading = 0;
  private attackAnim = 0;
  private attackCd = 0;
  private barkCd = 6;
  private revive = 0;

  onBark: ((text: string) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.rig = new HumanoidRig({
      skin: '#e5c39a',
      hair: '#d8c46a', // blond, like the green-clad ranger in the screenshot
      torso: '#7ba24e',
      arms: '#5c7a3a',
      legs: '#4d5c3a',
      boots: '#5b3a26',
      belt: '#54331d',
      weapon: 'sword',
    });
    this.pos.y = groundY(this.pos.x, this.pos.z);
    scene.add(this.rig.root);
  }

  takeDamage(amount: number): void {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.revive = 10;
      this.rig.state = 'dead';
      this.onBark?.('Forgive me... Arisen...');
    }
  }

  update(dt: number, playerPos: THREE.Vector3, goblins: Goblin[], troll: Troll | null): void {
    if (this.dead) {
      this.rig.update(dt);
      this.revive -= dt;
      if (this.revive <= 0) {
        this.dead = false;
        this.hp = this.maxHp * 0.6;
        this.rig.state = 'idle';
        this.rig.root.rotation.x = 0;
        this.onBark?.('I stand once more!');
      }
      return;
    }

    this.hp = clamp(this.hp + dt * 1.5, 0, this.maxHp);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.barkCd -= dt;

    // pick nearest live goblin within awareness
    let nearest: Goblin | null = null;
    let nd = 24;
    for (const g of goblins) {
      if (g.dead) continue;
      const d = g.pos.distanceTo(this.pos);
      if (d < nd) {
        nd = d;
        nearest = g;
      }
    }
    const trollActive = troll && !troll.dead && troll.phase !== 'sleep';

    let vx = 0;
    let vz = 0;

    if (this.attackAnim > 0) {
      this.attackAnim -= dt;
      const t = 1 - this.attackAnim / 0.55;
      this.rig.attackT = clamp(t, 0, 1);
      if (t > 0.45 && t < 0.58 && nearest && nearest.pos.distanceTo(this.pos) < 2.4) {
        nearest.takeDamage(12);
      }
      if (this.attackAnim <= 0) {
        this.rig.state = 'idle';
        this.attackCd = 0.8 + rand() * 0.6;
      }
    } else if (nearest) {
      const to = new THREE.Vector3().subVectors(nearest.pos, this.pos);
      to.y = 0;
      const d = to.length();
      if (d > 1.9) {
        vx = (to.x / d) * 5.0;
        vz = (to.z / d) * 5.0;
      } else if (this.attackCd <= 0) {
        this.attackAnim = 0.55;
        this.rig.state = 'attack';
        this.rig.attackT = 0;
      }
      this.heading = lerpAngle(this.heading, Math.atan2(to.x, to.z), damp(10, dt));
      if (this.barkCd <= 0) {
        this.barkCd = 7 + rand() * 6;
        this.onBark?.(BARKS_COMBAT[Math.floor(rand() * BARKS_COMBAT.length)]);
      }
    } else {
      // follow the player, keeping a comfortable distance
      const to = new THREE.Vector3().subVectors(playerPos, this.pos);
      to.y = 0;
      const d = to.length();
      if (d > 26) {
        // teleport if left far behind (classic pawn behaviour)
        this.pos.copy(playerPos).add(new THREE.Vector3(2, 0, 2));
      } else if (d > 3.4) {
        const s = d > 10 ? 8.6 : 5.0;
        vx = (to.x / d) * s;
        vz = (to.z / d) * s;
        this.heading = lerpAngle(this.heading, Math.atan2(to.x, to.z), damp(8, dt));
      }
      if (this.barkCd <= 0) {
        this.barkCd = 14 + rand() * 14;
        const pool = trollActive ? BARKS_TROLL : BARKS_IDLE;
        this.onBark?.(pool[Math.floor(rand() * pool.length)]);
      }
    }

    if (trollActive && this.barkCd <= 0) {
      this.barkCd = 9 + rand() * 5;
      this.onBark?.(BARKS_TROLL[Math.floor(rand() * BARKS_TROLL.length)]);
    }

    const nx = this.pos.x + vx * dt;
    const nz = this.pos.z + vz * dt;
    if (!isDeepWater(nx, nz)) {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    const solved = resolveStatics(this.pos.x, this.pos.z, 0.45);
    this.pos.x = solved.x;
    this.pos.z = solved.z;
    this.pos.y = groundY(this.pos.x, this.pos.z);

    this.rig.moveSpeed = clamp(Math.hypot(vx, vz) / 9, 0, 1);
    if (this.attackAnim <= 0) {
      this.rig.state = this.rig.moveSpeed > 0.05 ? 'move' : 'idle';
    }
    this.rig.update(dt);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.heading;
  }
}
