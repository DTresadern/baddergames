// @ts-check
// Named colours shared by all builds, as 0xRRGGBB numbers.
// Mood: dirty gunmetal, bruised navy, sodium amber, sparse hazard red.

export const PALETTE = Object.freeze({
  // sky and haze (top of frame to horizon)
  skyTop: 0x1a2232,
  skyMid: 0x303d54,
  skyHorizon: 0x46566e,
  hazeNear: 0x323f55,
  hazeFar: 0x4c5b74,

  // structure metals
  gunmetalDark: 0x15171b,
  gunmetal: 0x272a30,
  gunmetalLight: 0x454a52,
  steelHighlight: 0x7d8590,
  navyDark: 0x121a2a,
  navy: 0x1c2639,
  bruisedNavy: 0x2c3754,

  // lights
  amber: 0xffb347,
  amberDeep: 0xd9822b,
  amberPale: 0xffd9a0,
  windowLit: 0xf2a94e,
  windowDim: 0x8a5a2a,

  // hazard stripes and warnings
  hazardYellow: 0xd2a019,
  hazardBlack: 0x141417,
  warningRed: 0xff2a1a,
  warningRedDeep: 0x8a1410,

  // organic growth and rock
  rock: 0x211b19,
  rockLight: 0x3a302b,
  growth: 0x4a0a12,
  growthMid: 0x5c1219,
  growthGlow: 0xff4a2a,

  // particles
  rain: 0xaebdd2,
  smoke: 0x9aa0aa,
  water: 0xb9cfe6,

  // figures
  hunterBody: 0x2e3328,
  hunterArmour: 0x4d5240,
  hunterScarf: 0xa3141c,
  muzzle: 0xffc070,

  // train
  trainBody: 0x4a4f58,
  trainWindow: 0xffd28a,
});
