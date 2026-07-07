import * as THREE from 'three';

export class Hud {
  private hpFill: HTMLElement;
  private hpBar: HTMLElement;
  private spFill: HTMLElement;
  private bossEl: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;
  private barkEl: HTMLElement;
  private barkWho: HTMLElement;
  private barkText: HTMLElement;
  private centerEl: HTMLElement;
  private promptEl: HTMLElement;
  private promptText: HTMLElement;
  private killsEl: HTMLElement;
  private objectiveText: HTMLElement;
  private root: HTMLElement;

  private barkTimer = 0;
  private centerTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="boss"><div class="name"></div><div class="bar"><div class="fill"></div></div></div>
      <div class="objective"><div class="label">Quest</div><div class="text">Slay the goblins prowling the valley</div></div>
      <div class="bars">
        <div class="player-name">The Arisen</div>
        <div class="bar hp"><div class="fill"></div></div>
        <div class="bar sp"><div class="fill"></div></div>
      </div>
      <div class="kills"></div>
      <div class="bark"><span class="who"></span><span class="text"></span></div>
      <div class="center-msg"></div>
      <div class="prompt"><b>SPACE</b><span class="text"></span></div>
      <div class="crosshair"></div>
    `;
    parent.appendChild(this.root);

    const q = (sel: string): HTMLElement => this.root.querySelector(sel) as HTMLElement;
    this.hpBar = q('.bar.hp');
    this.hpFill = q('.bar.hp .fill');
    this.spFill = q('.bar.sp .fill');
    this.bossEl = q('.boss');
    this.bossFill = q('.boss .fill');
    this.bossName = q('.boss .name');
    this.barkEl = q('.bark');
    this.barkWho = q('.bark .who');
    this.barkText = q('.bark .text');
    this.centerEl = q('.center-msg');
    this.promptEl = q('.prompt');
    this.promptText = q('.prompt .text');
    this.killsEl = q('.kills');
    this.objectiveText = q('.objective .text');
  }

  setVitals(hp: number, maxHp: number, sp: number, maxSp: number): void {
    const hpPct = Math.max(0, (hp / maxHp) * 100);
    this.hpFill.style.width = `${hpPct}%`;
    this.hpBar.classList.toggle('low', hpPct < 30);
    this.spFill.style.width = `${Math.max(0, (sp / maxSp) * 100)}%`;
  }

  setBoss(name: string | null, pct = 0): void {
    if (name === null) {
      this.bossEl.classList.remove('show');
    } else {
      this.bossName.textContent = name;
      this.bossFill.style.width = `${Math.max(0, pct * 100)}%`;
      this.bossEl.classList.add('show');
    }
  }

  bark(who: string, text: string, seconds = 3): void {
    this.barkWho.textContent = who;
    this.barkText.textContent = text;
    this.barkEl.classList.add('show');
    this.barkTimer = seconds;
  }

  centerMessage(text: string, seconds = 3): void {
    this.centerEl.textContent = text;
    this.centerEl.classList.add('show');
    this.centerTimer = seconds;
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.promptText.textContent = ' ' + text;
      this.promptEl.classList.add('show');
    } else {
      this.promptEl.classList.remove('show');
    }
  }

  setKills(kills: number, goal: number): void {
    this.killsEl.textContent = `Goblins slain: ${kills} / ${goal}`;
  }

  setObjective(text: string): void {
    this.objectiveText.textContent = text;
  }

  /** Floating damage number at a world position, projected to screen. */
  damageNumber(worldPos: THREE.Vector3, amount: number, camera: THREE.Camera, kind: '' | 'crit' | 'player-hurt' = ''): void {
    const v = worldPos.clone().project(camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = `dmg ${kind}`;
    el.textContent = String(Math.round(amount));
    el.style.left = `${x + (Math.random() - 0.5) * 40}px`;
    el.style.top = `${y - 10}px`;
    this.root.appendChild(el);
    const start = performance.now();
    const rise = (): void => {
      const t = (performance.now() - start) / 900;
      if (t >= 1) {
        el.remove();
        return;
      }
      el.style.transform = `translate(-50%, ${-50 - t * 60}%)`;
      el.style.opacity = String(1 - t * t);
      requestAnimationFrame(rise);
    };
    requestAnimationFrame(rise);
  }

  update(dt: number): void {
    if (this.barkTimer > 0) {
      this.barkTimer -= dt;
      if (this.barkTimer <= 0) this.barkEl.classList.remove('show');
    }
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.centerEl.classList.remove('show');
    }
  }
}
