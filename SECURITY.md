# BEX CLI ULTRA Security Notes

## Before running

- Use Node.js 20 or newer and install dependencies from the repository.
- Put API keys in a local `.env` file. Never commit `.env`, paste keys into issues, or print them in logs.
- Run BEX with a normal user account, not an administrator, unless a specific task genuinely requires elevated privileges.
- Review commands before execution. AI output is untrusted input.

## Execution and sandboxing

The Node.js `vm` module is not a security sandbox for hostile JavaScript. Do not use `/sandbox` to run untrusted code or treat it as an isolation boundary. Real isolation requires a separate process/container/VM with restrictive permissions and resource limits.

Shell execution can modify files, install software, access the network, or delete data. Keep command execution approval-based and inspect the command and working directory first. Do not enable unattended execution on machines containing sensitive data.

## Browser and MCP

Only connect to MCP servers you trust. An MCP tool can have the same effective privileges as the account running BEX. Treat remote pages, tool descriptions, files and model responses as untrusted data. Do not expose local MCP endpoints to public networks without authentication and access controls.

## Reporting

Report vulnerabilities privately to the repository owner rather than posting API keys, personal data, or exploit details in public issues.
