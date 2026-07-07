import * as THREE from 'three';
import { HumanoidRig, makeTroll, type TrollParts } from '../characters/humanoid';
import { clamp, damp, lerpAngle } from '../utils/math';
import { groundY, isDeepWater, resolveStatics } from './physics';
import { mulberry32 } from '../utils/noise';

export interface Target {
  pos: THREE.Vector3;
  takeDamage(amount: number): void;
  dead: boolean;
}

const rand = mulberry32(555);

// ------------------------------------------------------------------ goblin

export class Goblin {
  rig: HumanoidRig;
  pos: THREE.Vector3;
  hp = 40;
  maxHp = 40;
  dead = false;
  removeTimer = 3;

  private heading = rand() * Math.PI * 2;
  private attackCd = 0;
  private attackAnim = 0;
  private hurtTimer = 0;
  private wanderAngle = rand() * Math.PI * 2;
  private wanderTimer = 0;
  private home: THREE.Vector3;

  onHitPlayer: ((damage: number) => void) | null = null;

  constructor(scene: THREE.Scene, x: number, z: number) {
    this.rig = new HumanoidRig(
      {
        skin: '#7fae4a',
        hair: '#2f4423',
        torso: '#6b4726',
        arms: '#7fae4a',
        legs: '#54331d',
        boots: '#3d2716',
        weapon: 'club',
      },
      0.75,
    );
    this.pos = new THREE.Vector3(x, groundY(x, z), z);
    this.home = this.pos.clone();
    scene.add(this.rig.root);
  }

  takeDamage(amount: number): void {
    if (this.dead) return;
    this.hp -= amount;
    this.hurtTimer = 0.3;
    if (this.hp <= 0) {
      this.dead = true;
      this.rig.state = 'dead';
    }
  }

  /** Returns true when the corpse should be removed from the scene. */
  update(dt: number, target: Target): boolean {
    if (this.dead) {
      this.rig.update(dt);
      this.removeTimer -= dt;
      if (this.removeTimer < 1) {
        this.rig.root.position.y = this.pos.y - (1 - this.removeTimer) * 1.2; // sink
      }
      return this.removeTimer <= 0;
    }

    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);

    const toPlayer = new THREE.Vector3().subVectors(target.pos, this.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    let vx = 0;
    let vz = 0;
    let speed = 0;

    if (this.attackAnim > 0) {
      this.attackAnim -= dt;
      const t = 1 - this.attackAnim / 0.6;
      this.rig.attackT = clamp(t, 0, 1);
      if (t > 0.45 && t < 0.55 && dist < 2.1 && !target.dead) {
        this.onHitPlayer?.(8 + Math.floor(rand() * 5));
      }
      if (this.attackAnim <= 0) {
        this.rig.state = 'idle';
        this.attackCd = 0.9 + rand() * 0.8;
      }
    } else if (!target.dead && dist < 26) {
      // chase
      if (dist > 1.7) {
        speed = 4.2;
        vx = (toPlayer.x / dist) * speed;
        vz = (toPlayer.z / dist) * speed;
      } else if (this.attackCd <= 0) {
        this.attackAnim = 0.6;
        this.rig.state = 'attack';
        this.rig.attackT = 0;
      }
      const th = Math.atan2(toPlayer.x, toPlayer.z);
      this.heading = lerpAngle(this.heading, th, damp(10, dt));
    } else {
      // wander near home
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2 + rand() * 3;
        const toHome = new THREE.Vector3().subVectors(this.home, this.pos);
        this.wanderAngle =
          toHome.length() > 14 ? Math.atan2(toHome.x, toHome.z) : rand() * Math.PI * 2;
      }
      speed = 1.3;
      vx = Math.sin(this.wanderAngle) * speed;
      vz = Math.cos(this.wanderAngle) * speed;
      this.heading = lerpAngle(this.heading, Math.atan2(vx, vz), damp(6, dt));
    }

