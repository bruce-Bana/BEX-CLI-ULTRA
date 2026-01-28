
# BEX CLI ULTRA

## Features
- **AI Core**: Google Gemini 2.5 Flash & DeepSeek integration.
- **System Control**: File system ops, Git, Process execution.
- **Web Automation**: Puppeteer-based browsing and extraction.
- **Agentic Mode**: Autonomous task planning and execution (`/task`).
- **Resilience**: Daemon mode (`--daemon`), Watchdog self-healing, and Sandbox execution (`/sandbox`).
- **Extensibility**: Model Context Protocol (MCP) support.

## Commands
- `/help`         → Show all commands
- `/menu`         → Show categorized command menu
- `/task <goal>`  → Start autonomous agent
- `/sandbox <js>` → Run JavaScript in a secure VM sandbox
- `/browser`      → Launch web browser automation
- `/google <q>`   → Search Google
- `/visit <url>`  → Visit a website
- `/project`      → Analyze project structure
- `/git <cmd>`    → Git operations (status, log, diff)
- `/quit`         → Exit CLI
(See `/help` for the full list of 30+ commands)

## Run
```bash
# Interactive Mode
node index.js

# Daemon Mode
node index.js --daemon
```

## Example Sandbox
```text
/sandbox console.log("Hello from sandbox")
```
