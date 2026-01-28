#!/usr/bin/env node
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import os from 'os';
import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import figlet from 'figlet';
import gradient from 'gradient-string';
import { exec, spawn } from 'child_process';
import util from 'util';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import puppeteer from 'puppeteer';
import open from 'open';
import mime from 'mime-types';
import Table from 'cli-table3';
import { highlight } from 'cardinal';

const execAsync = util.promisify(exec);

// =======================
// DAEMON / WORKER MODE
// =======================
if (process.argv.includes('--daemon')) {
  const args = process.argv.slice(1).filter(a => a !== '--daemon');
  args.push('--worker');
  const child = spawn(process.argv[0], args, { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('🧟 BEX running in daemon mode');
  process.exit(0);
}

const isWorker = process.argv.includes('--worker');
let heartbeat = Date.now();

if (isWorker) {
  setInterval(() => {}, 1 << 30); // Keep alive
  setInterval(() => { if (Date.now() - heartbeat > 15000) heartbeat = Date.now(); }, 5000); // Watchdog
}

// Prevent crash on unhandled errors - keep app running
process.on('uncaughtException', (err) => {
  console.error(chalk.red('\n🚨 Uncaught Exception:'), err.message);
  console.error(chalk.gray('Stack trace:'), err.stack);
  console.log(chalk.yellow('Continuing execution...'));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('\n🚨 Unhandled Rejection:'), reason);
  if (reason instanceof Error) {
    console.error(chalk.gray('Stack trace:'), reason.stack);
  }
  console.log(chalk.yellow('Continuing execution...'));
});

// Load .env from the package installation directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config(); // Load from current working directory
dotenv.config({ path: path.join(os.homedir(), '.bex.env') }); // Load from home directory (global install)
dotenv.config({ path: path.join(os.homedir(), '.env') }); // Load from home directory
dotenv.config({ path: path.join(__dirname, '.env') });

// Configuration & State
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

let currentProvider = 'google'; // 'google' | 'deepseek'
let history = []; // { role: 'user'|'model'|'system', content: string }
let browser = null;
let page = null;
let pendingImage = null; // For Gemini multimodal
let mcpServers = {}; // { label: url }
let autoExecute = false; // For /auto mode
let multilineMode = false; // For multiline input
let multilineBuffer = ''; // Buffer for multiline input
let persistentMode = true; // Keep services running after responses
let activeServices = { browser: false, mcp: false }; // Track running services
const MEMORY_FILE = 'bex-memory.json';

const BASE_SYSTEM_INSTRUCTIONS = `You are BEX, a powerful AI CLI agent.
- You are running in a terminal environment.
- You can execute system commands, manage files, browse the web, search code, and analyze projects using the provided tools.
- Be concise, technical, and helpful.
- When providing code, use markdown blocks.
- If the user asks to perform a system action, suggest the appropriate command.

You have access to the following tools. Output the command to use them:

1. FILE SYSTEM:
   - /ls [path] : List files in directory
   - /read <file> : Read file content
   - /write <file> <content> : Write to file (overwrite)
   - /append <file> <content> : Append content to file
   - /delete <file> : Delete file (with confirmation)
   - /rename <old> <new> : Rename file
   - /download <url> [filename] : Download file from URL

2. SEARCH & ANALYSIS:
   - /grep <pattern> [file] : Search for text patterns in files
   - /glob <pattern> : Find files using glob patterns
   - /git <status|log|diff|commits> : Git repository operations
   - /project : Analyze project structure and statistics
   - /memory : Discover documentation/memory files

3. SYSTEM & AGENT:
   - /exec <cmd> : Execute shell command
   - /task <goal> : Start autonomous agent workflow
   - /auto : Toggle auto-execution mode
   - /workflow <file> : Run batch commands from file
   - /image <file> : Analyze image (Gemini only)

4. WEB BROWSING:
   - /browser : Launch browser automation
   - /visit <url> : Navigate to URL
   - /google <query> : Search Google
   - /url <url> : Fetch website text content
   - /open <url> : Open URL in system browser
   - /click <selector> : Click element by CSS selector
   - /type <selector> <text> : Type text into input field
   - /dump : Get current page text content
   - /screenshot : Save page screenshot

5. MCP (Model Context Protocol):
   - /mcp_list : List connected MCP servers
   - /mcp_add <label> <url> : Add MCP server
   - /mcp_tools : List available MCP tools
   - /mcp_call <label> <tool> [args] : Call MCP tool

6. UTILITIES:
   - /help : Show all available commands
   - /menu : Show categorized command menu
   - /status : Show current BEX status and active services
   - /persistent : Toggle persistent mode (keep services running)
   - /clear : Clear conversation history
   - /save [file] : Save chat history to file
   - /provider [google|deepseek|auto] : Switch AI provider
   - /multiline : Toggle multiline input mode
   - /quit : Exit the application and shut down services

Use these commands to fulfill user requests. For complex tasks, use /task to create automated workflows.`;

const getSystemInstructions = () => {
  let instructions = BASE_SYSTEM_INSTRUCTIONS;
  const projectContextPath = path.join(process.cwd(), 'GEMINI.md');
  if (fs.existsSync(projectContextPath)) {
    const projectContext = fs.readFileSync(projectContextPath, 'utf8');
    instructions += `\n\n## PROJECT CONTEXT (GEMINI.md)\nThe user has provided the following context for this project:\n${projectContext}`;
  }
  return instructions;
};

let SYSTEM_INSTRUCTIONS = getSystemInstructions();

// Initialize AI Clients
let genAI, geminiModel, deepseek;

if (GOOGLE_API_KEY) {
  genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
  geminiModel = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash-lite',
    systemInstruction: SYSTEM_INSTRUCTIONS
  });
}

