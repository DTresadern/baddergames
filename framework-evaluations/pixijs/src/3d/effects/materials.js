// @ts-check
// Materials shared by the layers: lit and unlit, both coloured by the MeshBuilder vertex colours.

import { FlatMaterial, Material3D } from '@pixi/3d';

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