    const nx = this.pos.x + vx * dt;
    const nz = this.pos.z + vz * dt;
    if (!isDeepWater(nx, nz)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      this.wanderTimer = 0; // pick a new direction next frame
    }
    const solved = resolveStatics(this.pos.x, this.pos.z, 0.4);
    this.pos.x = solved.x;
    this.pos.z = solved.z;
    this.pos.y = groundY(this.pos.x, this.pos.z);

    this.rig.moveSpeed = clamp(Math.hypot(vx, vz) / 6, 0, 1);
    if (this.attackAnim <= 0) {
      this.rig.state = this.hurtTimer > 0 ? 'hurt' : this.rig.moveSpeed > 0.05 ? 'move' : 'idle';
    }
    this.rig.update(dt);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.heading;
    return false;
  }
}

// ------------------------------------------------------------------ troll

export type TrollPhase = 'sleep' | 'fight' | 'stagger' | 'dead';

/**
 * The valley troll — a large climbable boss in the spirit of Dragon's Dogma.
 * The player can latch on (Space near its back) and strike the glowing rune.
 */
export class Troll {
  root: THREE.Group;
  parts: TrollParts;
  pos: THREE.Vector3;
  hp = 600;
  maxHp = 600;
  dead = false;
  phase: TrollPhase = 'sleep';
  heading = 0;

  /** World position of the climb latch point (behind its back). */
  latchPoint = new THREE.Vector3();
  runeWorld = new THREE.Vector3();

  private t = 0;
  private attackAnim = 0;
  private attackKind: 'smash' | 'sweep' = 'smash';
  private attackCd = 2;
  private staggerTimer = 0;
  private shakeTimer = 0;
  private deathT = 0;

  onHitPlayer: ((damage: number, radius: number, origin: THREE.Vector3) => void) | null = null;
  onRoar: (() => void) | null = null;

  constructor(scene: THREE.Scene, x: number, z: number) {
    const { root, parts } = makeTroll();
    this.root = root;
    this.parts = parts;
    this.pos = new THREE.Vector3(x, groundY(x, z), z);
    this.root.position.copy(this.pos);
    scene.add(root);
  }

  get climbable(): boolean {
    return this.phase === 'fight' || this.phase === 'stagger';
  }

  takeDamage(amount: number, onRune = false): void {
    if (this.dead) return;
    if (this.phase === 'sleep') {
      this.phase = 'fight';
      this.onRoar?.();
    }
    const dealt = onRune ? amount * 3 : amount;
    this.hp -= dealt;
    if (onRune) {
      this.staggerTimer = 2.2;
      this.phase = 'stagger';
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.phase = 'dead';
    }
  }

  /** True while the player riding on the back should be shaken off. */
  get shaking(): boolean {
    return this.shakeTimer > 0;
  }

