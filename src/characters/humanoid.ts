import * as THREE from 'three';
import { clamp, lerp } from '../utils/math';

function flatMat(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export interface HumanoidColors {
  skin: string;
  hair: string;
  torso: string;
  arms: string;
  legs: string;
  boots: string;
  belt?: string;
  weapon?: 'sword' | 'staff' | 'club' | 'none';
}

export type AnimState = 'idle' | 'move' | 'attack' | 'heavy' | 'hurt' | 'dead' | 'climb';

/**
 * A stylized low-poly humanoid assembled from primitives with pivots at the
 * shoulders/hips/neck so it can be animated procedurally (no skeleton needed).
 */
export class HumanoidRig {
  root = new THREE.Group();
  private torso: THREE.Group;
  private head: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  weaponTip = new THREE.Object3D();

  /** 0..1 progress of the current attack, driven externally. */
  attackT = 0;
  moveSpeed = 0; // 0 idle .. 1 sprint
  state: AnimState = 'idle';

  private t = Math.random() * 10;
  private deadT = 0;

  constructor(colors: HumanoidColors, scale = 1) {
    const skin = flatMat(colors.skin);
    const hair = flatMat(colors.hair);
    const torsoM = flatMat(colors.torso);
    const armsM = flatMat(colors.arms);
    const legsM = flatMat(colors.legs);
    const bootsM = flatMat(colors.boots);

    // -- torso group holds everything above the hips
    this.torso = new THREE.Group();
    this.torso.position.y = 0.95;

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), torsoM);
    chest.position.y = 0.36;
    chest.castShadow = true;
    this.torso.add(chest);

    if (colors.belt) {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.14, 0.38), flatMat(colors.belt));
      belt.position.y = 0.04;
      this.torso.add(belt);
    }

    // shoulder pads for a heroic silhouette
    const padGeo = new THREE.BoxGeometry(0.24, 0.16, 0.3);
    const padL = new THREE.Mesh(padGeo, torsoM);
    padL.position.set(0.42, 0.66, 0);
    const padR = padL.clone();
    padR.position.x = -0.42;
    this.torso.add(padL, padR);

    // -- head
    this.head = new THREE.Group();
    this.head.position.y = 0.78;
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.34), skin);
    skull.position.y = 0.2;
    skull.castShadow = true;
    this.head.add(skull);
    const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.38), hair);
    hairCap.position.set(0, 0.36, -0.01);
    this.head.add(hairCap);
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.1), hair);
    hairBack.position.set(0, 0.24, -0.16);
    this.head.add(hairBack);
    this.torso.add(this.head);

    // -- arms (pivot at shoulder)
    const makeArm = (side: 1 | -1): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(0.36 * side, 0.62, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.2), armsM);
      upper.position.y = -0.18;
      upper.castShadow = true;
      g.add(upper);
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.18), skin);
      lower.position.y = -0.5;
      lower.castShadow = true;
      g.add(lower);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.19), skin);
      hand.position.y = -0.72;
      g.add(hand);
      return g;
    };
    this.armL = makeArm(1);
    this.armR = makeArm(-1);
    this.torso.add(this.armL, this.armR);

    // -- legs (pivot at hip)
    const makeLeg = (side: 1 | -1): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(0.17 * side, 0, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.24), legsM);
      thigh.position.y = -0.22;
      thigh.castShadow = true;
      g.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.4, 0.21), bootsM);
      shin.position.y = -0.62;
      shin.castShadow = true;
      g.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.32), bootsM);
      foot.position.set(0, -0.84, 0.05);
      g.add(foot);
      return g;
    };
    this.legL = makeLeg(1);
    this.legR = makeLeg(-1);
    this.legL.position.y = 0.95;
    this.legR.position.y = 0.95;

    // -- weapon
    if (colors.weapon === 'sword') {
      const sword = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 0.16), flatMat('#d9dde2'));
      blade.position.y = 0.72;
      blade.castShadow = true;
      sword.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.18, 4), flatMat('#d9dde2'));
      tip.position.y = 1.33;
      sword.add(tip);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.1), flatMat('#a88932'));
      guard.position.y = 0.18;
      sword.add(guard);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 5), flatMat('#5b3a21'));
      grip.position.y = 0.04;
      sword.add(grip);
      // Rest pose: blade tilted forward and slightly outward so it clears
      // the torso, shoulder pads, and head.
      sword.position.set(0, -0.74, 0.12);
      sword.rotation.x = 0.55;
      sword.rotation.z = 0.12;
      this.armR.add(sword);
      this.weaponTip.position.set(0, 1.35, 0);
      sword.add(this.weaponTip);
    } else if (colors.weapon === 'staff') {
      const staff = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.9, 5), flatMat('#6b4726'));
      staff.add(shaft);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), flatMat('#7fd4ff'));
      gem.position.y = 1.05;
      staff.add(gem);
      staff.position.set(0, -0.6, 0.1);
      this.armR.add(staff);
      this.weaponTip.position.set(0, 1.0, 0);
      staff.add(this.weaponTip);
    } else if (colors.weapon === 'club') {
      const club = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.2, 5), flatMat('#5b4023'));
      shaft.position.y = 0.4;
      club.add(shaft);
      const headM = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), flatMat('#726a5e'));
      headM.position.y = 1.05;
      headM.castShadow = true;
      club.add(headM);
      club.position.set(0, -0.7, 0.1);
      club.rotation.x = 0.55;
      this.armR.add(club);
      this.weaponTip.position.set(0, 1.1, 0);
      club.add(this.weaponTip);
    }

    this.root.add(this.torso, this.legL, this.legR);
    this.root.scale.setScalar(scale);
  }

  /** Character height origin is at the feet. */
  update(dt: number): void {
    this.t += dt;
    const t = this.t;

    if (this.state === 'dead') {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      const d = this.deadT;
      this.root.rotation.x = (-Math.PI / 2) * d * 0.94;
      this.root.position.y += 0; // caller keeps feet on ground
      this.torso.rotation.set(0, 0, 0.15 * d);
      return;
    }

    const speed = this.moveSpeed;
    const swing = Math.sin(t * (6 + speed * 6)) * clamp(speed, 0, 1);
    const idleBreath = Math.sin(t * 1.6) * 0.02;

    // legs
    this.legL.rotation.x = swing * 0.85;
    this.legR.rotation.x = -swing * 0.85;

    // torso bob & lean
    this.torso.position.y = 0.95 + Math.abs(Math.cos(t * (6 + speed * 6))) * 0.06 * speed + idleBreath;
    this.torso.rotation.x = speed * 0.12;
    this.head.rotation.x = -speed * 0.08;

    if (this.state === 'attack' || this.state === 'heavy') {
      // wind-up then slash driven by attackT (0..1)
      const p = this.attackT;
      const heavy = this.state === 'heavy' ? 1.35 : 1;
      let angle: number;
      if (p < 0.35) {
        angle = lerp(0, -2.4 * heavy, p / 0.35); // raise
      } else if (p < 0.6) {
        angle = lerp(-2.4 * heavy, 0.9, (p - 0.35) / 0.25); // slash down
      } else {
        angle = lerp(0.9, 0, (p - 0.6) / 0.4); // recover
      }
      this.armR.rotation.x = angle;
      this.armR.rotation.z = -0.25 * heavy;
      this.armL.rotation.x = -swing * 0.6 - 0.3;
      this.torso.rotation.y = lerp(0.35, -0.4, clamp((p - 0.3) / 0.3, 0, 1)) * heavy;
    } else if (this.state === 'climb') {
      this.armL.rotation.x = -2.6 + Math.sin(t * 3) * 0.15;
      this.armR.rotation.x = -2.6 - Math.sin(t * 3) * 0.15;
      this.legL.rotation.x = -0.8;
      this.legR.rotation.x = -0.5;
      this.torso.rotation.y = 0;
    } else if (this.state === 'hurt') {
      this.torso.rotation.y = Math.sin(t * 30) * 0.12;
      this.armL.rotation.x = -0.6;
      this.armR.rotation.x = -0.6;
    } else {
      this.armL.rotation.x = -swing * 0.7 - 0.06;
      this.armR.rotation.x = swing * 0.7 - 0.06;
      this.armR.rotation.z = 0;
      this.torso.rotation.y = 0;
    }
  }
}

