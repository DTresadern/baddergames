// Keyboard, mouse and gamepad input.
// Keyboard + mouse drives one player; a gamepad can drive a second local player.

const KEYMAP = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space', 'KeyW', 'ArrowUp'],
  dash: ['ShiftLeft', 'ShiftRight'],
  disc: ['KeyG', 'KeyQ'],
  fire: ['KeyF'],
};

// Mouse-only movement band, in game pixels from the hunter (the view is 960 wide)
export const MOVE_NEAR = 240;
export const MOVE_FAR = 330;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 480, y: 270, left: false, right: false, rightPressed: false, middlePressed: false, backPressed: false, forwardPressed: false, moved: false, inside: false };
    this.wheel = 0;
    this.wheelAcc = 0;
    this.wheelBlock = 0;
    // Settings (set from the menu)
    this.mouseOnly = false; // move with the cursor, jump with right click: for touchpads
    this.toggleFire = false; // a left click starts or stops firing instead of holding
    this.fireLatch = false;
    this.slot = -1;
    this.padPrev = [{}, {}, {}, {}];
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (/^Digit[1-4]$/.test(e.code)) this.slot = Number(e.code.slice(5)) - 1;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
      this.mouse.inside = false;
      this.fireLatch = false;
    });
    canvas.addEventListener('mouseenter', () => (this.mouse.inside = true));
    canvas.addEventListener('mouseleave', () => (this.mouse.inside = false));
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
      this.mouse.moved = true;
      this.mouse.inside = true;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        this.mouse.left = true;
        if (this.toggleFire) this.fireLatch = !this.fireLatch;
      }
      if (e.button === 1) this.mouse.middlePressed = true;
      if (e.button === 2) {
        this.mouse.right = true;
        this.mouse.rightPressed = true;
      }
      if (e.button === 3) this.mouse.backPressed = true;
      if (e.button === 4) this.mouse.forwardPressed = true;
      e.preventDefault();
    });
    // Side buttons would otherwise navigate the page back/forward
    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Weapon cycling. Touchpad swipes send a long stream of small wheel events, so
    // accumulate distance and allow at most one switch per 300 ms.
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now < this.wheelBlock) return;
      this.wheelAcc += e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
      if (Math.abs(this.wheelAcc) >= 40) {
        this.wheel += Math.sign(this.wheelAcc);
        this.wheelAcc = 0;
        this.wheelBlock = now + 300;
      }
    }, { passive: false });
  }

  down(action) {
    return KEYMAP[action].some((k) => this.keys.has(k));
  }

  hit(action) {
    return KEYMAP[action].some((k) => this.pressed.has(k));
  }

  // Keyboard/mouse input for one tick. aimFrom = [x, y] of the player's shoulder on screen.
  // The keyboard always works; mouse-only mode adds cursor movement and right-click jump.
  keyboard(aimFrom) {
    let mx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const dx = this.mouse.x - aimFrom[0];
    const aim = Math.atan2(this.mouse.y - aimFrom[1], dx);
    const inp = {
      mx,
      up: this.down('up'),
      down: this.down('down'),
      jump: this.keys.has('Space') || this.keys.has('KeyW') || this.keys.has('ArrowUp'),
      jumpPressed: this.pressed.has('Space') || this.pressed.has('KeyW') || this.pressed.has('ArrowUp'),
      dashPressed: this.hit('dash') || this.mouse.backPressed,
      fire: (this.toggleFire ? this.fireLatch : this.mouse.left) || this.down('fire'),
      discPressed: this.hit('disc') || this.mouse.middlePressed || this.mouse.forwardPressed,
      aim,
      slot: this.slot,
      cycle: Math.sign(this.wheel) || (this.pressed.has('KeyE') ? 1 : 0),
      interact: this.down('down'),
    };
    if (!this.mouseOnly) {
      inp.discPressed ||= this.mouse.rightPressed;
      return inp;
    }
    // Mouse-only: cursor more than MOVE_NEAR px left or right of the hunter walks that
    // way, reaching full speed at MOVE_FAR. Inside that band the hunter stands and aims.
    if (!mx && this.mouse.inside) {
      const a = Math.abs(dx);
      mx = Math.sign(dx) * Math.min(1, Math.max(0, (a - MOVE_NEAR) / (MOVE_FAR - MOVE_NEAR)));
    }
    inp.mx = mx;
    inp.jump ||= this.mouse.right;
    inp.jumpPressed ||= this.mouse.rightPressed;
    // Aiming steeply up or down climbs ladders; down + right click drops through catwalks
    const sin = Math.sin(aim);
    if (sin < -0.85) inp.up = true;
    if (sin > 0.85) inp.down = true;
    return inp;
  }

  // Gamepad input. Returns null when that pad is not connected.
  gamepad(index, lastAim) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].filter(Boolean)[index];
    if (!gp) return null;
    const prev = this.padPrev[index];
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const edge = (i) => b(i) && !prev[i];
    const dz = (v) => (Math.abs(v) < 0.25 ? 0 : v);
    const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
    const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
    const aim = rx || ry ? Math.atan2(ry, rx) : lx ? (lx > 0 ? 0 : Math.PI) : lastAim;
    const inp = {
      mx: Math.abs(lx) > 0.3 ? Math.sign(lx) : (b(15) ? 1 : 0) - (b(14) ? 1 : 0),
      up: ly < -0.5 || b(12),
      down: ly > 0.5 || b(13),
      jump: b(0),
      jumpPressed: edge(0),
      dashPressed: edge(1) || edge(10),
      fire: b(7) || b(2),
      discPressed: edge(6) || edge(3),
      aim,
      aimActive: !!(rx || ry),
      slot: -1,
      cycle: edge(5) ? 1 : edge(4) ? -1 : 0,
      pause: edge(9),
    };
    for (let i = 0; i < gp.buttons.length; i++) prev[i] = b(i);
    return inp;
  }

  padCount() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return [...pads].filter(Boolean).length;
  }

  // Clear one-shot inputs once a simulation tick has consumed them.
  consume() {
    this.pressed.clear();
    this.mouse.rightPressed = false;
    this.mouse.middlePressed = false;
    this.mouse.backPressed = false;
    this.mouse.forwardPressed = false;
    this.wheel = 0;
    this.slot = -1;
  }
}
