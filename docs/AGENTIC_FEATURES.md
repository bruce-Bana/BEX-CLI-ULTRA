# BEX Agentic Workflow

BEX is designed around bounded, inspectable actions rather than unrestricted autonomy.

## Agent capabilities
- Project-specific guidance in `AGENTS.md`.
- Role prompts in `.bex/agents/` and reusable skills in `.bex/skills/`.
- Approval-oriented shell execution and read-only mode.
- File checkpoints before risky edits (where supported by the command).
- Bounded task steps and explicit test/verification commands.
- Optional hooks/configuration for deterministic policy checks.

## Suggested workflow
1. `/plan <goal>` to ask the active model for a plan.
2. Review the plan and inspect files.
3. `/checkpoint save <file>` before modifying an important file.
4. Make changes in small increments and request approval for shell commands.
5. `/test` or a targeted test command, then `/review`.
6. Use `/checkpoint list` and restore only if needed.

## Permissions
- `/permissions ask`: ask before shell commands that can change state (default).
- `/permissions readonly`: block shell commands and file writes/deletes.
- `/permissions trusted`: allow shell commands without an interactive confirmation. Use only in a disposable, trusted environment.

BEX is not an OS-level sandbox. Permissions in the application do not contain malicious dependencies or hostile MCP servers.