export function makeTroll(): { root: THREE.Group; parts: TrollParts } {
  const skin = flatMat('#7a8a5a');
  const skinDark = flatMat('#65744a');
  const cloth = flatMat('#6b4726');

  const root = new THREE.Group();

  const torso = new THREE.Group();
  torso.position.y = 3.0;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 1.9), skin);
  belly.position.y = 0.4;
  belly.castShadow = true;
  torso.add(belly);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.6, 2.1), skinDark);
  chest.position.y = 1.9;
  chest.castShadow = true;
  torso.add(chest);
  const loin = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.9, 2.0), cloth);
  loin.position.y = -0.85;
  torso.add(loin);

  const head = new THREE.Group();
  head.position.y = 3.0;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.2, 1.3), skin);
  skull.castShadow = true;
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.42, 1.0), skinDark);
  jaw.position.set(0, -0.55, 0.18);
  head.add(jaw);
  const tuskGeo = new THREE.ConeGeometry(0.1, 0.42, 4);
  const tuskL = new THREE.Mesh(tuskGeo, flatMat('#e8e2ce'));
  tuskL.position.set(0.42, -0.42, 0.55);
  const tuskR = tuskL.clone();
  tuskR.position.x = -0.42;
  head.add(tuskL, tuskR);
  const eyeGeo = new THREE.BoxGeometry(0.16, 0.12, 0.06);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffcf3f' });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(0.3, 0.12, 0.66);
  const eyeR = eyeL.clone();
  eyeR.position.x = -0.3;
  head.add(eyeL, eyeR);
  torso.add(head);

  const makeArm = (side: 1 | -1): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(1.7 * side, 2.2, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.6, 0.95), skinDark);
    upper.position.y = -0.8;
    upper.castShadow = true;
    g.add(upper);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.5, 0.85), skin);
    lower.position.y = -2.15;
    lower.castShadow = true;
    g.add(lower);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.95), skinDark);
    fist.position.y = -3.05;
    g.add(fist);
    return g;
  };
  const armL = makeArm(1);
  const armR = makeArm(-1);
  torso.add(armL, armR);

  // club in right hand
  const club = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 3.4, 6), flatMat('#5b4023'));
  shaft.position.y = 1.1;
  club.add(shaft);
  const clubHead = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), flatMat('#726a5e'));
  clubHead.position.y = 3.0;
  clubHead.castShadow = true;
  club.add(clubHead);
  club.position.set(0, -3.1, 0.4);
  club.rotation.x = 0.5;
  armR.add(club);

  const makeLeg = (side: 1 | -1): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(0.8 * side, 3.0, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.5, 1.1), skin);
    thigh.position.y = -0.75;
    thigh.castShadow = true;
    g.add(thigh);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 1.0), skinDark);
    shin.position.y = -2.1;
    shin.castShadow = true;
    g.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.5), skinDark);
    foot.position.set(0, -2.95, 0.25);
    g.add(foot);
    return g;
  };
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  // Glowing weak-point rune on the back (climb target)
  const rune = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.34, 0),
    new THREE.MeshBasicMaterial({ color: '#ff5533' }),
  );
  rune.position.set(0, 2.0, -1.25);
  torso.add(rune);

  root.add(torso, legL, legR);

  return { root, parts: { torso, head, armL, armR, legL, legR, rune } };
}

export interface TrollParts {
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  rune: THREE.Mesh;
}
