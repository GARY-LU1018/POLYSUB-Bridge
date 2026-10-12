# POLYSUB

> **Current status: source preview / public source candidate**

POLYSUB is a small program that runs on your Windows computer and lets an AI tool ask Codex to work with folders you choose. It keeps that connection on your own computer and starts with a narrow, local-only safety setup.

POLYSUB is not an AI model, a chat app, or a complete desktop application. It is for people who already use Codex and want a controlled way for another AI app or service to request local project work.

## What it can do

- Let an AI tool read a project folder that you explicitly choose.
- Ask Codex to inspect, test, or work in that folder.
- Keep the local connection bound to your own computer by default.
- Start with read-only access unless you deliberately enable writing.
- Report whether the local POLYSUB service is running.

## Who this preview is for

This preview is mainly for developers and technically comfortable Windows users who already have Codex available on their computer. It is not yet packaged for someone who simply wants to download an app and click Install.

## Current release status

There is currently **no one-click installer** and **no formally released portable download**. This folder is a public source candidate, not a finished product release. POLYSUB also does not install or include Codex for you.

If you only want a ready-to-use Windows application, this preview is not ready for that use yet. Do not look for an installer or portable archive in this repository; neither has been released.

## Quick start on Windows

The steps below run the current source preview. You need Node.js and a Codex installation that is already usable on the computer before you begin.

Node.js is the program that runs this preview. npm, which comes with Node.js, downloads the preview's required components.

### 1. Prepare Windows

Install Node.js 20 or newer, and make sure Codex is already available on the computer. POLYSUB does not install Codex.

### 2. Get the source folder

Use a copy of this source candidate supplied by the project owner. There is no public download link for a packaged POLYSUB application yet.

### 3. Open PowerShell in the source folder

PowerShell is Windows' built-in command window. Change to the folder that contains `package.json`:

```powershell
Set-Location -LiteralPath "C:\path\to\polysub-public-source-candidate-20261012"
```

### 4. Install and check the preview

```powershell
npm install
npm run check
```

This downloads the project components, builds the preview, and runs its checks. It should finish without an error.

### 5. Choose the folder POLYSUB may use

The following example allows the current source folder. Replace it with another existing project folder if that is what you want Codex to use:

```powershell
$env:CODEX_GPT_BRIDGE_TOKEN = (New-Guid).Guid
$env:CODEX_GPT_BRIDGE_ROOTS = (Get-Location).Path
```

The token is a private local password for this running copy. Keep this PowerShell window open and do not publish the token.

### 6. Start POLYSUB

```powershell
npm start
```

Leave this window running. A successful start prints a message saying that POLYSUB is listening locally.

### 7. Confirm that it is running

Open a second PowerShell window and run:

```powershell
Invoke-RestMethod http://127.0.0.1:8876/healthz
```

The response should show `ok: true`. That confirms that the local POLYSUB service is running. It does not by itself confirm that an AI client is connected or that Codex can complete a task.

For the full, beginner-oriented procedure, see [Install POLYSUB](docs/en/INSTALL.md) or [繁體中文安裝說明](docs/zh-TW/INSTALL.md).

## What you need to prepare

- A Windows computer.
- Node.js 20 or newer, including npm.
- A working Codex installation that POLYSUB can start.
- A project folder that you are comfortable allowing Codex to access.
- A private local token for the running service.

## Common limits right now

- There is no installer and no formally released portable package.
- This is a source preview, so setup requires a command window and basic developer tools.
- Codex is not included, installed, or licensed by this repository.
- Connecting a separate AI client is an additional setup step and is not demonstrated by the health check alone.
- Windows is the intended environment. Other operating systems have not been verified.
- The package metadata currently says MIT, but the final public license decision and approved `LICENSE` file are not yet in place.

## For developers

If you are integrating POLYSUB with an AI client or changing the source, continue with:

- [Installation and configuration](docs/en/INSTALL.md)
- [Operations](docs/en/OPERATIONS.md)
- [Troubleshooting](docs/en/TROUBLESHOOTING.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

The advanced documents explain the local HTTP endpoint, MCP integration, workspace permissions, optional features, and diagnostic information. Those details are not required for the first health check.

## License status

`package.json` currently declares `MIT` as package metadata. Treat that as provisional until the owner confirms attribution and adds the approved `LICENSE` file.
