import { colliders } from '../world/props';
import { heightAt, WORLD_SIZE, WATER_LEVEL } from '../world/terrain';

/** Push a point out of static prop colliders (cheap circle vs circle). */
export function resolveStatics(x: number, z: number, radius: number): { x: number; z: number } {
  for (const c of colliders) {
    const dx = x - c.x;
    const dz = z - c.z;
    const min = c.radius + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (min - d) / d;
      x += dx * push;
      z += dz * push;
    }
  }
  const bound = WORLD_SIZE / 2 - 6;
  if (x > bound) x = bound;
  if (x < -bound) x = -bound;
  if (z > bound) z = bound;
  if (z < -bound) z = -bound;
  return { x, z };
}

export function groundY(x: number, z: number): number {
  return Math.max(heightAt(x, z), WATER_LEVEL - 0.4);
}

/** Deep water is impassable (the Brine claims those who swim). */
export function isDeepWater(x: number, z: number): boolean {
  return heightAt(x, z) < WATER_LEVEL - 1.1;
}
