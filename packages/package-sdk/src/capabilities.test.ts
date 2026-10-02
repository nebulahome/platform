/**
 * The SDK's capabilities against the platform's: every state, reported state, params and command
 * equal, field for field, so a package typed against the SDK sends what `core` accepts.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type {
  CAPABILITY_DEFINITIONS,
  CapabilityName as PlatformCapabilityName,
  EntityStateClass as PlatformStateClass,
} from '@nebulahome/contracts';

import type {
  CapabilityCommands,
  CapabilityName,
  CapabilityParams,
  CapabilityStates,
  CommandableCapability,
  EntityStateClass,
  ReportedStates,
} from './capabilities.js';

/**
 * A type without the differences that do not change what it accepts: readonly arrays and
 * properties, and an explicit `undefined` on an optional property.
 */
type Normal<TType> = TType extends readonly (infer TItem)[]
  ? readonly Normal<TItem>[]
  : TType extends object
    ? { readonly [TKey in keyof TType]: Normal<Exclude<TType[TKey], undefined>> }
    : TType;

/** Whether two types accept the same values. */
type Same<TLeft, TRight> = [Normal<TLeft>] extends [Normal<TRight>]
  ? [Normal<TRight>] extends [Normal<TLeft>]
    ? true
    : false
  : false;

/** The platform's capability table. */
type Definitions = typeof CAPABILITY_DEFINITIONS;

/** Every capability, true where the SDK's shape is the platform's. */
type Matches<TShape extends Record<string, unknown>, TPlatform extends Record<string, unknown>> = {
  [TName in keyof TShape]: TName extends keyof TPlatform
    ? Same<TShape[TName], TPlatform[TName]>
    : false;
};

/** The platform's states, read back. */
type PlatformStates = { [TName in CapabilityName]: z.output<Definitions[TName]['state']> };

/** The platform's states, as reported. */
type PlatformReported = { [TName in CapabilityName]: z.input<Definitions[TName]['state']> };

/** The platform's params, as declared. */
type PlatformParams = { [TName in CapabilityName]: z.input<Definitions[TName]['params']> };

/** The platform's commands, as handed over. */
type PlatformCommands = {
  [TName in CommandableCapability]: Definitions[TName]['commands'] extends z.ZodType
    ? z.output<Definitions[TName]['commands']>
    : never;
};

/** Every key of a record, true. */
type AllTrue<TRecord> = { [TKey in keyof TRecord]: true };

describe('the capabilities', () => {
  it('are the platform’s, by name and state class', () => {
    expectTypeOf<Same<CapabilityName, PlatformCapabilityName>>().toEqualTypeOf<true>();
    expectTypeOf<Same<EntityStateClass, PlatformStateClass>>().toEqualTypeOf<true>();
  });

  it('have the platform’s states, read back and reported', () => {
    expectTypeOf<Matches<CapabilityStates, PlatformStates>>().toEqualTypeOf<
      AllTrue<CapabilityStates>
    >();
    expectTypeOf<Matches<ReportedStates, PlatformReported>>().toEqualTypeOf<
      AllTrue<ReportedStates>
    >();
  });

  it('have the platform’s params and commands', () => {
    expectTypeOf<Matches<CapabilityParams, PlatformParams>>().toEqualTypeOf<
      AllTrue<CapabilityParams>
    >();
    expectTypeOf<Matches<CapabilityCommands, PlatformCommands>>().toEqualTypeOf<
      AllTrue<CapabilityCommands>
    >();
  });

  it('take commands exactly where the platform does', () => {
    type PlatformCommandable = {
      [TName in CapabilityName]: Definitions[TName]['commands'] extends null ? never : TName;
    }[CapabilityName];

    expectTypeOf<Same<CommandableCapability, PlatformCommandable>>().toEqualTypeOf<true>();
  });
});
