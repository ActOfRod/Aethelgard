export class Input {
  keys = new Set<string>();
  /** Buttons pressed this frame (cleared at end of frame). */
  pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  attackLight = false;
  pointerLocked = false;

  private buttons = new Set<number>();
  private canvas: HTMLElement;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) return;
      this.buttons.add(e.button);
      if (e.button === 0) this.attackLight = true;
    });
    document.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('blur', () => this.buttons.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestLock(): void {
    if (!this.pointerLocked) this.canvas.requestPointerLock();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** True while the right mouse button is held (guard). */
  get blockHeld(): boolean {
    return this.buttons.has(2);
  }

  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.attackLight = false;
    this.pressed.clear();
  }
}
