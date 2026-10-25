/**
 * What `backup` reads from the environment.
 *
 * Two database connections: its own role's, for its runs and its locations, and the cluster's
 * superuser's - `NEBULA_BACKUP_DATABASE_URL` - which is what a whole-database dump and a restore
 * into a new database need, and which no other service holds. The instance keys, because an
 * archive carries them (encrypted) and a location's password is sealed with one of them.
 */
import { z } from 'zod';

import {
  busEnvSchema,
  databaseEnvSchema,
  dataEnvSchema,
  requireDataDirInProduction,
  runtimeEnvSchema,
  secretsEnvSchema,
  urlWithScheme,
} from '@nebulahome/config';

/** Name this service reports in log records and bus envelopes. */
export const SERVICE_NAME = 'backup';

/** Everything `backup` needs from the environment. */
export const backupEnvSchema = runtimeEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(busEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  .extend({
    /**
     * The cluster's superuser, for the dump and the restore. Outside production it falls back to
     * `DATABASE_URL`, which in development already is the superuser.
     */
    NEBULA_BACKUP_DATABASE_URL: urlWithScheme(['postgres:', 'postgresql:']).optional(),

    /**
     * The TOTP key, carried in every archive so an installation restored elsewhere can still
     * check its users' second factor. Optional: without it, the archive says so.
     */
    API_TOTP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'Must be 64 hex characters')
      .optional(),

    /** The backup key as 64 hex characters, over the generated file. */
    NEBULA_BACKUP_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'Must be 64 hex characters')
      .optional(),

    /** Where `pg_dump` and `pg_restore` are; on the PATH when absent. */
    BACKUP_PG_BIN_DIR: z.string().min(1).optional(),

    /** Where network shares are mounted while a backup writes to them: never the data directory. */
    BACKUP_MOUNT_ROOT: z.string().min(1).default('/run/nebula-backup/mounts'),

    /** Where the supervisor keeps the services a restore stops and starts again. */
    BACKUP_SERVICE_DIR: z.string().min(1).default('/run/service'),

    /** Where `api` answers, to know it is back after a restore. */
    BACKUP_API_URL: urlWithScheme(['http:']).default('http://127.0.0.1:4100'),

    /** How long one location may take to answer before it is given up on. */
    BACKUP_LOCATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(30_000),

    /** How long after starting a missed backup is taken, so the machine settles first. */
    BACKUP_CATCH_UP_DELAY_MS: z.coerce.number().int().min(0).max(3_600_000).default(300_000),
  })
  .extend(dataEnvSchema.shape)
  .superRefine(requireDataDirInProduction)
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.NEBULA_BACKUP_DATABASE_URL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['NEBULA_BACKUP_DATABASE_URL'],
        message: 'Required in production: the dump and the restore need the superuser',
      });
    }
  });

/** Everything `backup` needs from the environment. */
export type BackupConfig = z.output<typeof backupEnvSchema>;

/**
 * The superuser's connection string.
 *
 * @param config - The configuration.
 * @returns `NEBULA_BACKUP_DATABASE_URL`, or `DATABASE_URL` outside production.
 */
export function adminDatabaseUrl(config: BackupConfig): string {
  return config.NEBULA_BACKUP_DATABASE_URL ?? config.DATABASE_URL;
}
