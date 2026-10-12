# Install POLYSUB on Windows

> **Current status: source preview / public source candidate**

This is a practical setup guide for the current POLYSUB preview. It starts with the path a normal Windows user can follow and leaves developer-only options until the end.

POLYSUB is a local connection program for Codex. It is not a standalone AI app, and it does not install or include Codex.

## A. Before you start

Please have these things ready:

1. A Windows computer.
2. Node.js 20 or newer. Node.js runs the preview; npm, included with Node.js, downloads its required components.
3. A Codex installation that can already be started from a Windows command window. POLYSUB starts Codex but does not install it.
4. A copy of the POLYSUB source folder containing `package.json`.
5. An existing project folder that you are comfortable allowing Codex to use.

If you only want to download an application and click Install, please stop here for now. The current candidate is not packaged that way.

## B. Option 1 — Portable package

**Not yet released.**

There is currently no portable archive and no one-click installer to download. Do not copy a source folder and call it an installer; a copied source folder still needs Node.js, npm, and a separate Codex installation.

When a portable package is eventually released, its release page will state:

- the exact download file;
- supported Windows versions;
- whether Node.js and Codex are included or still required;
- the setup steps;
- the file checksum.

None of those portable-package details are available for the current source preview.

## C. Option 2 — Build from source

This is the only setup path currently represented by this candidate. “Build from source” means turning the project files into a runnable local copy on your computer. You do not need to change the source code to follow these steps.

## D. Step-by-step Windows setup

### 1. Install Node.js

Install Node.js 20 or newer from the [official Node.js website](https://nodejs.org/).

Expected result: Node.js is installed and npm is available with it.

### 2. Check Node.js and npm

Open **PowerShell** from the Windows Start menu. PowerShell is the command window used by the steps below.

Run:

```powershell
node --version
npm --version
```

Expected result: both commands print a version number. The Node.js version must be 20 or newer.

### 3. Obtain the source folder

Place the supplied POLYSUB source folder somewhere you can find it. The folder must contain `package.json` at its top level.

Expected result: you can see `package.json` when you open the folder in File Explorer.

### 4. Move PowerShell to the source folder

Replace the example path with the actual folder path and run:

```powershell
Set-Location -LiteralPath "C:\path\to\polysub-public-source-candidate-20261012"
```

Expected result: the PowerShell prompt now ends with the POLYSUB source-folder name.

### 5. Download the project components

Run:

```powershell
npm install
```

Expected result: npm finishes without an error and creates a `node_modules` folder. This folder is generated locally and should not be uploaded as part of the public source.

### 6. Build and test the preview

Run:

```powershell
npm run check
```

Expected result: the command completes successfully. It builds POLYSUB and runs the included tests. If it stops with an error, go to [If something goes wrong](#g-if-something-goes-wrong) before continuing.

### 7. Create a private local token

Run this in the same PowerShell window:

```powershell
$env:CODEX_GPT_BRIDGE_TOKEN = (New-Guid).Guid
```

Expected result: there is no error message. This creates a temporary password for this running copy. It stays available in this PowerShell window only.

### 8. Choose the allowed project folder

For a first local test, allow the current folder:

```powershell
$env:CODEX_GPT_BRIDGE_ROOTS = (Get-Location).Path
```

Expected result: there is no error message. POLYSUB will only allow Codex to use this selected folder by default. To use a different existing folder, replace the command with its full Windows path, for example:

```powershell
$env:CODEX_GPT_BRIDGE_ROOTS = "C:\path\to\your-project"
```

### 9. Start POLYSUB

Run:

```powershell
npm start
```

Expected result: the window prints a message that `codex-gpt-bridge` is listening locally. Keep this window open while you use POLYSUB. Seeing no new command prompt is normal: the service is still running.

## E. First launch

POLYSUB does not open a desktop window. It runs as a local service in the PowerShell window where you started it.

Keep that window open. To stop it later, press **Ctrl+C** in that same window. Starting it again requires repeating the token and folder settings in the new PowerShell session unless you have deliberately created your own safe startup process.

## F. How to confirm it is working

### 1. Open a second PowerShell window

Leave the POLYSUB window running, then open another PowerShell window from the Start menu.

Expected result: you have one window running POLYSUB and one window available for checks.

### 2. Check the local health page

Run:

```powershell
Invoke-RestMethod http://127.0.0.1:8876/healthz
```

Expected result: the response includes:

```text
ok   name
--   ----
True codex-gpt-bridge
```

The health check proves that the local POLYSUB service is running. It does not prove that a separate AI client is connected or that Codex has completed a task.

### 3. Connect an AI client only after the local check passes

Connecting an AI client is an additional integration step. The client must use the local POLYSUB address and the same authentication settings as the running PowerShell window. See [Operations](OPERATIONS.md) for the technical integration details.

## G. If something goes wrong

- If `node` or `npm` is not recognised, close and reopen PowerShell after installing Node.js.
- If `npm install` fails, confirm that you are in the folder containing `package.json`.
- If `npm run check` fails, keep the complete error text and see [Troubleshooting](TROUBLESHOOTING.md).
- If startup says that a token is missing, set `CODEX_GPT_BRIDGE_TOKEN` again in the same PowerShell window and retry.
- If the health check cannot connect, confirm that the original POLYSUB window is still running and still shows the listening message.
- If POLYSUB starts but Codex work fails, verify that Codex is installed separately and that its command can run the required app-server mode.

Do not publish tokens, private configuration, or complete logs containing secrets when asking for help.

## H. Developer-only details

Most users do not need this section. An MCP client is an AI application that uses a standard tool-connection protocol to call POLYSUB.

Advanced configuration is controlled through environment variables, including:

- `CODEX_GPT_BRIDGE_HOST` and `CODEX_GPT_BRIDGE_PORT` for the local listening address;
- `CODEX_GPT_BRIDGE_TOKEN` and `CODEX_GPT_BRIDGE_NO_AUTH` for local authentication;
- `CODEX_GPT_BRIDGE_ROOTS` for one or more allowed absolute folders;
- `CODEX_GPT_BRIDGE_DEFAULT_SANDBOX` and `CODEX_GPT_BRIDGE_ALLOW_WRITE` for access mode;
- `CODEX_GPT_BRIDGE_CODEX` for a non-default Codex command;
- `CODEX_GPT_BRIDGE_ENABLE_BLUE_WAKE` for the optional completion feature.

Keep the default loopback address and read-only mode unless you understand the consequences of changing them. For the full boundaries and diagnostic endpoints, read [Operations](OPERATIONS.md) and [Security](../../SECURITY.md).

For local development, `npm run dev` starts the TypeScript source directly instead of using the compiled output. That is a developer convenience, not the normal first-launch path.
