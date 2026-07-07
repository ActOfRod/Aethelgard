# Aethelgard

A low-poly fantasy action-adventure playable in the browser, inspired by the
gameplay of *Dragon's Dogma 2* and a stylized, faceted art style — a valley of
rolling hills, a teal lake, a castle on a plateau, and a climbable troll.

Built with [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/) +
TypeScript. Everything — terrain, castle, characters, animations — is generated
procedurally from primitives at runtime; there are no binary assets.

## Play

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`) and click
**Begin the Journey**.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| Mouse | Look (click to lock the pointer) |
| Left / Right mouse | Light / heavy attack |
| `Shift` | Sprint |
| `Space` | Jump — or latch onto the troll's back when close |
| `Q` | Dodge roll |

## Gameplay

- **The Arisen** — you, a sword-wielding hero with health and stamina.
  Stamina fuels sprinting, attacks, jumps, and dodge rolls, and regenerates
  when you ease off.
- **Idris, your pawn** — an AI companion who follows you, fights beside you,
  offers advice, and picks herself back up when felled.
- **Goblin camps** — packs of goblins roam the valley. The opening quest asks
  you to cull eight of them.
- **The Valley Troll** — a boss that slumbers south of the castle hill. Its
  hide shrugs off most blows: sprint to its back, press `Space` to climb on,
  and strike the glowing rune while it tries to shake you off — a classic
  Dragon's Dogma-style monster climb.
- **The Brine** — deep water rejects you, just as it should.

## Project layout

```
src/
  core/input.ts        Keyboard + pointer-lock mouse input
  world/terrain.ts     Procedural heightmap terrain, water, palette
  world/props.ts       Trees, rocks, castle, village (instanced, with colliders)
  characters/          Procedural humanoid rig + troll model, all animation
  game/player.ts       Third-person controller, combat, stamina, dodge
  game/pawn.ts         Companion AI and barks
  game/enemies.ts      Goblin AI and the climbable troll boss
  game/hud.ts          Health/stamina bars, boss bar, damage numbers, quests
  game/physics.ts      Terrain grounding + prop collision
  main.ts              Scene, lighting, camera rig, climb system, game loop
```

## Build

```bash
npm run build    # type-checks then bundles to dist/
npm run preview  # serves the production build
```