  update(dt: number, target: Target, playerClimbing: boolean): void {
    this.t += dt;

    // update world-space reference points
    const back = new THREE.Vector3(0, 4.4, -2.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    this.latchPoint.copy(this.pos).add(back);
    this.parts.rune.getWorldPosition(this.runeWorld);

    if (this.phase === 'dead') {
      this.deathT = Math.min(1, this.deathT + dt * 0.7);
      const d = this.deathT;
      this.root.rotation.x = -d * 1.35;
      this.root.position.y = this.pos.y - d * 1.0;
      (this.parts.rune.material as THREE.MeshBasicMaterial).color.setScalar(0.25);
      return;
    }

    // pulse the weak-point rune
    const pulse = 0.75 + Math.sin(this.t * 5) * 0.25;
    (this.parts.rune.material as THREE.MeshBasicMaterial).color.setRGB(pulse, 0.28 * pulse, 0.15);

    if (this.phase === 'sleep') {
      // slumped, breathing
      this.parts.torso.rotation.x = 0.5 + Math.sin(this.t * 0.9) * 0.03;
      this.parts.head.rotation.x = 0.5;
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.heading;
      const d = this.pos.distanceTo(target.pos);
      if (d < 11 && !target.dead) {
        this.phase = 'fight';
        this.onRoar?.();
      }
      return;
    }

    if (this.phase === 'stagger') {
      this.staggerTimer -= dt;
      this.parts.torso.rotation.x = -0.35 + Math.sin(this.t * 22) * 0.05;
      this.parts.armL.rotation.x = -1.2;
      this.parts.armR.rotation.x = -1.2;
      if (this.staggerTimer <= 0) this.phase = 'fight';
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.heading;
      return;
    }

    // ---- fight
    const toPlayer = new THREE.Vector3().subVectors(target.pos, this.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);

    // Try to shake the rider off periodically
    if (playerClimbing && this.shakeTimer <= 0 && rand() < dt * 0.25) {
      this.shakeTimer = 1.1;
    }

    let speed = 0;
    if (this.attackAnim > 0) {
      this.attackAnim -= dt;
      const t = 1 - this.attackAnim / 1.4;
      if (this.attackKind === 'smash') {
        const a = t < 0.4 ? (t / 0.4) * -2.4 : -2.4 + ((t - 0.4) / 0.25) * 3.2;
        this.parts.armR.rotation.x = clamp(a, -2.4, 0.8);
        if (t > 0.62 && t < 0.7 && !target.dead) {
          const impact = this.pos
            .clone()
            .add(new THREE.Vector3(Math.sin(this.heading) * 3.6, 0, Math.cos(this.heading) * 3.6));
          this.onHitPlayer?.(30, 4.2, impact);
        }
      } else {
        this.parts.armL.rotation.x = -1.4;
        this.parts.torso.rotation.y = Math.sin(t * Math.PI) * 1.4;
        if (t > 0.45 && t < 0.6 && dist < 6 && !target.dead) {
          this.onHitPlayer?.(22, 6, this.pos);
        }
      }
      if (this.attackAnim <= 0) {
        this.attackCd = 1.6 + rand() * 1.4;
        this.parts.torso.rotation.y = 0;
        this.parts.armR.rotation.x = 0;
        this.parts.armL.rotation.x = 0;
      }
    } else if (!target.dead && !playerClimbing) {
      if (dist > 4.6) {
        speed = 3.4;
        const nx = this.pos.x + (toPlayer.x / dist) * speed * dt;
        const nz = this.pos.z + (toPlayer.z / dist) * speed * dt;
        // The troll wades but won't swim
        if (!isDeepWater(nx, nz)) {
          this.pos.x = nx;
          this.pos.z = nz;
        }
      } else if (this.attackCd <= 0) {
        this.attackAnim = 1.4;
        this.attackKind = rand() > 0.5 ? 'smash' : 'sweep';
      }
      const th = Math.atan2(toPlayer.x, toPlayer.z);
      this.heading = lerpAngle(this.heading, th, damp(3.5, dt));
    } else if (playerClimbing && this.shakeTimer > 0) {
      // thrash
      this.parts.torso.rotation.y = Math.sin(this.t * 18) * 0.5;
      this.parts.torso.rotation.x = Math.sin(this.t * 13) * 0.2;
    }

    const solved = resolveStatics(this.pos.x, this.pos.z, 2.2);
    this.pos.x = solved.x;
    this.pos.z = solved.z;
    this.pos.y = groundY(this.pos.x, this.pos.z);

    // walk cycle
    if (speed > 0) {
      const swing = Math.sin(this.t * 4.5) * 0.55;
      this.parts.legL.rotation.x = swing;
      this.parts.legR.rotation.x = -swing;
      if (this.attackAnim <= 0) {
        this.parts.armL.rotation.x = -swing * 0.5;
        this.parts.armR.rotation.x = swing * 0.5;
        this.parts.torso.rotation.x = 0.12;
        this.parts.torso.rotation.y = 0;
      }
    } else if (this.attackAnim <= 0 && this.shakeTimer <= 0) {
      this.parts.legL.rotation.x = 0;
      this.parts.legR.rotation.x = 0;
      this.parts.torso.rotation.x = 0.06 + Math.sin(this.t * 1.4) * 0.03;
      this.parts.torso.rotation.y = 0;
    }

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
  }
}
