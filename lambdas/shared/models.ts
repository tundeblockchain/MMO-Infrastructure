export interface CharacterRecord {
  characterId: string;
  accountId: string;
  name: string;
  level: number;
  xp: number;
  money: number;
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  zoneId: string;
  x: number;
  y: number;
  z: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterSummary {
  characterId: string;
  name: string;
  level: number;
  zoneId: string;
}

export interface EnterWorldResponse {
  gameSessionToken: string;
  character: CharacterRecord;
  zoneHost: string;
  zonePort: number;
}

export const DEFAULT_CHARACTER_STATS = {
  level: 1,
  xp: 0,
  money: 0,
  hp: 100,
  maxHp: 100,
  sp: 50,
  maxSp: 50,
  zoneId: 'zone-1',
  x: 0,
  y: 0,
  z: 0,
} as const;
