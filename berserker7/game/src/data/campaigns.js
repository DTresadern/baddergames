// Campaign data for the New Game screen. Each campaign has its own difficulty names;
// campaigns that are not available yet have none.

import { deepFreeze } from '../input/actions.js';

export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard', 'extreme']); // fixed ids
export const DEFAULT_DIFFICULTY = 'normal';

export const CAMPAIGNS = deepFreeze([
  {
    id: 'megacity',
    name: 'Megacity',
    available: true,
    difficultyNames: { easy: 'Still Sedated', normal: 'Inmate', hard: 'Blood on the Visor', extreme: 'Hunter' },
  },
  { id: 'underbelly', name: 'Underbelly', available: false, difficultyNames: null },
  { id: 'caverns', name: 'Caverns', available: false, difficultyNames: null },
  { id: 'infested-earth', name: 'Infested Earth', available: false, difficultyNames: null },
]);
