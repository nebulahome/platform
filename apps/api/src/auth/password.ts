/**
 * Hashing and checking passwords.
 *
 * Thin on purpose: the parameters live in `@nebulahome/contracts` because they describe stored
 * artefacts, and the only judgement in this file is that a verify never says why it failed. A
 * caller that could tell "no such user" from "wrong password" apart could enumerate accounts,
 * so both answers are the same `false` and the timing is levelled by hashing a decoy.
 */
import { hash, verify } from '@node-rs/argon2';

import { ARGON2ID_PARAMS } from '@nebulahome/contracts';

/**
 * argon2id, as the library numbers its algorithms.
 *
 * The literal rather than the library's `Algorithm.Argon2id`: that is an ambient const enum,
 * which `verbatimModuleSyntax` refuses to inline (RULES.md 3). The value is part of the encoded
 * hash string, so it is checked by every round-trip in the password tests rather than trusted.
 */
const ARGON2ID = 2;

/** The options every hash in the platform is produced with. */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: ARGON2ID_PARAMS.memoryCost,
  timeCost: ARGON2ID_PARAMS.timeCost,
  parallelism: ARGON2ID_PARAMS.parallelism,
} as const;

/**
 * A hash of a password nobody has.
 *
 * Verified against when the username does not exist, so that a missing account costs the same
 * as a wrong password. Without it, sign-in answers "no such user" in a millisecond and "wrong
 * password" in fifty, which is a list of valid usernames for anyone with a stopwatch.
 */
let decoyHash: string | undefined;

/**
 * Hashes a password.
 *
 * @param password - The plaintext, straight from the request. Never logged.
 * @returns The argon2id encoded string, parameters included, ready for `auth.users.password_hash`.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * Checks a password against a stored hash.
 *
 * @param storedHash - The encoded string from the database.
 * @param password - What the caller typed.
 * @returns True when they match. False for a mismatch and for a hash this build cannot read -
 * a corrupted or truncated hash is not a reason to let someone in.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Spends the same time as a real verify, for a user that does not exist.
 *
 * @param password - What the caller typed, hashed against the decoy so the work is real.
 * @returns Always false.
 */
export async function verifyAgainstDecoy(password: string): Promise<boolean> {
  decoyHash ??= await hashPassword('not-a-real-password');

  return verifyPassword(decoyHash, password);
}

/**
 * Says whether a stored hash was made with weaker parameters than the current ones.
 *
 * Called after a successful sign-in, which is the only moment the plaintext is available to
 * rehash with. Raising {@link ARGON2ID_PARAMS} therefore upgrades accounts as people use them,
 * rather than requiring everyone to reset their password.
 *
 * @param storedHash - The encoded string from the database.
 * @returns True when it should be replaced with a fresh hash.
 */
export function needsRehash(storedHash: string): boolean {
  const memory = /\bm=(\d+)/.exec(storedHash);
  const time = /\bt=(\d+)/.exec(storedHash);
  const lanes = /\bp=(\d+)/.exec(storedHash);

  if (!storedHash.startsWith('$argon2id$') || memory === null || time === null || lanes === null) {
    return true;
  }

  return (
    Number(memory[1]) < ARGON2ID_PARAMS.memoryCost ||
    Number(time[1]) < ARGON2ID_PARAMS.timeCost ||
    Number(lanes[1]) !== ARGON2ID_PARAMS.parallelism
  );
}
