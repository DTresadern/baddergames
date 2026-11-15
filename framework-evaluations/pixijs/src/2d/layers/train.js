// @ts-check
// Distant elevated track and the train that loops along it (position from trainX()).

import { Container } from 'pixi.js';
import { ShapeBatch } from '../effects/batch.js';
import { GlowBatch } from '../effects/glow.js';
import { ORDER } from '../stage.js';
import { hazed, trainX } from '@fw-eval/shared/scene.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createTrain(scene, ctx) {
  const tr = scene.train;
  const P = scene.palette;
  const d = tr.depth;
  const steel = hazed(scene, P.gunmetalDark, d * 0.8);
  const steelLight = hazed(scene, P.gunmetal, d * 0.8);
  const lamp = hazed(scene, P.amber, d * 0.5);

  // track: deck, under-girder, support columns with small arches
  const track = new ShapeBatch();
  const y = tr.trackY;
  track.rect(-80, y, scene.world.width + 160, tr.trackThickness, steelLight);
  track.rect(-80, y + tr.trackThickness, scene.world.width + 160, 5, steel);
  for (const x of tr.trackSupports) {
    track.rect(x - 6, y + 12, 12, tr.supportBottom - y, [steel, hazed(scene, P.gunmetal, d + 3)]);
    track.quad([x - 30, y + 12, x + 30, y + 12, x + 6, y + 32, x - 6, y + 32], steel);
  }
  // little lamps along the track
  for (let x = -40; x < scene.world.width + 80; x += 45) track.rect(x, y + 8, 2, 2, lamp);

  // train: cars with a lit window strip; front at the right
  const train = new ShapeBatch();
  const body = hazed(scene, tr.color, d * 0.35);
  const roof = hazed(scene, P.steelHighlight, d);
  const win = hazed(scene, tr.windowColor, d * 0.4);
  for (let c = 0; c < tr.carCount; c++) {
    const x = c * (tr.carLength + tr.carGap);
    const top = y - tr.carHeight;
    const front = c === tr.carCount - 1;
    if (front) {
      train.quad([x, top, x + tr.carLength - 8, top, x + tr.carLength, y - 2, x, y - 2], body);
    } else {
      train.rect(x, top, tr.carLength, tr.carHeight - 2, body);
    }
    train.rect(x + 2, top, tr.carLength - 10, 1.5, roof, 0.6);
    for (let k = 0; k < 6; k++) train.rect(x + 3 + k * 6.5, top + 4, 4.5, 3.5, win, 0.95);
  }
  const glows = new GlowBatch();
  const length = tr.carCount * (tr.carLength + tr.carGap);
  glows.add(length - 2, y - 5, 26, 10, P.amberPale, 0.6);
  for (let c = 0; c < tr.carCount; c++) glows.add(c * (tr.carLength + tr.carGap) + 21, y - 8, 26, 9, P.amber, 0.25);

  const trainGroup = new Container();
  trainGroup.addChild(train.build(ORDER.train + 1), glows.build(ORDER.train + 2, { ctx }));

  return {
    parts: [{ object: track.build(ORDER.train), depth: d }, { object: wrap(trainGroup), depth: d }],
    update(t) { trainGroup.x = trainX(scene, t); },
  };
}

/**
 * main.js moves a part's top object for parallax, so animated children live one level down.
 * @param {Container} child
 */
function wrap(child) {
  const g = new Container();
  g.addChild(child);
  return g;
}
