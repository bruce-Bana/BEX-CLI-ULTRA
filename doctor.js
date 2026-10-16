#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const ok = (s) => console.log('[OK]   ' + s);
const warn = (s) => console.log('[WARN] ' + s);
const fail = (s) => console.log('[FAIL] ' + s);
let failures = 0;

console.log('\nBEX CLI ULTRA diagnostics');
console.log('Platform: ' + os.platform() + ' ' + os.arch());
console.log('Node: ' + process.version);
if (Number(process.versions.node.split('.')[0]) >= 20) ok('Node.js 20+'); else { fail('Node.js 20+ required'); failures++; }

for (const file of ['index.js', 'package.json']) {
  if (fs.existsSync(path.join(root, file))) ok(file + ' found');
  else { fail(file + ' missing'); failures++; }
}
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  ok('package.json parses (' + pkg.name + ')');
  for (const dep of Object.keys(pkg.dependencies || {})) {
    try { require.resolve(dep); } catch { warn('Dependency not resolvable: ' + dep + ' (run npm install)'); }
  }
} catch (e) { fail('package.json invalid: ' + e.message); failures++; }

const envCandidates = [
  path.join(root, '.env'),
  path.join(os.homedir(), '.bex.env'),
  path.join(os.homedir(), '.env')
];
let hasKey = Boolean(process.env.GOOGLE_API_KEY || process.env.DEEPSEEK_API_KEY);
for (const file of envCandidates) {
  if (fs.existsSync(file)) {
    ok('Environment file found: ' + file);
    const text = fs.readFileSync(file, 'utf8');
    if (/^\s*(GOOGLE_API_KEY|DEEPSEEK_API_KEY)\s*=\s*\S+/m.test(text)) hasKey = true;
  }
}
if (hasKey) ok('At least one AI key appears configured (value not displayed)');
else warn('No AI API key detected. Add GOOGLE_API_KEY or DEEPSEEK_API_KEY to .env');
if (fs.existsSync(path.join(root, '.env'))) {
  try {
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    if (!/(^|\n)\.env(\r?\n|$)/.test(gi)) warn('.gitignore may not exclude .env; protect API keys');
    else ok('.env is excluded by .gitignore');
  } catch { warn('Could not verify .gitignore'); }
}
console.log(failures ? '\nDiagnostics finished with ' + failures + ' failure(s).' : '\nDiagnostics complete.');
process.exitCode = failures ? 1 : 0;
