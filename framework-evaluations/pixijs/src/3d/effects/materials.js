// @ts-check
// Shared materials, the procedural soft-dot texture and the additive glow sprites.

import { FlatMaterial, Material3D, ParticleContainer3D, packParticleColor } from '@pixi/3d';
import { Texture } from 'pixi.js';

/**
 * Lit PBR material that takes its colour from the vertex colours of a MeshBuilder mesh.
 * @param {{ roughness?: number, metallic?: number }} [opt]
 */
export function litVertexMaterial(opt = {}) {
  return new Material3D({ baseColor: 0xffffff, vertexColors: true, roughness: opt.roughness ?? 0.8, metallic: opt.metallic ?? 0.2 });
}

/** Unlit material for lit windows, screens and lamp bulbs: shows the vertex colours as authored (then fog). */
export function glowVertexMaterial() {
  return new FlatMaterial({ baseColor: 0xffffff, vertexColors: true });
}

/** @type {Texture | null} */
let dot = null;

/**
 * Soft round sprite drawn on a canvas at start-up (procedural: no image file is loaded).
 * The default particle texture is a hard white square.
 */
export function softDot() {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dot = Texture.from(c);
  return dot;
}

/**
 * Additive glow sprites (halos round lamps, warning lights, screens): a ParticleContainer3D
 * with a fixed slot per glow. Write with set(), then upload() once per frame.
 * @param {number} capacity
 * @param {{ space?: 'world' | 'local' }} [opt] 'local' when the glows ride on a moving node
 */
export function createGlows(capacity, opt = {}) {
  const glows = new ParticleContainer3D({ texture: softDot(), capacity: Math.max(1, capacity), blendMode: 'add', space: opt.space ?? 'world' });
  /** @type {{ x: number, y: number, z: number, size: number, color: number, alpha: number }[]} */
  const slots = [];
  return {
    node: glows,
    slots,
    /** @param {number} x @param {number} y @param {number} z @param {number} size @param {number} color @param {number} alpha */
    add(x, y, z, size, color, alpha) {
      slots.push({ x, y, z, size, color, alpha });
      return slots.length - 1;
    },
    /** @param {(i: number) => number} [alphaScale] */
    upload(alphaScale) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const a = s.alpha * (alphaScale ? alphaScale(i) : 1);
        glows.writePacked(i, s.x, s.y, s.z, a > 0 ? s.size : 0, 0, packParticleColor(s.color, Math.min(1, a)));
      }
      glows.upload();
    },
  };
}
