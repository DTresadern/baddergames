// @ts-check
// The elevated walkway: wet deck, hazard stripe band, girder, pillars, braces,
// cables and the red warning lights on the pillars.

import { Container } from 'pixi.js';
import { ShapeBatch, shaderRect } from '../effects/batch.js';
import { GlowBatch, BLINK } from '../effects/glow.js';
import { wetSurface, hazardStripe } from '../effects/surfaces.js';
import { ORDER } from '../stage.js';

/**
 * @param {import('@fw-eval/shared/scene.js').Scene} scene
 * @param {import('../stage.js').Ctx} ctx
 * @returns {import('../stage.js').Layer}
 */
export function createBridge(scene, ctx) {
  const P = scene.palette;
  const br = scene.bridge;
  const group = new Container();

  // pillars and braces sit behind the girder
  const under = new ShapeBatch();
  for (const p of br.pillars) {
    under.rect(p.x, p.y, p.w, p.h, [P.gunmetal, P.gunmetalDark]);
    under.rect(p.x + 6, p.y + 12, p.w - 12, p.h - 24, P.gunmetalDark, 0.6); // recessed panel
    under.rect(p.x, p.y, 2, p.h, P.steelHighlight, 0.35); // lit left edge
    under.rect(p.x + p.w - 3, p.y, 3, p.h, 0x000000, 0.35);
    for (let y = p.y + 20; y < 400; y += 34) under.rect(p.x, y, p.w, 2, P.gunmetalDark); // bands
    // capital where pillar meets girder
    under.rect(p.x - 8, p.y - 2, p.w + 16, 8, P.gunmetalLight);
  }
  for (const [x1, y1, x2, y2] of br.braces) {
    under.line(x1, y1, x2, y2, 7, P.gunmetal);
    under.line(x1, y1 + 2, x2, y2 + 2, 1.5, P.steelHighlight, 0.3);
  }
  for (const cable of br.cables) under.polyline(cable, 1.6, 1.6, 0x0b0c0e);
  group.addChild(under.build(ORDER.bridge));

  // girder under the deck: dark beam with vents and rivet lines
  const g = br.girder;
  const girder = new ShapeBatch();
  girder.rect(g.x, g.y, g.w, g.h, [P.gunmetal, P.gunmetalDark]);
  girder.rect(g.x, g.y + g.h - 3, g.w, 3, 0x0a0b0d);
  for (let x = 30; x < g.w - 30; x += 96) {
    girder.rect(x, g.y + 6, 34, 10, 0x0c0d10); // vent
    for (let k = 0; k < 5; k++) girder.rect(x + 2 + k * 7, g.y + 7, 4, 8, P.gunmetalLight, 0.35);
  }
  for (let x = 6; x < g.w; x += 12) girder.rect(x, g.y + 2, 1.5, 1.5, P.steelHighlight, 0.4);
  group.addChild(girder.build(ORDER.bridge + 1));

  // wet deck surface and hazard stripe band (shader quads)
  const deck = br.deck;
  group.addChild(shaderRect(deck.x, deck.y, deck.w, deck.h,
    wetSurface({ base: P.gunmetal, sheen: 0x8794a8, ctx }), ORDER.bridge + 2));
  const sb = br.stripeBand;
  group.addChild(shaderRect(sb.x, sb.y, sb.w, sb.h,
    hazardStripe({ yellow: P.hazardYellow, black: P.hazardBlack, spacing: br.stripeSpacing, slant: br.stripeSlant, height: sb.h }),
    ORDER.bridge + 2));

  // red warning lights: housings plus blinking glows
  const housings = new ShapeBatch();
  const glows = new GlowBatch();
  br.redLights.forEach((l, i) => {
    housings.rect(l.x - 3, l.y - 4, 6, 8, 0x0c0c0e);
    housings.rect(l.x - 2, l.y - 2, 4, 4, P.warningRed);
    glows.add(l.x, l.y, l.radius, l.radius, P.warningRed, 0.9, BLINK.red, i);
  });
  group.addChild(housings.build(ORDER.bridge + 3));
  group.addChild(glows.build(ORDER.glows, { ctx, core: 0.15 }));

  return { parts: [{ object: group, depth: br.depth }] };
}
