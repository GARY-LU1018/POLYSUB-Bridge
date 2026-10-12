import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeConfig } from "./config.js";

export type RuntimeDiagnostics = {
  status: "verified" | "unknown";
  project: string;
  version: string;
  gitCommit: string;
  build: {
    manifestPresent: boolean;
    sourceHash: string | null;
    buildHash: string | null;
    sourceMatchesManifest: boolean;
    buildMatchesManifest: boolean;
  };
  provenance: {
    runtimeManifestPresent: boolean;
    runtimeManifestMatchesBuildManifest: boolean;
    nodePath: string | null;
    nodeSha256: string | null;
    nodeMatchesManifest: boolean;
    nodeExecutableMatchesManifest: boolean;
    repositoryGitCommit: string;
  };
  process: {
    pid: number;
    parentPid: number;
    launcherPid: number | null;
    executable: string;
    entrypoint: string;
    projectRoot: string;
    owner: string | null;
    startedAt: string | null;
    processStartTime: string | null;
    generation: string | null;
  };
  listener: {
    host: string;
    port: number;
    mcpPath: string;
    healthPath: string;
  };
  allowedRoots: string[];
  codex: {
    configuredCommand: string;
  };
  mcp: {
    transport: string;
    auth: "bearer-token" | "none";
  };
};

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildRuntimeDiagnostics(config: BridgeConfig, projectRoot = PROJECT_ROOT): RuntimeDiagnostics {
  const packageMetadata = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  const sourceHash = hashTree(path.join(projectRoot, "src"), [".ts"]);
  const buildHash = hashTree(path.join(projectRoot, "dist"), [".js"]);
  const manifestPath = path.join(projectRoot, "dist", "build-manifest.json");
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        version?: string;
        gitCommit?: string;
        sourceHash?: string;
        buildHash?: string;
      })
    : null;
  const runtimeManifestPath = path.join(projectRoot, "runtime-manifest.json");
  const runtimeManifest = existsSync(runtimeManifestPath)
    ? (JSON.parse(readFileSync(runtimeManifestPath, "utf8")) as {
        package?: { name?: string; version?: string };
        node?: { relativePath?: string; sha256?: string };
        entrypoint?: string;
        bridgeEntrypoint?: string;
        sourceHash?: string;
        buildHash?: string;
        gitCommit?: string;
      })
    : null;
  const gitCommit = runtimeManifest?.gitCommit || manifest?.gitCommit || "UNCOMMITTED";
  const repositoryGitCommit = readGitCommit(projectRoot);
  const sourceMatchesManifest = Boolean(manifest && manifest.sourceHash === sourceHash && manifest.version === packageMetadata.version);
  const buildMatchesManifest = Boolean(manifest && manifest.buildHash === buildHash);
  const runtimeManifestMatchesBuildManifest = Boolean(
    runtimeManifest &&
      manifest &&
      runtimeManifest.package?.name === packageMetadata.name &&
      runtimeManifest.package?.version === packageMetadata.version &&
      runtimeManifest.entrypoint === "launcher/launch.mjs" &&
      runtimeManifest.bridgeEntrypoint === "dist/cli.js" &&
      runtimeManifest.sourceHash === manifest.sourceHash &&
      runtimeManifest.buildHash === manifest.buildHash &&
      runtimeManifest.gitCommit === manifest.gitCommit
  );
  const nodePath = runtimeManifest?.node?.relativePath
    ? path.resolve(projectRoot, runtimeManifest.node.relativePath)
    : null;
  const nodeSha256 = nodePath && existsSync(nodePath) ? hashFile(nodePath) : null;
  const nodeMatchesManifest = Boolean(runtimeManifest?.node?.sha256 && nodeSha256 === runtimeManifest.node.sha256);
  const nodeExecutableMatchesManifest = Boolean(
    nodePath && normalizePath(process.execPath) === normalizePath(nodePath)
  );
  const artifactVerified =
    sourceMatchesManifest &&
    buildMatchesManifest &&
    runtimeManifestMatchesBuildManifest &&
    nodeMatchesManifest &&
    nodeExecutableMatchesManifest;
  const owner = readProcessOwner();

  return {
    status: artifactVerified ? "verified" : "unknown",
    project: packageMetadata.name || "codex-gpt-bridge",
    version: packageMetadata.version || "unknown",
    gitCommit,
    build: {
      manifestPresent: Boolean(manifest),
      sourceHash,
      buildHash,
      sourceMatchesManifest,
      buildMatchesManifest
    },
    provenance: {
      runtimeManifestPresent: Boolean(runtimeManifest),
      runtimeManifestMatchesBuildManifest,
      nodePath,
      nodeSha256,
      nodeMatchesManifest,
      nodeExecutableMatchesManifest,
      repositoryGitCommit
    },
    process: {
      pid: process.pid,
      parentPid: process.ppid,
      launcherPid: parseOptionalPid(process.env.CODEX_GPT_BRIDGE_LAUNCHER_PID),
      executable: process.execPath,
      entrypoint: path.resolve(process.argv[1] || "unknown"),
      projectRoot,
      owner,
      startedAt: process.env.CODEX_GPT_BRIDGE_STARTED_AT || null,
      processStartTime: readProcessStartTime(process.pid),
      generation: process.env.CODEX_GPT_BRIDGE_GENERATION || null
    },
    listener: {
      host: config.host,
      port: config.port,
      mcpPath: "/mcp",
      healthPath: "/healthz"
    },
    allowedRoots: config.allowedRoots,
    codex: {
      configuredCommand: config.codexCommand
    },
    mcp: {
      transport: "Streamable HTTP",
      auth: config.token && !config.noAuth ? "bearer-token" : "none"
    },
  };
}

function hashTree(root: string, extensions: string[]): string | null {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return null;
  }
  const files = collectFiles(root).filter((file) => extensions.includes(path.extname(file).toLowerCase())).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll(path.sep, "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function hashFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function collectFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function readGitCommit(projectRoot: string): string {
  try {
    return execFileSync("git", ["-C", projectRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || "UNCOMMITTED";
  } catch {
    return "UNCOMMITTED";
  }
}

function normalizePath(value: string): string {
  return path.resolve(value).replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
}

function readProcessOwner(): string | null {
  try {
    const command = process.platform === "win32" ? "whoami" : "id";
    return execFileSync(command, [], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}

function parseOptionalPid(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function readProcessStartTime(pid: number): string | null {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString("o")`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim() || null;
  } catch {
    return null;
  }
}
