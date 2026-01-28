#!/usr/bin/env node
import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(express.json());
const PORT = 4000;

const tools = [
  {
    name: 'readFile',
    description: 'Reads the entire content of a file from the local system.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The name of the file to read.' },
      },
      required: ['filename'],
    },
  },
  {
    name: 'writeFile',
    description: 'Writes content to a file, creating it or overwriting existing content.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The name of the file to write to.' },
        content: { type: 'string', description: 'The content to write to the file.' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'appendFile',
    description: 'Appends content to the end of a file, creating it if it does not exist.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The name of the file to append to.' },
        content: { type: 'string', description: 'The content to append.' },
      },
      required: ['filename', 'content'],
    },
  },
];

app.get('/tools', (req, res) => {
  res.json({ tools });
});

app.post('/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  const { arguments: args } = req.body;

  if (args && args[0] && (args[0].includes('..') || path.isAbsolute(args[0]))) {
    return res.status(400).json({ error: 'Invalid file path. Only relative paths are allowed.' });
  }

  try {
    let result;
    switch (toolName) {
      case 'readFile':
        result = { output: await fs.readFile(args[0], 'utf8') };
        break;
      case 'writeFile':
        await fs.writeFile(args[0], args.slice(1).join(' '));
        result = { output: `Successfully wrote to ${args[0]}` };
        break;
      case 'appendFile':
        await fs.appendFile(args[0], '\n' + args.slice(1).join(' '));
        result = { output: `Successfully appended to ${args[0]}` };
        break;
      default:
        return res.status(404).json({ error: 'Tool not found' });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`MCP File Server listening on http://localhost:${PORT}`);
});