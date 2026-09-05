/**
 * Carrying a failure across the bus without carrying a stack across the bus.
 *
 * A request/reply exchange spans two processes, so an error thrown in the responder has to reach
 * the requester as data. What crosses is the code, the message and the structured details;
 * the stack stays in the process that threw it, findable under the same trace identifier
 * (ARCHITECTURE.md 7.3).
 */
import {
  AdapterError,
  AuthenticationError,
  ConfigurationError,
  ConflictError,
  DeviceUnavailableError,
  InternalError,
  ERROR_CODES,
  isNebulaError,
  NotFoundError,
  PackageError,
  PermissionError,
  SchemaVersionMismatchError,
  ValidationError,
  type BusError,
  type ErrorCode,
  type NebulaError,
  type NebulaErrorOptions,
} from '@nebula-home/contracts';

/** How long a message may be before it is truncated to fit the wire schema. */
const MAX_MESSAGE_LENGTH = 1024;

/** Every platform error, addressable by the code it carries. */
type NebulaErrorConstructor = new (message: string, options?: NebulaErrorOptions) => NebulaError;

/**
 * The inverse of {@link NebulaError.code}.
 *
 * Exhaustive by construction: `satisfies Record<ErrorCode, ...>` means adding a code to
 * `ERROR_CODES` without adding it here is a compile error rather than an error that quietly
 * arrives at the far end as something else.
 */
const ERROR_CONSTRUCTORS = {
  [ERROR_CODES.VALIDATION]: ValidationError,
  [ERROR_CODES.NOT_FOUND]: NotFoundError,
  [ERROR_CODES.CONFLICT]: ConflictError,
  [ERROR_CODES.AUTHENTICATION]: AuthenticationError,
  [ERROR_CODES.PERMISSION]: PermissionError,
  [ERROR_CODES.DEVICE_UNAVAILABLE]: DeviceUnavailableError,
  [ERROR_CODES.ADAPTER]: AdapterError,
  [ERROR_CODES.PACKAGE]: PackageError,
  [ERROR_CODES.CONFIGURATION]: ConfigurationError,
  [ERROR_CODES.SCHEMA_VERSION_MISMATCH]: SchemaVersionMismatchError,
  [ERROR_CODES.INTERNAL]: InternalError,
} as const satisfies Record<ErrorCode, NebulaErrorConstructor>;

/**
 * Describes an unknown thrown value well enough to be worth reading.
 *
 * @param error - Whatever was caught.
 * @returns Its message when it is an `Error`, otherwise its string form.
 */
function describeUnknown(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return typeof error === 'string' && error.length > 0 ? error : 'Unknown error';
}

/**
 * Converts a thrown value into the shape that crosses the bus.
 *
 * Anything that is not a platform error becomes `ADAPTER`: from the requester's point of view
 * the far side failed in a way this contract does not describe, which is the same situation as
 * a bad gateway and is reported with the same code rather than being dressed up as one of the
 * specific failures the caller might branch on.
 *
 * @param error - Whatever the handler threw.
 * @returns The wire representation of that failure.
 */
export function toBusError(error: unknown): BusError {
  if (isNebulaError(error)) {
    return {
      code: error.code,
      message: error.message.slice(0, MAX_MESSAGE_LENGTH),
      details: error.details,
    };
  }

  return {
    code: ERROR_CODES.ADAPTER,
    message: describeUnknown(error).slice(0, MAX_MESSAGE_LENGTH),
    details: {},
  };
}

/**
 * Rebuilds a platform error from what arrived over the bus.
 *
 * The requester gets an error of the same class the responder threw, so a `catch` that tests
 * `instanceof NotFoundError` works whether the failure happened in this process or in another
 * one - which is the whole point of routing through a shared error hierarchy.
 *
 * @param busError - The failure as it was received.
 * @param subject - The subject the request was sent on, attached to the details so the log says
 * which call failed and not merely that one did.
 * @returns The reconstructed error, ready to be thrown.
 */
export function fromBusError(busError: BusError, subject: string): NebulaError {
  const known: NebulaErrorConstructor | undefined = Object.hasOwn(ERROR_CONSTRUCTORS, busError.code)
    ? ERROR_CONSTRUCTORS[busError.code as ErrorCode]
    : undefined;

  // An unrecognised code means the far side is running a build with a code this one has never
  // heard of. That is a version skew, and the honest report of it is that the remote party
  // failed unintelligibly - with the code it actually sent preserved in the details.
  const construct = known ?? AdapterError;
  const details =
    known === undefined ? { ...busError.details, remoteCode: busError.code } : busError.details;

  return new construct(busError.message, { details: { ...details, subject } });
}
