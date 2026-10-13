# POLYSUB

> **Current status: source preview / public source candidate**

POLYSUB connects an AI conversation with work that lives on your own computer. It is a local Bridge for sending requests from ChatGPT or another AI client to Codex and bringing the result back to the conversation.

POLYSUB is not an AI model or a replacement for ChatGPT or Codex. It is the connecting layer that makes a local project available to an AI workflow while keeping the computer, project folders, and execution path under the user's control.

## Why POLYSUB exists

AI conversations are convenient for asking questions, but the files and tools needed to complete real work often live on a separate computer. POLYSUB was created to close that gap: a request can start on a phone or in ChatGPT, travel through a Bridge/Tunnel connection to the local computer, and return with the local result.

The goal is a practical division of work. The local Bridge handles the connection and access boundary. Codex is brought in when the task needs project analysis, reasoning, testing, or changes.

## How it is used

1. Give ChatGPT or another AI client a task from a phone or computer.
2. The Bridge/Tunnel carries that request to the POLYSUB service on the computer where the project lives.
3. POLYSUB works within the folders that were authorized for it. A simple file-reading request can be handled by the Bridge without starting a new Codex turn.
4. When the task needs analysis or modification, POLYSUB asks local Codex to do that work.
5. The result travels back through the connection to the original conversation.

## Core capabilities

- Connect a remote AI conversation with local project folders.
- Read files directly from authorized folders when a Codex turn is not needed.
- Call Codex for deeper analysis, testing, execution, or intentional changes.
- Keep the Bridge and project data on the user's computer, with access limited to the folders selected for the connection.
- Return local work and results to the AI conversation through the Bridge/Tunnel path.

## Project status

This repository is a source preview and public source candidate. It is not a finished desktop release, and it does not currently provide a one-click installer or a formally released portable download. The project is being prepared as a transparent foundation for the local Bridge, Codex workflow, and future product packaging.

## Further reading

- [Installation and configuration](docs/en/INSTALL.md)
- [Operations](docs/en/OPERATIONS.md)
- [Troubleshooting](docs/en/TROUBLESHOOTING.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [繁體中文 README](README.zh-TW.md)
