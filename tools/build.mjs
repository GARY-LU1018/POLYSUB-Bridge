import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const packageMetadata = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));

rmSync(distRoot, { recursive: true, force: true });
const tsc = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");
const result = spawnSync(process.execPath, [tsc, "-p", path.join(projectRoot, "tsconfig.json")], {
  cwd: projectRoot,
  stdio: "inherit"
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const manifest = {
  project: packageMetadata.name,
  version: packageMetadata.version,
  gitCommit: readGitCommit(),
  sourceHash: hashTree(path.join(projectRoot, "src"), [".ts"]),
  buildHash: hashTree(distRoot, [".js"]),
  builtAt: new Date().toISOString()
};
writeFileSync(path.join(distRoot, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ build: "PASS", ...manifest }));

function hashTree(root, extensions) {
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

function collectFiles(root) {
  const files = [];
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

function readGitCommit() {
  try {
    return execFileSync("git", ["-C", projectRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || "UNCOMMITTED";
  } catch {
    return "UNCOMMITTED";
  }
}
