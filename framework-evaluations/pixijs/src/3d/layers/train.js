// @ts-check
// Distant elevated track (depth 5) and the train that loops along it (trainX()).

import { Container3D, Mesh3D } from '@pixi/3d';
import { trainX } from '@fw-eval/shared/scene.js';
import { MeshBuilder } from '../effects/batch.js';
import { createGlows } from '../effects/glow.js';
import { glowVertexMaterial, litVertexMaterial } from '../effects/materials.js';
import { S, X, Y, Z } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @returns {import('../stage.js').Layer}
 */
export function createTrain(scene) {
  const tr = scene.train;
  const P = scene.palette;
  const d = tr.depth;
  const z = Z(d);
  const deep = S(40, d); // track depth in Z
  const y = tr.trackY;

  // track: deck, girder, columns with braces
  const track = new MeshBuilder();
  track.box(X(-120, d), Y(y + tr.trackThickness, d), z - deep, X(1320, d), Y(y, d), z, P.gunmetal, { top: P.gunmetalLight });
  track.box(X(-120, d), Y(y + tr.trackThickness + 5, d), z - deep * 0.8, X(1320, d), Y(y + tr.trackThickness, d), z - S(2, d), P.gunmetalDark);
  for (const sx of tr.trackSupports) {
    track.box(X(sx - 6, d), Y(tr.supportBottom, d), z - deep * 0.7, X(sx + 6, d), Y(y + 12, d), z - S(4, d), P.gunmetalDark);
    track.beam(X(sx - 30, d), Y(y + 12, d), X(sx - 4, d), Y(y + 32, d), S(4, d), z - deep * 0.6, z - S(4, d), P.gunmetalDark);
    track.beam(X(sx + 30, d), Y(y + 12, d), X(sx + 4, d), Y(y + 32, d), S(4, d), z - deep * 0.6, z - S(4, d), P.gunmetalDark);
  }
  const trackLamps = new MeshBuilder();
  for (let x = -40; x < 1280; x += 45) trackLamps.box(X(x, d), Y(y + 10, d), z, X(x + 2, d), Y(y + 8, d), z + S(1, d), P.amber);

  // train, built at x = 0 (rear) and moved with node.position.x
  const body = new MeshBuilder();
  const win = new MeshBuilder();
  const carD = S(14, d);
  for (let c = 0; c < tr.carCount; c++) {
    const x0 = S(c * (tr.carLength + tr.carGap), d), x1 = x0 + S(tr.carLength, d);
    const top = Y(y - tr.carHeight, d), bot = Y(y - 1, d);
    body.box(x0, bot, z - carD - S(4, d), x1, top, z - S(4, d), tr.color, { top: P.steelHighlight });
    for (let k = 0; k < 6; k++) {
      const wx = x0 + S(3 + k * 6.5, d);
      win.quad([wx, Y(y - tr.carHeight + 7.5, d), z - S(3.8, d)], [wx + S(4.5, d), Y(y - tr.carHeight + 7.5, d), z - S(3.8, d)],
        [wx + S(4.5, d), Y(y - tr.carHeight + 4, d), z - S(3.8, d)], [wx, Y(y - tr.carHeight + 4, d), z - S(3.8, d)], tr.windowColor, [0, 0, 1]);
    }
  }
  const length = tr.carCount * (tr.carLength + tr.carGap);
  const glows = createGlows(tr.carCount + 1, { space: 'local' });
  glows.add(S(length - 2, d), Y(y - 6, d), z, S(26, d), P.amberPale, 0.55);
  for (let c = 0; c < tr.carCount; c++) glows.add(S(c * (tr.carLength + tr.carGap) + 21, d), Y(y - 8, d), z - S(3, d), S(28, d), P.amber, 0.22);
  glows.upload();

  const train = new Container3D({ label: 'train' });
  train.addChild(
    new Mesh3D({ geometry: body.build() ?? undefined, material: litVertexMaterial({ roughness: 0.5, metallic: 0.6 }), castShadow: false }),
    new Mesh3D({ geometry: win.build() ?? undefined, material: glowVertexMaterial(), castShadow: false, receiveShadow: false }),
    glows.node,
  );
  const nodes = [
    new Mesh3D({ geometry: track.build() ?? undefined, material: litVertexMaterial({ roughness: 0.7, metallic: 0.4 }), castShadow: false }),
    new Mesh3D({ geometry: trackLamps.build() ?? undefined, material: glowVertexMaterial(), castShadow: false, receiveShadow: false }),
    train,
  ];
  return {
    nodes,
    update(t) { train.position.x = X(trainX(scene, t), d); },
  };
}
