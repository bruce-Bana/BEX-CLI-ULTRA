# BEX CLI ULTRA

BEX CLI ULTRA is a Node.js terminal assistant with Gemini and DeepSeek providers, file/project utilities, Git inspection, browser automation, optional MCP connections, and a bounded experimental agent workflow.

## Windows quick install

1. Install **Node.js 20 or newer** from https://nodejs.org/.
2. Download this repository ZIP and extract it, or clone it with Git.
3. Double-click `install.bat`.
4. Add your API key to the local `.env` file when prompted.
5. Run `run.bat`.

Or from a terminal:

```bat
npm install
copy .env.example .env
notepad .env
npm run doctor
npm start
```

Do not commit or share `.env`. At least one key is needed for AI responses:
- `GOOGLE_API_KEY`
- `DEEPSEEK_API_KEY`

## Commands

Use `/help` in the app for the complete command list. Core commands include `/task <goal>`, `/provider [google|deepseek|auto]`, `/ls`, `/read`, `/grep`, `/glob`, `/project`, `/git status`, `/browser`, `/google <query>`, `/visit <url>`, `/mcp_list`, and `/status`.

## Agentic features

- `/plan <goal>` asks the model for a plan without executing it.
- `/permissions ask|readonly|trusted` controls approvals; `ask` is the default.
- `/checkpoint save <file>`, `/checkpoint list`, and `/checkpoint restore <id>` manage file backups.
- `/agents` lists specialist profiles; `/skills [name]` lists or reads reusable workflows.
- `/review`, `/test`, `/doctor`, and `/hooks` support review and verification.
- `AGENTS.md` supplies project instructions; profiles live in `.bex/agents/` and `.bex/skills/`.

Trusted mode bypasses confirmation and should only be used in a disposable, trusted environment. The denylist is not a complete sandbox.

## Diagnostics and tests

```bat
npm run check
npm test
npm run doctor
```

The diagnostics command checks the Node version, project files, dependencies, and whether a key appears configured. It never prints key values.

## Safety notes

- AI output is untrusted input. Review commands before running them.
- Shell execution can modify files and access the network. Use least-privilege accounts.
- The JavaScript `vm` sandbox is **not** secure isolation for untrusted code. The `/sandbox` command is only a convenience for trusted snippets.
- Model-generated JSON plans are displayed for review instead of being executed automatically.
- Only connect MCP servers you trust. See [SECURITY.md](SECURITY.md).

## Project files

- `index.js` — CLI application
- `install.bat` — Windows dependency installer
- `run.bat` — syntax-check and launch helper
- `doctor.js` — local setup diagnostics
- `test/smoke.test.js` — Node built-in smoke tests
- `.env.example` — safe environment template
- `SECURITY.md` — security and execution guidance

## Current limitations

This project remains an evolving personal tool, not a hardened autonomous operating system. Browser/MCP features depend on the configured environment and server protocol. Validate changes and keep backups before allowing any agent to write or delete important files.
