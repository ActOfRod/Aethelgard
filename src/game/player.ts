import * as THREE from 'three';
import { HumanoidRig } from '../characters/humanoid';
import type { Input } from '../core/input';
import { clamp, damp, lerpAngle } from '../utils/math';
import { groundY, isDeepWater, resolveStatics } from './physics';

export interface AttackEvent {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  range: number;
  arc: number; // radians half-angle
  damage: number;
  heavy: boolean;
}

const WALK = 5.2;
const SPRINT = 9.0;
const JUMP_V = 8.5;
const GRAVITY = 24;

export class Player {
  rig: HumanoidRig;
  pos = new THREE.Vector3(-40, 0, 22);
  vel = new THREE.Vector3();
  heading = Math.PI; // facing direction of the model
  hp = 100;
  maxHp = 100;
  sp = 100;
  maxSp = 100;
  onGround = true;
  dead = false;

  /** Set when climbing the troll. */
  climbing = false;

  private attackTimer = 0;
  private attackDur = 0;
  private attackDamage = 0;
  private attackHeavy = false;
  private attackHasHit = false;
  private hurtTimer = 0;
  private rollTimer = 0;
  private rollDir = new THREE.Vector3();

  onAttack: ((e: AttackEvent) => void) | null = null;
  onBrine: (() => void) | null = null;

  private lastSafe = new THREE.Vector3(-40, 0, 22);

  constructor(scene: THREE.Scene) {
    this.rig = new HumanoidRig({
      skin: '#e8b48c',
      hair: '#4a3020',
      torso: '#3e6db5', // blue tunic like the lead fighter in the screenshot
      arms: '#8c3b2e', // leather pauldron red-brown
      legs: '#3a4c66',
      boots: '#6e3b24',
      belt: '#54331d',
      weapon: 'sword',
    });
    this.pos.y = groundY(this.pos.x, this.pos.z);
    scene.add(this.rig.root);
  }

  get isAttacking(): boolean {
    return this.attackTimer > 0;
  }

  takeDamage(amount: number): void {
    if (this.dead || this.rollTimer > 0) return;
    this.hp -= amount;
    this.hurtTimer = 0.35;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.rig.state = 'dead';
    }
  }

  update(dt: number, input: Input, camYaw: number): void {
    if (this.dead) {
      this.rig.update(dt);
      this.rig.root.position.copy(this.pos);
      return;
    }

    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.rollTimer = Math.max(0, this.rollTimer - dt);

    if (this.climbing) {
      // Movement is externally controlled while latched onto the troll
      this.rig.state = 'climb';
      this.rig.update(dt);
      this.rig.root.position.copy(this.pos);
      this.rig.root.rotation.y = this.heading;
      this.sp -= dt * 9;
      return;
    }

    // ---- movement intent in camera space
    let ix = 0;
    let iz = 0;
    if (input.down('KeyW')) iz -= 1;
    if (input.down('KeyS')) iz += 1;
    if (input.down('KeyA')) ix -= 1;
    if (input.down('KeyD')) ix += 1;
    const moving = ix !== 0 || iz !== 0;

    const sprinting = input.down('ShiftLeft') && moving && this.sp > 1;
    const speed = sprinting ? SPRINT : WALK;

    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    let dx = ix * cos - iz * sin;
    let dz = ix * sin + iz * cos;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;

    // ---- dodge roll
    if (input.justPressed('KeyQ') && this.onGround && this.sp >= 20 && this.rollTimer <= 0) {
      this.rollTimer = 0.42;
      this.sp -= 20;
      const rx = moving ? dx : -Math.sin(this.heading);
      const rz = moving ? dz : -Math.cos(this.heading);
      this.rollDir.set(rx, 0, rz);
    }

    // ---- attacks
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      const t = 1 - this.attackTimer / this.attackDur;
      this.rig.attackT = clamp(t, 0, 1);
      // Deal damage at the moment the slash lands
      if (!this.attackHasHit && t > 0.42) {
        this.attackHasHit = true;
        const dir = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
        this.onAttack?.({
          origin: this.pos.clone().add(new THREE.Vector3(0, 1, 0)),
          dir,
          range: this.attackHeavy ? 3.2 : 2.6,
          arc: this.attackHeavy ? 1.5 : 1.1,
          damage: this.attackDamage,
          heavy: this.attackHeavy,
        });
      }
      if (this.attackTimer <= 0) this.rig.state = 'idle';
    } else if ((input.attackLight || input.attackHeavy) && this.onGround && this.rollTimer <= 0) {
      const heavy = input.attackHeavy;
      const cost = heavy ? 22 : 10;
      if (this.sp >= cost) {
        this.sp -= cost;
        this.attackHeavy = heavy;
        this.attackDur = heavy ? 0.85 : 0.5;
        this.attackTimer = this.attackDur;
        this.attackDamage = heavy ? 34 : 16;
        this.attackHasHit = false;
        this.rig.state = heavy ? 'heavy' : 'attack';
        this.rig.attackT = 0;
      }
    }

    // ---- horizontal velocity
    const inAttack = this.attackTimer > 0;
    if (this.rollTimer > 0) {
      this.vel.x = this.rollDir.x * 13;
      this.vel.z = this.rollDir.z * 13;
    } else if (moving && !inAttack) {
      this.vel.x = dx * speed;
      this.vel.z = dz * speed;
      const targetHeading = Math.atan2(-dx, -dz);
      this.heading = lerpAngle(this.heading, targetHeading, damp(14, dt));
    } else {
      const f = damp(inAttack ? 6 : 12, dt);
      this.vel.x -= this.vel.x * f;
      this.vel.z -= this.vel.z * f;
    }

    // ---- jump & gravity
    if (input.justPressed('Space') && this.onGround && this.sp >= 8) {
      this.vel.y = JUMP_V;
      this.onGround = false;
      this.sp -= 8;
    }
    this.vel.y -= GRAVITY * dt;

    // ---- integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    const solved = resolveStatics(this.pos.x, this.pos.z, 0.5);
    this.pos.x = solved.x;
    this.pos.z = solved.z;

    // The Brine — deep water rejects the Arisen
    if (isDeepWater(this.pos.x, this.pos.z)) {
      this.pos.x = this.lastSafe.x;
      this.pos.z = this.lastSafe.z;
      this.pos.y = this.lastSafe.y;
      this.vel.set(0, 3, 0);
      this.takeDamage(4);
      this.onBrine?.();
    } else if (this.onGround) {
      this.lastSafe.copy(this.pos);
    }

    const gy = groundY(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // ---- stamina
    if (sprinting) this.sp -= dt * 12;
    else this.sp += dt * (moving ? 10 : 18);
    this.sp = clamp(this.sp, 0, this.maxSp);
    this.hp = clamp(this.hp + dt * 0.8, 0, this.maxHp); // slow regen

    // ---- drive rig
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.rig.moveSpeed = clamp(hSpeed / SPRINT, 0, 1);
    if (!inAttack) {
      this.rig.state = this.hurtTimer > 0 ? 'hurt' : hSpeed > 0.5 ? 'move' : 'idle';
    }
    this.rig.update(dt);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.heading;
    if (this.rollTimer > 0) {
      this.rig.root.rotation.x = -(0.42 - this.rollTimer) * 10;
    } else {
      this.rig.root.rotation.x = 0;
    }
  }
}
