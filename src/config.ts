import { X509Certificate } from "node:crypto";
import path from "node:path";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-request" | "never";

// This bounds App Server control-plane requests only. It is deliberately not
// used as a wall-clock limit for an active Codex turn; normal work may run
// until the App Server reports completion, an error, or an explicit close.
export const CODEX_COMMUNICATION_TIMEOUT_MS = 30_000;

export type BridgeConfig = {
  host: string;
  port: number;
  token?: string;
  noAuth: boolean;
  allowedHosts?: string[];
  codexCommand: string;
  allowedRoots: string[];
  defaultSandbox: SandboxMode;
  allowWorkspaceWrite: boolean;
  allowDangerFullAccess: boolean;
  defaultApprovalPolicy: ApprovalPolicy;
  fastReturnMs: number;
  secretScan: boolean;
  enableBlueWake: boolean;
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const PUBLIC_CA_BUNDLE_BASENAME = "cacert.pem";
const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const host = env.CODEX_GPT_BRIDGE_HOST || "127.0.0.1";
  const port = parsePort(env.CODEX_GPT_BRIDGE_PORT || "8876");
  const token = normalizeOptional(env.CODEX_GPT_BRIDGE_TOKEN);
  const noAuth = parseBool(env.CODEX_GPT_BRIDGE_NO_AUTH);
  const allowedHosts = parseAllowedHosts(env.CODEX_GPT_BRIDGE_ALLOWED_HOSTS);
  const allowedRoots = parseAllowedRoots(env.CODEX_GPT_BRIDGE_ROOTS || process.cwd());
  const defaultSandbox = parseSandbox(env.CODEX_GPT_BRIDGE_DEFAULT_SANDBOX || "read-only");
  const allowWorkspaceWrite = parseBool(env.CODEX_GPT_BRIDGE_ALLOW_WRITE);
  const allowDangerFullAccess = parseBool(env.CODEX_GPT_BRIDGE_ALLOW_DANGER);
  const defaultApprovalPolicy = parseApprovalPolicy(env.CODEX_GPT_BRIDGE_APPROVAL_POLICY || "never");
  const fastReturnMs = parsePositiveInt(env.CODEX_GPT_BRIDGE_FAST_RETURN_MS || "25000");
  const secretScan = !parseBool(env.CODEX_GPT_BRIDGE_DISABLE_SECRET_SCAN);
  const enableBlueWake = parseBool(env.CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE);

  if (!token && !noAuth) {
    throw new Error("Set CODEX_GPT_BRIDGE_TOKEN, or set CODEX_GPT_BRIDGE_NO_AUTH=1 for local-only development.");
  }
  if (noAuth && !LOCAL_HOSTS.has(host)) {
    throw new Error("CODEX_GPT_BRIDGE_NO_AUTH=1 is allowed only for local host bindings.");
  }

  if (defaultSandbox === "workspace-write" && !allowWorkspaceWrite) {
    throw new Error("Default sandbox workspace-write requires CODEX_GPT_BRIDGE_ALLOW_WRITE=1.");
  }
  if (defaultSandbox === "danger-full-access" && !allowDangerFullAccess) {
    throw new Error("Default sandbox danger-full-access requires CODEX_GPT_BRIDGE_ALLOW_DANGER=1.");
  }

  return {
    host,
    port,
    token,
    noAuth,
    allowedHosts,
    codexCommand: env.CODEX_GPT_BRIDGE_CODEX || "codex",
    allowedRoots,
    defaultSandbox,
    allowWorkspaceWrite,
    allowDangerFullAccess,
    defaultApprovalPolicy,
    fastReturnMs,
    secretScan,
    enableBlueWake
  };
}

export function requireAllowedCwd(input: string, allowedRoots: string[]): string {
  if (!input || !path.isAbsolute(input)) {
    throw new Error("cwd must be an absolute path inside CODEX_GPT_BRIDGE_ROOTS.");
  }

  const cwd = realpathSync(input);
  const match = allowedRoots.some((root) => cwd === root || cwd.startsWith(root + path.sep));
  if (!match) {
    throw new Error(`cwd is outside allowed roots: ${cwd}`);
  }
  return cwd;
}

