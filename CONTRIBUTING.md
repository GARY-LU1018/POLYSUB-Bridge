# Contributing to POLYSUB

Thank you for helping improve POLYSUB. Keep changes small, explain the user-visible effect, and update the relevant documentation when behavior or configuration changes.

## Local setup

Requirements:

- Node.js `>=20` and npm.
- A working `codex` command for runtime changes; source-only tests do not require a live external host.

Install and validate:

```powershell
npm install
npm run check
```

Use `npm run dev` for source-mode development and `npm run build` followed by `npm start` for compiled-mode checks.

## Branches and pull requests

- Create a focused branch from the current default branch.
- Keep one coherent change per pull request.
- Describe scope, behavior changes, configuration changes, and known limitations.
- Include the tests you ran and their result.
- Do not include unrelated cleanup or generated output.

## Security and repository hygiene

Never commit secrets, environment files, local account names, machine-specific absolute paths, logs containing private data, `node_modules`, `dist`, or large binary packages. Remove secrets from logs before attaching them to an issue or pull request.

Before opening a pull request:

1. Run `npm run check`.
2. Review the diff for credentials, private paths, and generated files.
3. Update the English and Traditional Chinese user documentation when the public behavior changes.
4. State any external Tunnel, provider, or host-integration behavior that remains **Not yet verified**.
