import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import { enforceSandbox, findSensitiveFiles, isPublicCaBundle, loadConfig, requireAllowedCwd } from "../src/config.js";

describe("config policy", () => {
  it("defaults to current directory as the only allowed root", () => {
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });

    expect(config.allowedRoots).toEqual([realpathSync(process.cwd())]);
    expect(config.defaultSandbox).toBe("read-only");
    expect(config.allowWorkspaceWrite).toBe(false);
  });

  it("requires token or explicit local no-auth", () => {
    expect(() =>
      loadConfig({
        CODEX_GPT_BRIDGE_HOST: "127.0.0.1"
      })
    ).toThrow(/TOKEN/);

    expect(() =>
      loadConfig({
        CODEX_GPT_BRIDGE_HOST: "0.0.0.0",
        CODEX_GPT_BRIDGE_NO_AUTH: "1"
      })
    ).toThrow(/NO_AUTH/);
  });

  it("accepts explicit MCP HTTP allowed hosts", () => {
    const config = loadConfig({
      CODEX_GPT_BRIDGE_ALLOWED_HOSTS: "127.0.0.1,localhost,example.trycloudflare.com",
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });

    expect(config.allowedHosts).toEqual(["127.0.0.1", "localhost", "example.trycloudflare.com"]);
  });

  it("rejects cwd outside allowed roots", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const other = mkdtempSync(path.join(tmpdir(), "bridge-other-"));

    expect(requireAllowedCwd(root, [realpathSync(root)])).toBe(realpathSync(root));
    expect(() => requireAllowedCwd(other, [realpathSync(root)])).toThrow(/outside allowed roots/);
  });

  it("blocks write sandboxes unless explicitly enabled", () => {
    const config = loadConfig({
      CODEX_GPT_BRIDGE_NO_AUTH: "1"
    });

    expect(enforceSandbox(config, "read-only")).toBe("read-only");
    expect(() => enforceSandbox(config, "workspace-write")).toThrow(/ALLOW_WRITE/);
    expect(() => enforceSandbox(config, "danger-full-access")).toThrow(/ALLOW_DANGER/);
  });

  it("finds sensitive-looking files before delegation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    writeFileSync(path.join(root, ".env"), "TOKEN=synthetic-test-value\n");
    writeFileSync(path.join(root, "server.pem"), "synthetic-test-value\n");

    expect(findSensitiveFiles(root)).toEqual([path.join(root, ".env"), path.join(root, "server.pem")]);
  });

  it("blocks sensitive-looking symlink names before delegation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const target = path.join(root, "target");
    writeFileSync(target, "TOKEN=synthetic-test-value\n");
    symlinkSync(target, path.join(root, ".env"));

    expect(findSensitiveFiles(root)).toEqual([path.join(root, ".env")]);
  });

  it("allows the verified POLYSUB certifi public CA bundle", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const bundle = path.join(root, "cacert.pem");
    writeFileSync(bundle, `${rootCertificates[0]}\n`);

    expect(isPublicCaBundle(bundle)).toBe(true);
    expect(findSensitiveFiles(root)).toEqual([]);
  });

  it("continues blocking arbitrary PEM files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const arbitrary = path.join(root, "server.pem");
    writeFileSync(arbitrary, "not a certificate bundle\n");

    expect(findSensitiveFiles(root)).toEqual([arbitrary]);
  });

  it("blocks a cacert.pem containing private-key material", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const privatePem = path.join(root, "cacert.pem");
    writeFileSync(privatePem, "TEST-ONLY-KEY-MARKER\nsynthetic-test-value\n");

    expect(isPublicCaBundle(privatePem)).toBe(false);
    expect(findSensitiveFiles(root)).toEqual([privatePem]);
  });

  it("continues blocking .key and .env files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bridge-root-"));
    const envFile = path.join(root, ".env");
    const keyFile = path.join(root, "server.key");
    writeFileSync(envFile, "TOKEN=synthetic-test-value\n");
    writeFileSync(keyFile, "synthetic-test-value\n");

    expect(findSensitiveFiles(root)).toEqual([envFile, keyFile]);
  });
});