if (DEEPSEEK_API_KEY) {
  deepseek = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: DEEPSEEK_API_KEY
  });
}

if (!isWorker) {
  console.clear();
  console.log(gradient.rainbow(figlet.textSync('BEX CLI ULTRA', { font: 'ANSI Shadow' })));
  console.log(chalk.green('Gemini‑Complete AI Terminal'));
  if (!GOOGLE_API_KEY && !DEEPSEEK_API_KEY) {
    console.log(chalk.red('WARNING: No API keys found. Checked:'));
    console.log(chalk.gray(`- ${path.join(process.cwd(), '.env')}`));
    console.log(chalk.gray(`- ${path.join(os.homedir(), '.env')}`));
    console.log(chalk.gray(`- ${path.join(__dirname, '.env')}`));
  }
}

let rl;
if (!isWorker) {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}

// Helper Functions
function setPrompt() {
  if (isWorker) return;
  const providerText = `[${currentProvider}${autoExecute ? ':AUTO' : ''}]`;
  rl.setPrompt(gradient.rainbow(providerText) + chalk.cyan(' › '));
}

function promptUser() {
  if (isWorker) return;
  rl.prompt();
}

function runSandboxed(code) {
  const sandbox = { console: { log: (...args) => console.log(chalk.gray('[sandbox]'), ...args) } };
  const context = vm.createContext(sandbox);
  const script = new vm.Script(code, { timeout: 2000 });
  return script.runInContext(context);
}

