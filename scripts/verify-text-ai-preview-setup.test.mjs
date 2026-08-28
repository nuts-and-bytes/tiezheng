import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import {
  EXPECTED_FILES,
  verifyTextPreviewSetup,
} from './verify-text-ai-preview-setup.mjs';

const FAILURE = 'Text preview setup policy failed';

async function canonicalSources() {
  return Object.fromEntries(await Promise.all(EXPECTED_FILES.map(async (file) => [
    file,
    await readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
  ])));
}

function fixedFailure(action) {
  assert.throws(action, (error) => error.message === FAILURE && error.cause === undefined);
}

test('accepts only the canonical two-input, 11+1, two-code setup runtime', async () => {
  assert.deepEqual(verifyTextPreviewSetup(await canonicalSources()), {
    setupOnly: true,
    hiddenInputs: 2,
    secrets: 11,
    variables: 1,
    accessCodes: 2,
    cloudflareWrites: 0,
  });
});

test('requires the exact runtime source inventory and plain data properties', async () => {
  const sources = await canonicalSources();
  const missing = { ...sources };
  delete missing['package.json'];
  fixedFailure(() => verifyTextPreviewSetup(missing));
  fixedFailure(() => verifyTextPreviewSetup({ ...sources, extra: 'x\n' }));
  const accessor = { ...sources };
  Object.defineProperty(accessor, 'package.json', { get() { throw new Error('secret-sentinel'); } });
  fixedFailure(() => verifyTextPreviewSetup(accessor));
});

test('source digest lock rejects a one-byte mutation in every runtime file', async () => {
  const sources = await canonicalSources();
  for (const file of EXPECTED_FILES) {
    fixedFailure(() => verifyTextPreviewSetup({
      ...sources,
      [file]: sources[file].replace('\n', ' \n'),
    }));
  }
});

test('forbidden capability gate rejects legacy identity, deployment, enable, and model shapes', async () => {
  const sources = await canonicalSources();
  for (const forbidden of [
    '/access/',
    'TEXT_AI_USER_1_EMAIL',
    'cf-access-client-secret',
    'wrangler deploy',
    'operation=enable-admin-preview',
    'https://ark.cn/model',
  ]) {
    fixedFailure(() => verifyTextPreviewSetup({
      ...sources,
      'scripts/text-ai-preview-setup-cloudflare.mjs': `${sources['scripts/text-ai-preview-setup-cloudflare.mjs'].trimEnd()}\n// ${forbidden}\n`,
    }));
  }
});

test('runtime setup sources contain neither email/Access state nor Cloudflare mutations', async () => {
  const sources = await canonicalSources();
  const runtime = EXPECTED_FILES.filter((file) => file !== 'package.json').map((file) => sources[file]).join('\n');
  for (const forbidden of [
    '/access/',
    'TEAM_DOMAIN',
    '_EMAIL',
    'CF_ACCESS',
    'serviceToken',
    'createServiceToken',
  ]) assert.equal(runtime.includes(forbidden), false, forbidden);
});

test('CLI emits only the canonical fixed report', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-text-ai-preview-setup.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout,
    '{"setupOnly":true,"hiddenInputs":2,"secrets":11,"variables":1,"accessCodes":2,"cloudflareWrites":0}\n');
});
