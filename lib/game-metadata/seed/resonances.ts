/**
 * Resonance Seed Data - MMO-5
 *
 * 6 resonance types for class synergies.
 * vanguard→valor, ranger→precision, arcanist→arcana,
 * machinist→innovation, warden→sanctuary, shade→subterfuge
 */

import { ResonanceDefinition } from '../models';

export const RESONANCES_V1: ResonanceDefinition[] = [
  {
    resonanceId: 'valor',
    displayName: 'Valor',
    description:
      'The resonance of the Vanguard. Party members gain increased health and damage resistance when valor is high.',
    partyBonus: [
      { stat: 'hp', bonusPercent: 10 },
      { stat: 'armor', bonusPercent: 8 },
    ],
  },
  {
    resonanceId: 'precision',
    displayName: 'Precision',
    description:
      'The resonance of the Ranger. Party members gain increased critical hit chance and accuracy when precision is focused.',
    partyBonus: [
      { stat: 'attackPower', bonusPercent: 6 },
      { stat: 'movementSpeed', bonusPercent: 5 },
    ],
  },
  {
    resonanceId: 'arcana',
    displayName: 'Arcana',
    description:
      'The resonance of the Arcanist. Party members gain increased spell power and elemental damage when arcana flows.',
    partyBonus: [
      { stat: 'spellPower', bonusPercent: 10 },
      { stat: 'resourcePool', bonusPercent: 5 },
    ],
  },
  {
    resonanceId: 'innovation',
    displayName: 'Innovation',
    description:
      'The resonance of the Machinist. Party members gain increased tech power and resource regeneration when innovation sparks.',
    partyBonus: [
      { stat: 'resourcePool', bonusPercent: 8 },
      { stat: 'armor', bonusPercent: 5 },
    ],
  },
  {
    resonanceId: 'sanctuary',
    displayName: 'Sanctuary',
    description:
      'The resonance of the Warden. Party members gain increased healing received and damage reduction when sanctuary prevails.',
    partyBonus: [
      { stat: 'hp', bonusPercent: 8 },
      { stat: 'spellPower', bonusPercent: 5 },
    ],
  },
  {
    resonanceId: 'subterfuge',
    displayName: 'Subterfuge',
    description:
      'The resonance of the Shade. Party members gain increased critical damage and movement speed when shadows gather.',
    partyBonus: [
      { stat: 'attackPower', bonusPercent: 8 },
      { stat: 'movementSpeed', bonusPercent: 8 },
    ],
  },
];
