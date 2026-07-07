/**
 * Small, fast 2D simplex-style value noise with fBm, deterministic by seed.
 * Enough quality for terrain; avoids pulling in a dependency.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM_SIZE = 256;

export class Noise2D {
  private perm: Uint8Array;
  private grads: Float32Array;

  constructor(seed = 1337) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(PERM_SIZE * 2);
    const p = new Uint8Array(PERM_SIZE);
    for (let i = 0; i < PERM_SIZE; i++) p[i] = i;
    for (let i = PERM_SIZE - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < PERM_SIZE * 2; i++) this.perm[i] = p[i & (PERM_SIZE - 1)];

    this.grads = new Float32Array(PERM_SIZE * 2);
    for (let i = 0; i < PERM_SIZE; i++) {
      const a = rand() * Math.PI * 2;
      this.grads[i * 2] = Math.cos(a);
      this.grads[i * 2 + 1] = Math.sin(a);
    }
  }

  private dot(ix: number, iy: number, dx: number, dy: number): number {
    const g = this.perm[(ix & 255) + this.perm[iy & 255]] & 255;
    return this.grads[g * 2] * dx + this.grads[g * 2 + 1] * dy;
  }

  /** Perlin-style gradient noise, roughly in [-1, 1]. */
  noise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const u = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
    const v = dy * dy * dy * (dy * (dy * 6 - 15) + 10);

    const n00 = this.dot(x0, y0, dx, dy);
    const n10 = this.dot(x0 + 1, y0, dx - 1, dy);
    const n01 = this.dot(x0, y0 + 1, dx, dy - 1);
    const n11 = this.dot(x0 + 1, y0 + 1, dx - 1, dy - 1);

    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.9;
  }

  /** Fractal Brownian motion, roughly in [-1, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

export { mulberry32 };
