/**
 * Pure builder for the proxy + client-certificate configuration that must
 * reach every spawned svn process.
 *
 * This module is deliberately dependency-free (types only): it is imported by
 * `svn-runner`, which is bundled into worker threads where `require('electron')`
 * is unavailable — keep it free of Electron, caches, and services. The
 * service-facing facade (`services/svn-network-context.ts`) re-exports the
 * builder for main-process callers.
 */

import type { ProxySettings } from '@shared/types';

/**
 * Network configuration that must reach every spawned svn process for
 * authenticated-proxy and client-certificate flows to work (backlog item #37).
 *
 * svn does not read proxy or client-certificate settings from environment
 * variables — they live in the `servers` runtime-config file
 * (`http-proxy-host`, `http-proxy-username`, `ssl-client-cert-file`, ...) and
 * can equivalently be passed per-invocation as repeated
 * `--config-option servers:global:<key>=<value>` arguments. This builder
 * produces both shapes so the spawn layer can use whichever mechanism fits
 * (temp config-dir or config-option args).
 *
 * NOTE: svn 1.14 has no `--certificate` CLI option; a configured client
 * certificate must go through the servers config keys above.
 */
export interface SvnSpawnNetworkConfig {
  /** True when a usable authenticated or anonymous proxy is configured. */
  proxyActive: boolean;
  /** True when a client-certificate file is configured. */
  clientCertificateActive: boolean;
  /** Complete `[global]` section for a temp `servers` file (mode 0600). */
  serverConfigLines: string[];
  /**
   * `servers:global:<key>=<value>` values, one per entry, for repeated
   * `--config-option` arguments. Contains secrets (proxy/client-cert
   * passwords) — must only ever be logged through `redactArgs`.
   */
  configOptionArgs: string[];
}

export interface SvnSpawnNetworkConfigInput {
  proxySettings?: ProxySettings | null;
  clientCertificatePath?: string | null;
  /** PKCS#12 passphrase; no settings field exists yet (see beta-plan follow-up). */
  clientCertificatePassword?: string | null;
}

const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

function requireSafeConfigValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must not be empty`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    // A newline or similar would let a crafted value write arbitrary config
    // sections (config injection) into the generated `servers` file.
    throw new Error(`${label} must not contain control characters`);
  }
  return trimmed;
}

function requireValidProxyPort(port: number, label: string): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return port;
}

/**
 * Build the proxy + client-certificate spawn configuration from settings.
 * Throws on malformed values (control characters, invalid port) so callers
 * fail loudly instead of silently spawning without proxy/cert or corrupting
 * the generated config file.
 */
export function buildSvnSpawnNetworkConfig(
  input: SvnSpawnNetworkConfigInput
): SvnSpawnNetworkConfig {
  const entries: Array<[string, string]> = [];
  const proxy = input.proxySettings ?? undefined;
  const proxyActive = Boolean(proxy?.enabled && proxy?.host && proxy?.port);

  if (proxyActive && proxy) {
    entries.push(['http-proxy-host', requireSafeConfigValue(proxy.host, 'Proxy host')]);
    entries.push(['http-proxy-port', String(requireValidProxyPort(proxy.port, 'Proxy port'))]);
    if (proxy.username) {
      entries.push([
        'http-proxy-username',
        requireSafeConfigValue(proxy.username, 'Proxy username'),
      ]);
    }
    if (proxy.password) {
      entries.push([
        'http-proxy-password',
        requireSafeConfigValue(proxy.password, 'Proxy password'),
      ]);
    }
    if (proxy.bypassForLocal) {
      entries.push(['http-proxy-exceptions', 'localhost, 127.0.0.1']);
    }
  }

  const clientCertificatePath = input.clientCertificatePath?.trim();
  const clientCertificateActive = Boolean(clientCertificatePath);
  if (clientCertificatePath) {
    entries.push([
      'ssl-client-cert-file',
      requireSafeConfigValue(clientCertificatePath, 'Client certificate path'),
    ]);
    if (input.clientCertificatePassword) {
      entries.push([
        'ssl-client-cert-password',
        requireSafeConfigValue(input.clientCertificatePassword, 'Client certificate password'),
      ]);
    }
  }

  return {
    proxyActive,
    clientCertificateActive,
    serverConfigLines: ['[global]', ...entries.map(([key, value]) => `${key} = ${value}`)],
    configOptionArgs: entries.map(([key, value]) => `servers:global:${key}=${value}`),
  };
}
