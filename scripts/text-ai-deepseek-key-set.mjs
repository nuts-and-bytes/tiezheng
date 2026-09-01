import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createGitHubSetupClient } from './text-ai-preview-setup-github.mjs';
import { readTtyLine } from './text-ai-preview-setup-prompt.mjs';

const SECRET_NAME = 'DEEPSEEK_API_KEY';
const SUCCESS = 'DEEPSEEK KEY SAVED\n';
const FAILURE = 'DEEPSEEK KEY SETUP FAILED\n';

function validKey(value) {
  return Buffer.isBuffer(value)
    && value.byteLength >= 1
    && value.byteLength <= 4096
    && value.every((byte) => byte >= 0x21 && byte <= 0x7e);
}

async function write(stream, value) {
  if (stream === null || (typeof stream !== 'object' && typeof stream !== 'function')) {
    throw new TypeError('Invalid output');
  }
  const method = stream.write;
  if (typeof method !== 'function') throw new TypeError('Invalid output');
  await method.call(stream, value);
}

export async function runDeepSeekKeySetup(dependencies) {
  let key = null;
  try {
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new TypeError('Invalid dependencies');
    }
    const { promptKey, github, stdout, stderr } = dependencies;
    if (typeof promptKey !== 'function'
      || github === null || typeof github !== 'object'
      || typeof github.setSecret !== 'function') {
      throw new TypeError('Invalid dependencies');
    }
    key = await promptKey();
    if (!validKey(key)) throw new TypeError('Invalid key');
    await github.setSecret(SECRET_NAME, key);
    await write(stdout, SUCCESS);
    return 0;
  } catch {
    try {
      await write(dependencies?.stderr, FAILURE);
    } catch {
      // The fixed exit status remains authoritative if reporting fails.
    }
    return 1;
  } finally {
    if (Buffer.isBuffer(key)) key.fill(0);
  }
}

export async function runDeepSeekKeySetupCli(argv, io = process, overrides = {}) {
  const stderr = io?.stderr;
  try {
    if (!Array.isArray(argv)
      || argv.length !== 0
      || io?.stdin?.isTTY !== true
      || io?.stdout?.isTTY !== true
      || overrides === null
      || typeof overrides !== 'object'
      || Array.isArray(overrides)) {
      throw new TypeError('Invalid invocation');
    }
    const promptKey = overrides.promptKey ?? (() => readTtyLine({
      input: io.stdin,
      output: io.stdout,
      label: SECRET_NAME,
      hidden: true,
    }));
    const github = overrides.github ?? createGitHubSetupClient();
    return await runDeepSeekKeySetup({ promptKey, github, stdout: io.stdout, stderr });
  } catch {
    try {
      await write(stderr, FAILURE);
    } catch {
      // Exit status is enough when stderr itself is unavailable.
    }
    return 1;
  }
}

if (
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runDeepSeekKeySetupCli(process.argv.slice(2));
}
