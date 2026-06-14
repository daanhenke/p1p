// A build profile = everything game-specific that ISN'T patch content: the registered datatypes
// (constructed from the game's specs), plus per-game constants the datatypes read (glyph maps,
// opcode table, name/string-table specs, code-patch anchor catalogue, the file↔datatype map).
// Persona 2 would be a new Profile reusing the same core/atlus/ps1 packages.

import type { Datatype, DatatypeRegistry } from "./datatype.js";

export interface Profile {
  /** Stable id a patch manifest targets, e.g. "persona1". */
  readonly id: string;
  readonly name: string;

  /** Datatypes this game supports, already constructed from its specs. */
  readonly datatypes: DatatypeRegistry;

  /** Open-ended per-game data bag (glyph maps, opcode table, specs…) for datatypes/build steps. */
  readonly data: Readonly<Record<string, unknown>>;
}

/** Typed helper to pull a required value out of a profile's data bag. */
export function profileData<T>(profile: Profile, key: string): T {
  if (!(key in profile.data)) throw new Error(`profile ${profile.id}: missing data "${key}"`);
  return profile.data[key] as T;
}

export type { Datatype };
