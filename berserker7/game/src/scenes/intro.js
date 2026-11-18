// Intro: two logos on black, each fading in, holding and fading out, then the main menu.
// The title music starts on enter and carries on into the menu (no stop here). Any press
// skips to the menu with a fade; the end of the timeline goes to the menu from black.
// The logos are preloaded by the boot group, so load() finds them in the asset cache.

import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial } from 'three';
import { assetByKey } from '../assets/manifest.js';
import { acquireTexture, defaultLoadTexture } from '../assets/textures.js';
import { fitOrtho, place } from './shared.js';

export const FADE_SECONDS = 1;
export const HOLD_SECONDS = 2;
export const TICKS_PER_SECOND = 60; // the harness step is 1/60 s
export const INTRO_LOGOS = Object.freeze(['logo.baddergames', 'logo.w8omg']);
// Black text on white with no alpha, shown as white text on black (see invertedMaterial).
export const INVERTED_LOGOS = Object.freeze(['logo.w8omg']);
export const INTRO_MUSIC = 'music.title';
// Presses in the first quarter second do not skip: on touch screens the browser sends the
// tap's compatibility mouse events after touchend, possibly a tick later, so the tap that
// started the intro could otherwise skip it at once.
export const SKIP_DELAY_SECONDS = 0.25;
// A logo fits inside this fraction of the view width and height.
export const LOGO_MAX_WIDTH = 0.8;
export const LOGO_MAX_HEIGHT = 0.6;

const FADE_TICKS = FADE_SECONDS * TICKS_PER_SECOND;
const HOLD_TICKS = HOLD_SECONDS * TICKS_PER_SECOND;
const LOGO_TICKS = 2 * FADE_TICKS + HOLD_TICKS;
const SKIP_DELAY_TICKS = SKIP_DELAY_SECONDS * TICKS_PER_SECOND;
export const INTRO_TICKS = LOGO_TICKS * INTRO_LOGOS.length;

// Where the timeline is at `tick` (ticks since enter): { logo (index or null), alpha, phase }.
export function introAt(tick) {
  const logo = Math.floor(tick / LOGO_TICKS);
  if (tick < 0 || logo >= INTRO_LOGOS.length) return { logo: null, alpha: 0, phase: 'end' };
  const t = tick - logo * LOGO_TICKS;
  if (t < FADE_TICKS) return { logo, alpha: t / FADE_TICKS, phase: 'fadeIn' };
  if (t < FADE_TICKS + HOLD_TICKS) return { logo, alpha: 1, phase: 'hold' };
  return { logo, alpha: (LOGO_TICKS - t) / FADE_TICKS, phase: 'fadeOut' };
}

// The logo's rectangle in canvas CSS px (top-left origin, y down): centred, aspect kept, inside
// LOGO_MAX_WIDTH x LOGO_MAX_HEIGHT of the view, and never more device pixels than the image has.
export function logoRect(viewWidth, viewHeight, imageWidth, imageHeight, pixelRatio = 1) {
  const scale = Math.min(
    (LOGO_MAX_WIDTH * viewWidth) / imageWidth,
    (LOGO_MAX_HEIGHT * viewHeight) / imageHeight,
    1 / pixelRatio,
  );
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (viewWidth - width) / 2, y: (viewHeight - height) / 2, width, height };
}

export function initIntro() {
  return { ticks: 0, leaving: false, request: null };
}

// A press of any kind: a sound-unlocking key, click or touch, or any action pressed (this
// covers Escape and gamepad buttons). A mere mouse move is not one.
const skips = (f) => f.connected && (f.activated || Object.values(f.actions).some((a) => a.pressed));

// `request`: 'menu' once when the timeline ends, 'skip' once on a press before that; none after either.
export function tickIntro(state, inputs = []) {
  state.ticks += 1;
  state.request = null;
  if (state.leaving) return state;
  if (introAt(state.ticks).phase === 'end') state.request = 'menu';
  else if (state.ticks > SKIP_DELAY_TICKS && inputs.some(skips)) state.request = 'skip';
  if (state.request !== null) state.leaving = true;
  return state;
}

// White where the image is dark, with the image's own soft edges: alpha = 1 - stored value.
// The texture is raw (manifest colorSpace 'raw'), so texel.r is the stored byte / 255 and the
// shown pixel over black is the exact inverse of the image.
function invertedMaterial(map) {
  return new ShaderMaterial({
    uniforms: { map: { value: map }, opacity: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(map, vUv);
        gl_FragColor = vec4(1.0, 1.0, 1.0, (1.0 - texel.r) * opacity);
      }`,
    transparent: true,
    depthWrite: false,
  });
}

export function createIntro({ music, screens, loadTexture = defaultLoadTexture }) {
  let scene, camera, black;
  let logos = []; // { mesh, width, height, setOpacity } per INTRO_LOGOS entry
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'unload', pausable: false },
    async load({ track, acquire }) {
      const textures = await Promise.all(INTRO_LOGOS.map((key) => acquireTexture(acquire, key, loadTexture)));
      const geometry = track(new PlaneGeometry(1, 1));
      scene = new Scene();
      black = new Mesh(geometry, track(new MeshBasicMaterial({ color: 0x000000 })));
      scene.add(black);
      logos = INTRO_LOGOS.map((key, i) => {
        const map = textures[i];
        const inverted = INVERTED_LOGOS.includes(key);
        const material = track(
          inverted ? invertedMaterial(map) : new MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false }),
        );
        const mesh = new Mesh(geometry, material);
        mesh.position.z = 1;
        mesh.visible = false;
        scene.add(mesh);
        const setOpacity = inverted
          ? (alpha) => (material.uniforms.opacity.value = alpha)
          : (alpha) => (material.opacity = alpha);
        return { mesh, width: map.image.width, height: map.image.height, setOpacity };
      });
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    // The first logo starts fading in now, with the music.
    enter() {
      music.play(assetByKey(INTRO_MUSIC).path);
      return initIntro();
    },
    tick(state, inputs) {
      tickIntro(state, inputs);
      if (state.request === 'menu') screens.showMenu({ fromBlack: true });
      if (state.request === 'skip') screens.showMenu({ fromBlack: false });
      return state;
    },
    draw(state, view) {
      const { width, height } = view;
      fitOrtho(camera, view, height / 2); // world units are CSS px
      place(black, { x: 0, y: 0, width, height }, width, height);
      const { logo, alpha } = introAt(state.ticks);
      const pixelRatio = view.renderer.getPixelRatio?.() ?? 1;
      logos.forEach((l, i) => {
        l.mesh.visible = i === logo;
        if (i !== logo) return;
        place(l.mesh, logoRect(width, height, l.width, l.height, pixelRatio), width, height);
        l.setOpacity(alpha);
      });
      view.renderer.render(scene, camera);
    },
  };
}
