/**
 * What `proxy` reads from the environment.
 *
 * The front door: the port the browser reaches, the one behind it where `api` listens, and where
 * the built web-ui is. Everything has a default that is right in the container, so an
 * installation sets none of them.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  dataEnvSchema,
  portSchema,
  requireDataDirInProduction,
  runtimeEnvSchema,
  urlWithScheme,
} from '@nebula-home/config';

/** Name this service reports in log records. */
export const SERVICE_NAME = 'proxy';

/**
 * Version this build reports on every log record.
 *
 * Kept in step with `package.json` by hand, as in every other service.
 */
export const SERVICE_VERSION = '0.0.0';

/** How the proxy serves TLS: not at all, or with the self-signed certificate it is given. */
export const PROXY_TLS_MODES = ['off', 'self-signed'] as const;

/**
 * The built web-ui when none is given: `apps/web-ui/dist` beside this package.
 *
 * Found from where this file sits - the same depth under `src` and `dist` - rather than from the
 * working directory, as `@nebula-home/config` finds the data directory.
 */
export const DEFAULT_WEB_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../web-ui/dist',
);

/** Everything `proxy` needs from the environment. */
export const proxyEnvSchema = runtimeEnvSchema
  .extend({
    /**
     * The interface to bind: every one, since this is the service a browser on the network
     * reaches. Everything else listens on loopback behind it.
     */
    PROXY_HOST: z.string().min(1).default('0.0.0.0'),

    /** The plain HTTP port. */
    PROXY_HTTP_PORT: portSchema(8080),

    /** The HTTPS port, when TLS is on. */
    PROXY_HTTPS_PORT: portSchema(8443),

    /**
     * Whether HTTPS is served too, with the self-signed certificate in `proxy/tls` of the data
     * directory - which the container generates on its first start. Plain HTTP is served
     * either way: a browser on the LAN reaches the house by address, and a certificate for
     * that is never trusted anyway.
     */
    PROXY_TLS_MODE: z.enum(PROXY_TLS_MODES).default('off'),

    /** Where `api` listens, for everything under `/api`. */
    PROXY_UPSTREAM_URL: urlWithScheme(['http:']).default('http://127.0.0.1:4000'),

    /** The built web-ui to serve: an absolute path. */
    PROXY_WEB_ROOT: z
      .string()
      .min(1)
      .refine((value) => path.isAbsolute(value), 'Must be an absolute path')
      .default(DEFAULT_WEB_ROOT),
  })
  // The data directory, whose `proxy/tls` holds the certificate.
  .extend(dataEnvSchema.shape)
  .superRefine(requireDataDirInProduction);

/** Everything `proxy` needs from the environment. */
export type ProxyConfig = z.output<typeof proxyEnvSchema>;