export function resolveAllowedCwd(input: string | undefined, allowedRoots: string[]): string {
  if (input) {
    return requireAllowedCwd(input, allowedRoots);
  }
  if (allowedRoots.length === 1) {
    return allowedRoots[0];
  }
  throw new Error("cwd is required when multiple CODEX_GPT_BRIDGE_ROOTS are configured.");
}

export function enforceSandbox(config: BridgeConfig, requested?: SandboxMode): SandboxMode {
  const sandbox = requested || config.defaultSandbox;
  if (sandbox === "workspace-write" && !config.allowWorkspaceWrite) {
    throw new Error("workspace-write is disabled. Set CODEX_GPT_BRIDGE_ALLOW_WRITE=1 to allow it.");
  }
  if (sandbox === "danger-full-access" && !config.allowDangerFullAccess) {
    throw new Error("danger-full-access is disabled. Set CODEX_GPT_BRIDGE_ALLOW_DANGER=1 to allow it.");
  }
  return sandbox;
}

export function findSensitiveFiles(root: string, maxFindings = 20): string[] {
  const findings: string[] = [];
  const skipDirs = new Set([".git", "node_modules", "dist", "coverage", ".next", ".turbo"]);
  const deniedBasenames = new Set([
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "id_rsa",
    "id_ed25519",
    "id_dsa",
    "id_ecdsa"
  ]);
  const deniedExtensions = [".pem", ".key", ".p12", ".pfx"];

  function walk(dir: string): void {
    if (findings.length >= maxFindings) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (findings.length >= maxFindings) {
        return;
      }
      const fullPath = path.join(dir, entry.name);
      const basename = entry.name;
      const lower = basename.toLowerCase();
      const allowedPublicCaBundle =
        !entry.isSymbolicLink() && lower === PUBLIC_CA_BUNDLE_BASENAME && isPublicCaBundle(fullPath);
      if (deniedBasenames.has(basename) || (deniedExtensions.some((ext) => lower.endsWith(ext)) && !allowedPublicCaBundle)) {
        findings.push(fullPath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
    }
  }

  if (existsSync(root) && statSync(root).isDirectory()) {
    walk(root);
  }
  return findings.sort();
}

/**
 * Allow only a regular file named cacert.pem whose complete non-comment
 * payload is one or more parseable X.509 certificate blocks. Private-key
 * markers and all other PEM-like material remain blocked.
 */
export function isPublicCaBundle(fullPath: string): boolean {
  if (path.basename(fullPath).toLowerCase() !== PUBLIC_CA_BUNDLE_BASENAME) {
    return false;
  }

  let content: string;
  try {
    content = readFileSync(fullPath, "utf8");
  } catch {
    return false;
  }

  if (/PRIVATE KEY/i.test(content)) {
    return false;
  }

  const blocks = content.match(CERTIFICATE_BLOCK) || [];
  if (blocks.length === 0) {
    return false;
  }

  const remainder = content
    .replace(CERTIFICATE_BLOCK, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (remainder.some((line) => !line.startsWith("#"))) {
    return false;
  }

  return blocks.every((block) => {
    try {
      new X509Certificate(block);
      return true;
    } catch {
      return false;
    }
  });
}

function parseAllowedRoots(raw: string): string[] {
  const roots = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!path.isAbsolute(part)) {
        throw new Error(`Allowed root must be absolute: ${part}`);
      }
      return realpathSync(part);
    });
  if (roots.length === 0) {
    throw new Error("At least one allowed root is required.");
  }
  return Array.from(new Set(roots));
}

function parseAllowedHosts(raw: string | undefined): string[] | undefined {
  const hosts = raw
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return hosts && hosts.length > 0 ? Array.from(new Set(hosts)) : undefined;
}

function parsePort(raw: string): number {
  const port = parsePositiveInt(raw);
  if (port > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

function parsePositiveInt(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer, got: ${raw}`);
  }
  return value;
}

function parseBool(raw: string | undefined): boolean {
  return raw === "1" || raw === "true" || raw === "yes";
}

function parseSandbox(raw: string): SandboxMode {
  if (raw === "read-only" || raw === "workspace-write" || raw === "danger-full-access") {
    return raw;
  }
  throw new Error(`Invalid sandbox: ${raw}`);
}

function parseApprovalPolicy(raw: string): ApprovalPolicy {
  if (raw === "untrusted" || raw === "on-request" || raw === "never") {
    return raw;
  }
  throw new Error(`Invalid approval policy: ${raw}`);
}

function normalizeOptional(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
}
