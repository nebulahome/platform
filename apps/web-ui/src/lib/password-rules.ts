/**
 * What a password has to satisfy, stated so a form can show it.
 *
 * There is exactly one rule and that is the point. The API asks for twelve characters and
 * nothing else - no upper case, no digit, no symbol - because composition rules push people
 * towards `Password1!` and no further, while length is the axis that actually costs an attacker
 * anything. `api-users.ts` says so at the schema; this file is the same fact where somebody
 * typing can see it.
 *
 * That absence is worth showing rather than leaving implied. Most people arrive at a password
 * field expecting to be told off about symbols, and a list that says the one requirement and
 * then says there are no others saves them guessing at rules that do not exist.
 *
 * The numbers are restated here rather than imported from the schema because Zod does not expose
 * the bounds of a `min`/`max` as values. A test reads them back off the contract's own schema, so
 * the two cannot drift apart quietly.
 */

/** The shortest password the API accepts. */
export const PASSWORD_MINIMUM_LENGTH = 12;

/** The longest. Not a security limit - a limit on what is worth hashing. */
export const PASSWORD_MAXIMUM_LENGTH = 1024;

/** One requirement, and whether what has been typed satisfies it. */
export type PasswordRule = {
  /** What the rule asks for, in the words the form shows. */
  readonly label: string;

  /** Whether it is satisfied. */
  readonly isMet: boolean;

  /**
   * Whether to show it once it is satisfied.
   *
   * An upper bound nobody reaches is noise on every form it appears on, so it appears only when
   * it has been broken. A lower bound is the thing being worked towards, so it stays.
   */
  readonly isShownWhenMet: boolean;
};

/**
 * Checks a password against every rule the API enforces.
 *
 * @param password - What has been typed so far.
 * @returns Each rule with its verdict, in the order they should read.
 */
export function passwordRules(password: string): PasswordRule[] {
  return [
    {
      label: `At least ${String(PASSWORD_MINIMUM_LENGTH)} characters`,
      isMet: password.length >= PASSWORD_MINIMUM_LENGTH,
      isShownWhenMet: true,
    },
    {
      label: `At most ${String(PASSWORD_MAXIMUM_LENGTH)} characters`,
      isMet: password.length <= PASSWORD_MAXIMUM_LENGTH,
      isShownWhenMet: false,
    },
  ];
}

/**
 * Says whether a password would be accepted.
 *
 * A convenience over {@link passwordRules}, so a submit button and the list under the field
 * cannot disagree about what counts as valid.
 *
 * @param password - What has been typed so far.
 * @returns True when every rule is satisfied.
 */
export function isPasswordAcceptable(password: string): boolean {
  return passwordRules(password).every((rule) => rule.isMet);
}
