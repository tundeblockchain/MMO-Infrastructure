/**
 * Element Seed Data - MMO-5
 *
 * 8 damage element types with strongAgainst/weakAgainst relationships.
 * All values as decimals: 1.25 = 25% bonus damage, 0.75 = 25% reduced damage.
 */

import { ElementDefinition } from '../models';

export const ELEMENTS_V1: ElementDefinition[] = [
  {
    elementId: 'physical',
    displayName: 'Physical',
    color: '#C0C0C0',
    strongAgainst: {},
    weakAgainst: {},
  },
  {
    elementId: 'fire',
    displayName: 'Fire',
    color: '#FF4500',
    strongAgainst: {
      ice: 1.25,
      nature: 1.25,
    },
    weakAgainst: {
      fire: 0.50,
    },
  },
  {
    elementId: 'ice',
    displayName: 'Ice',
    color: '#00BFFF',
    strongAgainst: {
      lightning: 1.25,
      nature: 1.15,
    },
    weakAgainst: {
      fire: 0.75,
      ice: 0.50,
    },
  },
  {
    elementId: 'lightning',
    displayName: 'Lightning',
    color: '#FFD700',
    strongAgainst: {
      arcane: 1.25,
    },
    weakAgainst: {
      ice: 0.75,
      lightning: 0.50,
    },
  },
  {
    elementId: 'arcane',
    displayName: 'Arcane',
    color: '#9932CC',
    strongAgainst: {
      shadow: 1.25,
      radiant: 1.15,
    },
    weakAgainst: {
      lightning: 0.75,
      arcane: 0.50,
    },
  },
  {
    elementId: 'nature',
    displayName: 'Nature',
    color: '#228B22',
    strongAgainst: {
      lightning: 1.15,
      shadow: 1.15,
    },
    weakAgainst: {
      fire: 0.75,
      ice: 0.85,
      nature: 0.50,
    },
  },
  {
    elementId: 'shadow',
    displayName: 'Shadow',
    color: '#4B0082',
    strongAgainst: {
      radiant: 1.25,
    },
    weakAgainst: {
      arcane: 0.75,
      nature: 0.85,
      shadow: 0.50,
    },
  },
  {
    elementId: 'radiant',
    displayName: 'Radiant',
    color: '#FFFACD',
    strongAgainst: {
      shadow: 1.25,
    },
    weakAgainst: {
      arcane: 0.85,
      radiant: 0.50,
    },
  },
];