// Command Handlers
const commands = {
  '/help': () => {
    console.log(gradient.rainbow('\n╔══════════════════════════════════════════════════════════════╗'));
    console.log(gradient.rainbow('║                        BEX CLI HELP                        ║'));
    console.log(gradient.rainbow('╚══════════════════════════════════════════════════════════════╝\n'));

    const table = new Table({
      head: [chalk.cyan('Command'), chalk.cyan('Description')],
      colWidths: [20, 50],
      style: { head: ['cyan'], border: ['blue'] }
    });

    table.push(
      [chalk.yellow('/provider [name]'), 'Switch AI (google, deepseek, auto)'],
      [chalk.yellow('/status'), 'Show current status and services'],
      [chalk.yellow('/persistent'), 'Toggle persistent mode'],
      [chalk.yellow('/quit'), 'Exit the application'],
      [chalk.yellow('/clear'), 'Clear conversation context'],
      [chalk.yellow('/ls [path]'), 'List files in directory'],
      [chalk.yellow('/read <file>'), 'Read file to context'],
      [chalk.yellow('/write <f> <txt>'), 'Write to file (overwrite)'],
      [chalk.yellow('/append <f> <txt>'), 'Append content to file'],
      [chalk.yellow('/delete <file>'), 'Delete file'],
      [chalk.yellow('/rename <o> <n>'), 'Rename file'],
      [chalk.yellow('/save [file]'), 'Save chat history'],
      [chalk.yellow('/google <query>'), 'Search Google'],
      [chalk.yellow('/download <url>'), 'Download file'],
      [chalk.yellow('/image <file>'), 'Attach image (Gemini only)'],
      [chalk.yellow('/sandbox <js>'), 'Run JS in sandbox'],
      [chalk.yellow('/exec <cmd>'), 'Execute system command'],
      [chalk.yellow('/task <goal>'), 'Agentic plan & execute'],
      [chalk.yellow('/auto'), 'Toggle auto-execution mode'],
      [chalk.yellow('/workflow <file>'), 'Run batch commands'],
      [chalk.yellow('/browser'), 'Launch browser automation'],
      [chalk.yellow('/url <url>'), 'Fetch website text'],
      [chalk.yellow('/open <url>'), 'Open in system browser'],
      [chalk.yellow('/visit <url>'), 'Navigate browser to URL'],
      [chalk.yellow('/click <sel>'), 'Click element (CSS selector)'],
      [chalk.yellow('/type <sel> <txt>'), 'Type text into input'],
      [chalk.yellow('/dump'), 'Dump page content to context'],
      [chalk.yellow('/screenshot'), 'Save browser screenshot'],
      [chalk.yellow('/mcp_list'), 'List MCP servers'],
      [chalk.yellow('/mcp_add <n> <u>'), 'Add MCP server'],
      [chalk.yellow('/mcp_tools'), 'List available MCP tools'],
      [chalk.yellow('/mcp_call <n> <t>'), 'Call MCP tool'],
      [chalk.yellow('/multiline'), 'Toggle multiline input mode'],
      [chalk.yellow('/grep <pattern> [file]'), 'Search for text patterns'],
      [chalk.yellow('/glob <pattern>'), 'Find files using glob patterns'],
      [chalk.yellow('/git <cmd>'), 'Git repository operations'],
      [chalk.yellow('/project'), 'Analyze project structure'],
      [chalk.yellow('/memory'), 'Discover memory/documentation files']
    );

    console.log(table.toString());
    console.log(chalk.gray('\n💡 Tip: Use /menu for categorized command overview'));
    console.log(gradient.rainbow('\n════════════════════════════════════════════════════════════════\n'));
  },
  '/menu': () => {
    console.log(gradient.rainbow('\n=== BEX CLI MENU ===\n'));
    const table = new Table({
      head: [chalk.cyan('Category'), chalk.cyan('Commands')],
      style: { head: ['cyan'], border: ['blue'] }
    });
    table.push(
      [chalk.green('General'), '/help, /menu, /quit, /clear, /save, /provider, /auto, /status, /persistent'],
      [chalk.yellow('File System'), '/ls, /read, /write, /append, /delete, /rename, /download'],
      [chalk.magenta('System & Agent'), '/exec, /task, /workflow, /image, /sandbox'],
      [chalk.blue('Web Browsing'), '/browser, /visit, /url, /google, /click, /type, /dump, /screenshot'],
      [chalk.red('MCP'), '/mcp_list, /mcp_add, /mcp_tools, /mcp_call']
    );
    console.log(table.toString());
    console.log(gradient.rainbow('\n=== END MENU ===\n'));
  },
  '/quit': async () => {
    console.log(chalk.yellow('Shutting down services...'));
    if (browser) {
      await browser.close();
      activeServices.browser = false;
    }
    if (activeServices.mcp) {
      // MCP server cleanup would go here
      activeServices.mcp = false;
    }
    process.exit(0);
  },
  '/clear': () => {
    history = [];
    pendingImage = null;
    if (fs.existsSync(MEMORY_FILE)) fs.unlinkSync(MEMORY_FILE);
    console.log(chalk.gray('Memory cleared.'));
  },
  '/provider': (args) => {
    const p = args[0]?.toLowerCase();
    if (['google', 'deepseek', 'auto'].includes(p)) {
      currentProvider = p;
      console.log(chalk.green(`Switched to ${p}`));
      setPrompt();
    } else {
      console.log(chalk.red('Invalid provider. Options: google, deepseek, auto'));
    }
  },
  '/ls': async (args) => {
    const dir = args[0] || '.';
    try {
      const files = await fs.promises.readdir(dir);
      console.log(chalk.cyan(files.join('\n')));
      history.push({ role: 'system', content: `Output of /ls ${dir}:\n${files.join(', ')}` });
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/read': async (args) => {
    if (!args[0]) return console.log(chalk.red('Usage: /read <file>'));
    try {
      const content = await fs.promises.readFile(args[0], 'utf8');
      console.log(chalk.gray(`Read ${content.length} chars.`));
      history.push({ role: 'system', content: `File ${args[0]} content:\n${content}` });
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/write': async (args) => {
    if (!args[0]) return console.log(chalk.red('Usage: /write <file> <content>'));
    const file = args[0];
    const content = args.slice(1).join(' ');
    try {
      await fs.promises.writeFile(file, content);
      console.log(chalk.green(`Wrote to ${file}`));
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/append': async (args) => {
    if (args.length < 2) return console.log(chalk.red('Usage: /append <file> <content>'));
    const file = args[0];
    const content = args.slice(1).join(' ');
    try {
      await fs.promises.appendFile(file, '\n' + content);
      console.log(chalk.green(`Appended to ${file}`));
      history.push({ role: 'system', content: `Appended content to ${file}` });
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/delete': async (args) => {
    if (!args[0]) return console.log(chalk.red('❌ Usage: /delete <file>'));
    const file = args[0];

    // Check if file exists
    try {
      await fs.promises.access(file);
    } catch (e) {
      return console.log(chalk.red(`❌ File '${file}' does not exist.`));
    }

    // Confirmation prompt with better styling
    console.log(chalk.yellow(`\n⚠️  WARNING: This will permanently delete '${chalk.bold(file)}'`));
    const rlConfirm = readline.createInterface({ input: process.stdin, output: process.stdout });
    rlConfirm.question(chalk.red('Are you sure? Type the filename to confirm: '), async (answer) => {
      rlConfirm.close();
      if (answer === file) {
        const spinner = ora('Deleting file...').start();
        try {
          await fs.promises.unlink(file);
          spinner.succeed(chalk.green(`✅ Deleted ${file}`));
        } catch (e) {
          spinner.fail(chalk.red(`❌ Failed to delete: ${e.message}`));
        }
      } else {
        console.log(chalk.gray('❌ Deletion cancelled.'));
      }
      promptUser();
    });
  },
  '/rename': async (args) => {
    if (args.length < 2) return console.log(chalk.red('Usage: /rename <old> <new>'));
    try {
      await fs.promises.rename(args[0], args[1]);
      console.log(chalk.green(`Renamed ${args[0]} to ${args[1]}`));
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/save': async (args) => {
    const file = args[0] || `bex-history-${Date.now()}.md`;
    const content = history.map(h => `**${h.role.toUpperCase()}**:\n${h.content}\n`).join('---\n');
    await fs.promises.writeFile(file, content);
    console.log(chalk.green(`Saved history to ${file}`));
  },
  '/download': async (args) => {
    if (!args[0]) return console.log(chalk.red('Usage: /download <url> [filename]'));
    const url = args[0];
    const filename = args[1] || path.basename(url) || 'downloaded-file';
    try {
      const res = await fetch(url);
      const buffer = await res.arrayBuffer();
      await fs.promises.writeFile(filename, Buffer.from(buffer));
      console.log(chalk.green(`Downloaded ${filename}`));
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/image': async (args) => {
    if (!args[0]) return console.log(chalk.red('Usage: /image <file>'));
    try {
      const mimeType = mime.lookup(args[0]) || 'image/png';
      const data = await fs.promises.readFile(args[0]);
      pendingImage = { inlineData: { data: data.toString('base64'), mimeType } };
      console.log(chalk.green('Image attached to next prompt.'));
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/sandbox': (args) => {
    const code = args.join(' ');
    try {
      runSandboxed(code);
    } catch (e) {
      console.log(chalk.red('Sandbox error:'), e.message);
    }
  },
  '/exec': async (args) => {
    const cmd = args.join(' ');
    const spinner = ora('Executing...').start();
    try {
      const { stdout, stderr } = await execAsync(cmd);
      spinner.stop();
      if (stdout) console.log(stdout);
      if (stderr) console.error(chalk.red(stderr));
      history.push({ role: 'system', content: `Command '${cmd}' output:\n${stdout}\n${stderr}` });
    } catch (e) {
      spinner.stop();
      console.log(chalk.red(e.message));
    }
  },
  '/task': async (args) => {
    const goal = args.join(' ');
    
    // Refresh instructions
    SYSTEM_INSTRUCTIONS = getSystemInstructions();
    if (GOOGLE_API_KEY && genAI) {
      geminiModel = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: SYSTEM_INSTRUCTIONS
      });
    }

    console.log(chalk.yellow(`🤖 Agent starting: ${goal}`));
    
    history.push({ role: 'user', content: `GOAL: ${goal}\n\nYou are an autonomous agent. Execute the task step-by-step.
AVAILABLE COMMANDS:
- /exec <cmd>: Run shell command
- /read <file>: Read file
- /write <file> <content>: Write file (creates/overwrites)
- /append <file> <content>: Append to file
- /ls [path]: List files
- /browser: Open browser
- /visit <url>: Visit website
- /dump: Get page text
- /click <selector>: Click element
- /type <selector> <text>: Type text
- /google <query>: Search Google
- /done: Task complete

INSTRUCTIONS:
1. Output ONE command at a time.
2. Wait for the result (SYSTEM INFO).
3. If the goal is achieved, output "/done".
4. Do not output markdown blocks for commands, just the command text.
` });

    let step = 0;
    const maxSteps = 20;

    while (step++ < maxSteps) {
      const spinner = ora(`Agent Step ${step}...`).start();
      try {
        let response = '';
        if (currentProvider === 'deepseek' || (currentProvider === 'auto' && !geminiModel)) {
          if (!deepseek) throw new Error('DeepSeek API Key missing.');
          const completion = await deepseek.chat.completions.create({
            messages: [
              { role: 'system', content: SYSTEM_INSTRUCTIONS },
              ...history.map(h => ({ role: h.role === 'model' ? 'assistant' : h.role === 'system' ? 'user' : h.role, content: h.content }))
            ],
            model: 'deepseek-chat'
          });
          response = completion.choices[0].message.content;
        } else {
          if (!geminiModel) throw new Error('Google API Key missing.');
          const chatHistory = history.slice(0, -1).map(h => ({
            role: h.role === 'model' ? 'model' : 'user',
            parts: [{ text: (h.role === 'system' ? 'SYSTEM INFO: ' : '') + h.content }]
          }));
          const lastMsg = history[history.length - 1];
          const parts = [{ text: (lastMsg.role === 'system' ? 'SYSTEM INFO: ' : '') + lastMsg.content }];
          const chat = geminiModel.startChat({ history: chatHistory });
          const result = await chat.sendMessage(parts);
          response = result.response.text();
        }

        spinner.stop();
        const command = response.trim();
        console.log(chalk.magenta('Agent › ') + command);
        history.push({ role: 'model', content: command });

        if (command.toLowerCase() === '/done') {
          console.log(chalk.green('Agent completed the task.'));
          break;
        }

        if (command.startsWith('/')) {
          const parts = command.split(' ');
          const cmd = parts[0];
          const args = parts.slice(1);
          if (commands[cmd]) await commands[cmd](args);
          else history.push({ role: 'system', content: 'Unknown command.' });
        }
      } catch (e) {
        spinner.fail(e.message);
        break;
      }
    }
  },
  '/auto': () => {
    autoExecute = !autoExecute;
    console.log(chalk.yellow(`Auto-execution: ${autoExecute}`));
  },
  '/workflow': async (args) => {
    if (!args[0]) return console.log(chalk.red('Usage: /workflow <file>'));
    try {
      const content = await fs.promises.readFile(args[0], 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(chalk.gray(`Workflow executing: ${line}`));
          await handleInput(line);
        }
      }
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/browser': async () => {
    if (browser) return console.log(chalk.yellow('Browser already open.'));
    const spinner = ora('Launching Puppeteer...').start();
    try {
      browser = await puppeteer.launch({ headless: false });
      page = await browser.newPage();
      spinner.succeed('Browser ready.');
    } catch (e) { spinner.fail(e.message); }
  },
  '/google': async (args) => {
    if (!browser) await commands['/browser']();
    const query = args.join(' ');
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await commands['/visit']([url]);
    await commands['/dump']();
  },
  '/url': async (args) => {
    if (!args[0]) return console.log(chalk.red('Usage: /url <url>'));
    try {
      const res = await fetch(args[0]);
      const text = await res.text();
      history.push({ role: 'system', content: `Content of ${args[0]}:\n${text.substring(0, 5000)}...` });
      console.log(chalk.green(`Fetched ${text.length} chars.`));
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/open': async (args) => {
    if (!args[0]) return console.log(chalk.red('Usage: /open <url>'));
    await open(args[0]);
    console.log(chalk.green('Opened in system browser.'));
  },
  '/visit': async (args) => {
    if (!page) return console.log(chalk.red('Run /browser first.'));
    try { await page.goto(args[0]); console.log(chalk.green(`Visited ${args[0]}`)); }
    catch (e) { console.log(chalk.red(e.message)); }
  },
  '/click': async (args) => {
    if (!page) return console.log(chalk.red('Run /browser first.'));
    try { await page.click(args[0]); console.log(chalk.green('Clicked.')); }
    catch (e) { console.log(chalk.red(e.message)); }
  },
  '/type': async (args) => {
    if (!page) return console.log(chalk.red('Run /browser first.'));
    try { await page.type(args[0], args.slice(1).join(' ')); console.log(chalk.green('Typed.')); }
    catch (e) { console.log(chalk.red(e.message)); }
  },
  '/dump': async () => {
    if (!page) return console.log(chalk.red('Run /browser first.'));
    const text = await page.evaluate(() => document.body.innerText);
    history.push({ role: 'system', content: `Browser Page Content:\n${text}` });
    console.log(chalk.green('Page content added to context.'));
  },
  '/screenshot': async () => {
    if (!page) return console.log(chalk.red('Run /browser first.'));
    const fp = `screen-${Date.now()}.png`;
    await page.screenshot({ path: fp });
    console.log(chalk.green(`Saved ${fp}`));
    open(fp);
  },
  '/mcp_list': () => {
    const table = new Table({ head: ['Label', 'URL'] });
    Object.entries(mcpServers).forEach(([k, v]) => table.push([k, v]));
    console.log(table.toString());
  },
  '/mcp_add': (args) => {
    if (args.length < 2) return console.log(chalk.red('Usage: /mcp_add <label> <url>'));
    mcpServers[args[0]] = args[1];
    activeServices.mcp = true;
    console.log(chalk.green(`Added MCP server ${args[0]} (persistent connection)`));
  },
  '/mcp_tools': async () => {
    if (Object.keys(mcpServers).length === 0) return console.log(chalk.yellow('No MCP servers connected.'));
    for (const [label, url] of Object.entries(mcpServers)) {
      try {
        const res = await fetch(`${url}/tools`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const tools = json.tools || json;
        console.log(chalk.cyan(`\nTools on ${label}:`));
        if (Array.isArray(tools)) {
          tools.forEach(t => console.log(`- ${t.name}: ${t.description || 'No description'}`));
          history.push({ role: 'system', content: `Available tools on ${label}: ${JSON.stringify(tools)}` });
        } else {
          console.log(chalk.gray('Invalid tools format.'));
        }
      } catch (e) { console.log(chalk.red(`Error fetching tools from ${label}: ${e.message}`)); }
    }
  },
  '/mcp_call': async (args) => {
    if (args.length < 2) return console.log(chalk.red('Usage: /mcp_call <label> <tool> [args...]'));
    const [label, tool, ...rest] = args;
    const url = mcpServers[label];
    if (!url) return console.log(chalk.red('Unknown MCP server.'));
    try {
      // Basic MCP implementation via HTTP POST
      const res = await fetch(`${url}/tools/${tool}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: rest })
      });
      const json = await res.json();
      console.log(chalk.cyan(JSON.stringify(json, null, 2)));
      history.push({ role: 'system', content: `MCP Call ${tool} result: ${JSON.stringify(json)}` });
    } catch (e) { console.log(chalk.red(e.message)); }
  },
  '/multiline': () => {
    multilineMode = !multilineMode;
    multilineBuffer = '';
    console.log(chalk.yellow(`Multiline mode: ${multilineMode ? 'ON' : 'OFF'}`));
    if (multilineMode) {
      console.log(chalk.gray('Use <<< to start multiline input, >>> to end and send.'));
    }
    setPrompt();
  },
  '/status': () => {
    console.log(gradient.rainbow('\n=== BEX STATUS ===\n'));
    console.log(chalk.cyan(`Persistent Mode: ${persistentMode ? 'ON' : 'OFF'}`));
    console.log(chalk.cyan(`Browser: ${activeServices.browser ? 'Running' : 'Not running'}`));
    console.log(chalk.cyan(`MCP Server: ${activeServices.mcp ? 'Connected' : 'Not connected'}`));
    console.log(chalk.cyan(`Multiline Mode: ${multilineMode ? 'ON' : 'OFF'}`));
    console.log(chalk.cyan(`Auto-execute: ${autoExecute ? 'ON' : 'OFF'}`));
    console.log(chalk.cyan(`Current Provider: ${currentProvider}`));
    console.log(gradient.rainbow('\n=== END STATUS ===\n'));
  },
  '/persistent': () => {
    persistentMode = !persistentMode;
    console.log(chalk.yellow(`Persistent mode: ${persistentMode ? 'ON' : 'OFF'}`));
    if (persistentMode) {
      console.log(chalk.gray('Services will remain running after AI responses.'));
    } else {
      console.log(chalk.gray('Services may close after AI responses.'));
    }
  },
  '/grep': async (args) => {
    if (args.length < 1) return console.log(chalk.red('❌ Usage: /grep <pattern> [file]'));
    const pattern = args[0];
    const file = args[1];

    const spinner = ora('Searching...').start();
    try {
      let results = [];
      if (file) {
        // Search in specific file
        const content = await fs.promises.readFile(file, 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes(pattern)) {
            results.push(`${chalk.cyan(file)}:${chalk.yellow(index + 1)}:${line}`);
          }
        });
      } else {
        // Search in current directory recursively
        const searchDir = async (dir) => {
          const items = await fs.promises.readdir(dir, { withFileTypes: true });
          for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
              await searchDir(fullPath);
            } else if (item.isFile() && !item.name.startsWith('.')) {
              try {
                const content = await fs.promises.readFile(fullPath, 'utf8');
                const lines = content.split('\n');
                lines.forEach((line, index) => {
                  if (line.includes(pattern)) {
                    results.push(`${chalk.cyan(fullPath)}:${chalk.yellow(index + 1)}:${line.trim()}`);
                  }
                });
              } catch (e) {
                // Skip binary files or files that can't be read
              }
            }
          }
        };
        await searchDir('.');
      }

      spinner.stop();
      if (results.length === 0) {
        console.log(chalk.gray('No matches found.'));
      } else {
        console.log(chalk.green(`Found ${results.length} matches:`));
        results.slice(0, 50).forEach(result => console.log(result));
        if (results.length > 50) {
          console.log(chalk.gray(`... and ${results.length - 50} more matches`));
        }
      }
    } catch (e) {
      spinner.fail(chalk.red(`❌ Search failed: ${e.message}`));
    }
  },
  '/glob': async (args) => {
    if (args.length < 1) return console.log(chalk.red('❌ Usage: /glob <pattern>'));
    const pattern = args[0];

    const spinner = ora('Finding files...').start();
    try {
      const results = [];

      const searchDir = async (dir, relativePath = '') => {
        const items = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          const relPath = path.join(relativePath, item.name);

          if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
            await searchDir(fullPath, relPath);
          } else if (item.isFile()) {
            // Simple glob matching (could be enhanced with a proper glob library)
            if (pattern.includes('*')) {
              const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
              if (regex.test(relPath)) {
                results.push(relPath);
              }
            } else if (relPath.includes(pattern)) {
              results.push(relPath);
            }
          }
        }
      };

      await searchDir('.');
      spinner.stop();

      if (results.length === 0) {
        console.log(chalk.gray('No files found matching pattern.'));
      } else {
        console.log(chalk.green(`Found ${results.length} files:`));
        results.forEach(file => console.log(chalk.cyan(`  ${file}`)));
      }
    } catch (e) {
      spinner.fail(chalk.red(`❌ Glob search failed: ${e.message}`));
    }
  },
  '/git': async (args) => {
    const subcommand = args[0];
    const spinner = ora('Running git command...').start();

    try {
      let cmd;
      switch (subcommand) {
        case 'status':
          cmd = 'git status --porcelain';
          break;
        case 'log':
          cmd = `git log --oneline -${args[1] || 10}`;
          break;
        case 'diff':
          cmd = 'git diff --stat';
          break;
        case 'commits':
          const days = args[1] || 7;
          cmd = `git log --oneline --since="${days} days ago"`;
          break;
        default:
          spinner.stop();
          return console.log(chalk.red('❌ Usage: /git <status|log|diff|commits [days]>'));
      }

      const { stdout } = await execAsync(cmd);
      spinner.stop();

      if (stdout.trim()) {
        console.log(chalk.green(`Git ${subcommand}:`));
        console.log(stdout);
        history.push({ role: 'system', content: `Git ${subcommand} output:\n${stdout}` });
      } else {
        console.log(chalk.gray(`No git ${subcommand} output.`));
      }
    } catch (e) {
      spinner.fail(chalk.red(`❌ Git command failed: ${e.message}`));
    }
  },
  '/project': async () => {
    const spinner = ora('Analyzing project...').start();
    try {
      const stats = {
        files: 0,
        dirs: 0,
        totalSize: 0,
        extensions: {}
      };

      const analyzeDir = async (dir) => {
        const items = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === 'node_modules') continue;

          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            stats.dirs++;
            await analyzeDir(fullPath);
          } else if (item.isFile()) {
            stats.files++;
            try {
              const stat = await fs.promises.stat(fullPath);
              stats.totalSize += stat.size;

              const ext = path.extname(item.name) || 'no-ext';
              stats.extensions[ext] = (stats.extensions[ext] || 0) + 1;
            } catch (e) {
              // Skip files that can't be stat'd
            }
          }
        }
      };

      await analyzeDir('.');
      spinner.stop();

      console.log(chalk.green('\n📊 Project Summary:'));
      console.log(chalk.cyan(`Files: ${stats.files}`));
      console.log(chalk.cyan(`Directories: ${stats.dirs}`));
      console.log(chalk.cyan(`Total Size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`));

      console.log(chalk.green('\n📁 File Extensions:'));
      Object.entries(stats.extensions)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([ext, count]) => {
          console.log(chalk.cyan(`  ${ext}: ${count} files`));
        });

    } catch (e) {
      spinner.fail(chalk.red(`❌ Project analysis failed: ${e.message}`));
    }
  },
  '/memory': async () => {
    const spinner = ora('Analyzing memory...').start();
    try {
      const memory = [];
      const searchDir = async (dir, relativePath = '') => {
        const items = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          const relPath = path.join(relativePath, item.name);

          if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
            await searchDir(fullPath, relPath);
          } else if (item.isFile() && (item.name.endsWith('.md') || item.name.endsWith('.txt'))) {
            try {
              const content = await fs.promises.readFile(fullPath, 'utf8');
              if (content.length > 100) { // Only include substantial files
                memory.push({
                  path: relPath,
                  content: content.substring(0, 2000) + (content.length > 2000 ? '...' : ''),
                  size: content.length
                });
              }
            } catch (e) {
              // Skip files that can't be read
            }
          }
        }
      };

      await searchDir('.');
      spinner.stop();

      if (memory.length === 0) {
        console.log(chalk.gray('No memory files found (.md, .txt).'));
      } else {
        console.log(chalk.green(`📝 Found ${memory.length} memory files:`));
        memory.forEach(item => {
          console.log(chalk.cyan(`\n${item.path} (${(item.size / 1024).toFixed(1)} KB):`));
          console.log(item.content.substring(0, 200) + (item.content.length > 200 ? '...' : ''));
        });
        history.push({ role: 'system', content: `Memory files found: ${JSON.stringify(memory)}` });
      }
    } catch (e) {
      spinner.fail(chalk.red(`❌ Memory analysis failed: ${e.message}`));
    }
  }
};

async function handleInput(line, isSystemPrompt = false) {
  heartbeat = Date.now();
  line = line.trim();

  // Handle multiline input
  if (multilineMode) {
    if (line === '<<<') {
      multilineBuffer = '';
      console.log(chalk.gray('Multiline input started. Type >>> to end.'));
      return;
    } else if (line === '>>>') {
      if (multilineBuffer.trim()) {
        await handleInput(multilineBuffer.trim(), isSystemPrompt);
      }
      multilineBuffer = '';
      console.log(chalk.gray('Multiline input ended.'));
      return;
    } else {
      multilineBuffer += line + '\n';
      return;
    }
  }

  if (!line) return;

  // Refresh System Instructions & Model
  SYSTEM_INSTRUCTIONS = getSystemInstructions();
  console.log(chalk.gray(`System instructions loaded (${SYSTEM_INSTRUCTIONS.length} chars)`));
  if (GOOGLE_API_KEY && genAI) {
    geminiModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction: SYSTEM_INSTRUCTIONS
    });
  }

  if (line.startsWith('/')) {
    const parts = line.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);
    try {
      if (commands[cmd]) await commands[cmd](args);
      else console.log(chalk.red('Unknown command.'));
    } catch (e) {
      console.log(chalk.red(`Command execution error: ${e.message}`));
    }
  } else {
    // AI Chat
    if (!isSystemPrompt) history.push({ role: 'user', content: line });
    
    const spinner = ora('Thinking...').start();
    try {
      let response = '';
      
      let providerToUse = currentProvider;
      if (currentProvider === 'auto') {
        providerToUse = 'google'; // Default to Google, fallback to DeepSeek
      }

      const callGoogle = async () => {
        if (!geminiModel) throw new Error('Google API Key missing.');
        const chatHistory = (isSystemPrompt ? history : history.slice(0, -1)).map(h => ({
          role: h.role === 'model' ? 'model' : 'user',
          parts: [{ text: (h.role === 'system' ? 'SYSTEM INFO: ' : '') + h.content }]
        }));
        
        // Attach image if pending
        let parts = [{ text: line }];
        if (pendingImage) {
          parts.push(pendingImage);
          pendingImage = null; // Consume image
        }

        const chat = geminiModel.startChat({ history: chatHistory });
        const result = await chat.sendMessage(parts);
        return result.response.text();
      };

      const callDeepSeek = async () => {
        if (!deepseek) throw new Error('DeepSeek API Key missing.');
        const messages = [
          { role: 'system', content: SYSTEM_INSTRUCTIONS },
          ...history.map(h => ({ role: h.role === 'model' ? 'assistant' : h.role, content: h.content }))
        ];
        if (isSystemPrompt) messages.push({ role: 'user', content: line });
        const completion = await deepseek.chat.completions.create({
          messages,
          model: 'deepseek-chat'
        });
        return completion.choices[0].message.content;
      };

      try {
        if (providerToUse === 'google') response = await callGoogle();
        else response = await callDeepSeek();
      } catch (err) {
        if (currentProvider === 'auto' && providerToUse === 'google') {
          spinner.text = 'Google failed, trying DeepSeek...';
          response = await callDeepSeek();
        } else {
          throw err;
        }
      }

      spinner.stop();
      
      // Format and log response
      const formattedResponse = response.split(/(```[\s\S]*?```)/g).map(part => {
        if (part.startsWith('```')) {
          const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
          if (match) {
            try { return '\n' + highlight(match[2]) + '\n'; }
            catch (e) { return '\n' + chalk.gray(match[2]) + '\n'; }
          }
          return part;
        }
        return part.replace(/\*\*(.*?)\*\*/g, (_, text) => chalk.bold(text))
                   .replace(/`([^`]+)`/g, (_, text) => chalk.yellow(text));
      }).join('');

      console.log(gradient.rainbow('AI › ') + formattedResponse);
      history.push({ role: 'model', content: response });
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(history, null, 2));

      // Check for JSON plan (Agentic Mode)
      if (response.trim().startsWith('[') && response.trim().endsWith(']')) {
        try {
          const plan = JSON.parse(response);
          if (Array.isArray(plan)) {
            console.log(chalk.cyan('Detected plan. Executing...'));
            for (const step of plan) {
              console.log(chalk.gray(`> ${step}`));
              await handleInput(step);
            }
          }
        } catch (e) { /* Not a JSON plan */ }
      }

    } catch (e) {
      console.log(chalk.red(`Error: ${e.message}`));
      spinner.fail('Failed to process input.');
    }
  }
}

if (fs.existsSync(MEMORY_FILE)) {
  history = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  console.log(chalk.gray('Restored agent memory.'));
}

// Startup Sequence
if (!isWorker) {
  (async () => {
  // Auto-connect/start local MCP server
  const mcpUrl = 'http://localhost:4000';
  try {
    await fetch(`${mcpUrl}/tools`);
    mcpServers['files'] = mcpUrl;
    console.log(chalk.green('Connected to local MCP server (files).'));
  } catch (e) {
    const serverPath = path.join(__dirname, 'mcp-files-server.js');
    if (fs.existsSync(serverPath)) {
      console.log(chalk.yellow('Starting local MCP server...'));
      const child = spawn('node', [serverPath], { 
        detached: true, 
        stdio: 'ignore',
        cwd: __dirname 
      });
      child.unref();
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        await fetch(`${mcpUrl}/tools`);
        mcpServers['files'] = mcpUrl;
        console.log(chalk.green('Started & connected to local MCP server (files).'));
      } catch (err) { console.log(chalk.red('Failed to connect to local MCP server.')); }
    }
  }

  if ((GOOGLE_API_KEY || DEEPSEEK_API_KEY) && history.length === 0) {
    await handleInput('Greetings! Please introduce yourself and your capabilities.', true);
  }
  setPrompt();
  promptUser();
  process.stdin.resume();
  })();

  rl.on('line', async line => {
    try {
      await handleInput(line);
    } catch (e) {
      console.log(chalk.red(`Unexpected error: ${e.message}`));
    }
    promptUser();
  });
}
