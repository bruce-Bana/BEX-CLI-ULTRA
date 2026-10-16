import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

test('package metadata is valid and uses ESM', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.scripts?.start, 'start script should exist');
});

test('entry point exists and parses', () => {
  const entry = path.join(root, 'index.js');
  assert.ok(fs.existsSync(entry), 'index.js should exist');
  const source = fs.readFileSync(entry, 'utf8');
  assert.match(source, /handleInput/);
  assert.match(source, /\/task/);
});

test('installer and launcher exist', () => {
  assert.ok(fs.existsSync(path.join(root, 'install.bat')));
  assert.ok(fs.existsSync(path.join(root, 'run.bat')));
});

test('secret files are ignored', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /\.env/);
  assert.match(ignore, /node_modules/);
});
