import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

let testModule;
try {
  testModule = await import('vitest');
} catch {
  testModule = await import('node:test');
}
const { test } = testModule;

import * as setupVerifier from './verify-text-ai-preview-setup.mjs';

const { EXPECTED_FILES, verifyTextPreviewSetup } = setupVerifier;

const FAILURE_MESSAGE = 'Setup policy failed';
const FIXED_FILES = Object.freeze([
  'scripts/text-ai-preview-setup-values.mjs',
  'scripts/text-ai-preview-setup-prompt.mjs',
  'scripts/text-ai-preview-setup-cloudflare.mjs',
  'scripts/text-ai-preview-setup-github.mjs',
  'scripts/text-ai-preview-setup.mjs',
]);
const FIXED_REPORT = Object.freeze({
  fourInputs: true,
  stdinOnlySecrets: true,
  firstRunOnly: true,
  deploymentDisabled: true,
  modelCalls: 0,
});
const VERIFIER_PATH = resolve('scripts/verify-text-ai-preview-setup.mjs');
const sources = Object.freeze(Object.fromEntries(await Promise.all(FIXED_FILES.map(async (file) => (
  [file, await readFile(resolve(file), 'utf8')]
)))));

function sourceRecord() {
  return Object.fromEntries(FIXED_FILES.map((file) => [file, sources[file]]));
}

function replaceOnce(file, before, after) {
  const value = sources[file];
  const first = value.indexOf(before);
  assert.notEqual(first, -1, `fixture is missing mutation anchor: ${before}`);
  assert.equal(
    value.indexOf(before, first + before.length),
    -1,
    `fixture anchor is not unique: ${before}`,
  );
  const mutated = sourceRecord();
  mutated[file] = `${value.slice(0, first)}${after}${value.slice(first + before.length)}`;
  return mutated;
}

function insertAfter(file, marker, insertion) {
  return replaceOnce(file, marker, `${marker}${insertion}`);
}

function expectSemanticPolicyFailure(value) {
  assert.throws(
    () => setupVerifier.verifyTextPreviewSetupSemanticsForTest(value),
    (error) => error?.constructor === Error && error.message === FAILURE_MESSAGE,
  );
}

function expectDigestPolicyFailure(value) {
  assert.throws(
    () => verifyTextPreviewSetup(value),
    (error) => error?.constructor === Error && error.message === FAILURE_MESSAGE,
  );
}

function runVerifier(cwd = resolve('.'), args = []) {
  return spawnSync(process.execPath, [VERIFIER_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
    timeout: 10_000,
  });
}

async function writeCliFixture(root, { omit, extra } = {}) {
  const scriptsDirectory = join(root, 'scripts');
  await mkdir(scriptsDirectory, { recursive: true });
  for (const file of FIXED_FILES) {
    if (file === omit) continue;
    await writeFile(join(scriptsDirectory, basename(file)), sources[file], 'utf8');
  }
  if (extra !== undefined) {
    await writeFile(join(scriptsDirectory, extra), 'export const unexpected = true;\n', 'utf8');
  }
}

test('accepts only the five fixed setup modules and returns the redacted contract', () => {
  assert.deepEqual(EXPECTED_FILES, FIXED_FILES);
  assert.ok(Object.isFrozen(EXPECTED_FILES));
  const report = verifyTextPreviewSetup(sourceRecord());
  assert.deepEqual(report, FIXED_REPORT);
  assert.ok(Object.isFrozen(report));
  assert.equal(JSON.stringify(report), '{"fourInputs":true,"stdinOnlySecrets":true,"firstRunOnly":true,"deploymentDisabled":true,"modelCalls":0}');
  assert.deepEqual(verifyTextPreviewSetup(sourceRecord()), report);
});

test('rejects missing, unknown, accessor, symbolic, inherited, and non-record source maps', () => {
  const missing = sourceRecord();
  delete missing[FIXED_FILES[0]];
  expectSemanticPolicyFailure(missing);

  const extra = sourceRecord();
  extra['scripts/text-ai-preview-setup-extra.mjs'] = 'export {};\n';
  expectSemanticPolicyFailure(extra);

  let getterCalls = 0;
  const accessor = sourceRecord();
  Object.defineProperty(accessor, FIXED_FILES[0], {
    enumerable: true,
    get() {
      getterCalls += 1;
      return sources[FIXED_FILES[0]];
    },
  });
  expectSemanticPolicyFailure(accessor);
  assert.equal(getterCalls, 0);

  const symbolic = sourceRecord();
  symbolic[Symbol('extra')] = 'hidden';
  expectSemanticPolicyFailure(symbolic);

  const inherited = Object.assign(Object.create({ unexpected: true }), sourceRecord());
  expectSemanticPolicyFailure(inherited);

  for (const value of [null, [], new Map(), 'sources', 1]) expectSemanticPolicyFailure(value);
});

test('rejects source type, encoding, size, proxy, and digest drift with one fixed error', () => {
  for (const badSource of [Buffer.from('source'), 42, '', 'export {};\0\n', 'export {};\r\n']) {
    const mutated = sourceRecord();
    mutated[FIXED_FILES[0]] = badSource;
    expectSemanticPolicyFailure(mutated);
  }

  const proxy = new Proxy(sourceRecord(), {
    ownKeys() {
      throw new Error('secret detail');
    },
  });
  expectSemanticPolicyFailure(proxy);

  for (const file of FIXED_FILES) {
    const mutated = sourceRecord();
    mutated[file] = `${mutated[file]}// harmless-looking digest drift\n`;
    assert.deepEqual(
      setupVerifier.verifyTextPreviewSetupSemanticsForTest(mutated),
      FIXED_REPORT,
    );
    expectDigestPolicyFailure(mutated);
  }
});

test('locks the four setup inputs, hidden flags, and separate lowercase confirmation', () => {
  const file = 'scripts/text-ai-preview-setup-prompt.mjs';
  for (const [before, after] of [
    ["      ['Cloudflare API Token', true],\n", "      ['Cloudflare token', true],\n"],
    ["      ['ARK_API_KEY', true],\n", "      ['ARK key', true],\n"],
    ["      ['user-1 email', false],\n", "      ['admin email', false],\n"],
    ["      ['user-2 email', false],\n", "      ['backup email', false],\n"],
    ["      ['Cloudflare API Token', true],\n", "      ['Cloudflare API Token', false],\n"],
    ["      ['user-1 email', false],\n", "      ['user-1 email', true],\n"],
    ["    label: 'Continue? [y/N]',\n", "    label: 'Proceed? [y/N]',\n"],
    ["return answer.toString('utf8') === 'y';", "return answer.toString('utf8') === 'Y';"],
  ]) {
    expectSemanticPolicyFailure(replaceOnce(file, before, after));
  }
  expectSemanticPolicyFailure(replaceOnce(
    file,
    "      ['user-2 email', false],\n",
    "      ['user-2 email', false],\n      ['user-3 email', false],\n",
  ));
});

test('locks all nine secret names and the two environment variable names', () => {
  const file = 'scripts/text-ai-preview-setup-values.mjs';
  const secretNames = [
    'CLOUDFLARE_API_TOKEN',
    'ARK_API_KEY',
    'PHOTO_AI_CACHE_AES_KEY',
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
    'TEXT_AI_USER_1_EMAIL',
    'TEXT_AI_USER_2_EMAIL',
    'TEXT_AI_ADMIN_EMAIL',
    'TEXT_AI_CF_ACCESS_CLIENT_ID',
    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
  ];
  for (const name of secretNames) {
    expectSemanticPolicyFailure(replaceOnce(file, `    '${name}',\n`, `    '${name}_DRIFT',\n`));
  }
  expectSemanticPolicyFailure(replaceOnce(
    file,
    "    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',\n",
    "    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',\n    'UNAPPROVED_SECRET',\n",
  ));
  expectSemanticPolicyFailure(replaceOnce(
    file,
    "  variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN']),",
    "  variableNames: Object.freeze(['TEXT_AI_TEAM_DOMAIN', 'CLOUDFLARE_ACCOUNT_ID']),",
  ));
  expectSemanticPolicyFailure(replaceOnce(
    file,
    "  variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN']),",
    "  variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN', 'EXTRA']),",
  ));
});

test('pins the unique Cloudflare service token name and 8760 hour duration', () => {
  const file = 'scripts/text-ai-preview-setup-values.mjs';
  expectSemanticPolicyFailure(replaceOnce(
    file,
    "  serviceTokenName: 'tiezheng-text-ai-preview-github-actions',",
    "  serviceTokenName: 'tiezheng-text-ai-preview-admin',",
  ));
  expectSemanticPolicyFailure(replaceOnce(
    file,
    "  serviceTokenDuration: '8760h',",
    "  serviceTokenDuration: 'forever',",
  ));
  expectSemanticPolicyFailure(replaceOnce(
    'scripts/text-ai-preview-setup-cloudflare.mjs',
    '    duration: SETUP_POLICY.serviceTokenDuration,',
    "    duration: '8760h',",
  ));
});

test('requires shell false and single-item stdin for every secret or variable write', () => {
  const file = 'scripts/text-ai-preview-setup-github.mjs';
  for (const [before, after] of [
    ['          shell: false,', '          shell: true,'],
    [
      "    const args = ['secret', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];",
      "    const args = ['secret', 'set', name, '--body', value, '--env', ENVIRONMENT, '--repo', REPO];",
    ],
    ["      await run('gh', args, { input: value });", "      await run('gh', args);"],
    ['          else child.stdin.end(safeInput);', '          else child.stdin.end();'],
  ]) {
    expectSemanticPolicyFailure(replaceOnce(file, before, after));
  }
});

test('requires a clean first-run environment and cannot overwrite existing values', () => {
  const file = 'scripts/text-ai-preview-setup-github.mjs';
  for (const [before, after] of [
    ['      if (secretNames.size !== 0) fail();', '      if (secretNames.size > 1) fail();'],
    ['      exactNames(variableNames, [ACCOUNT_VARIABLE]);', '      if (!variableNames.has(ACCOUNT_VARIABLE)) fail();'],
    ["const WRITABLE_VARIABLE_NAMES = Object.freeze(['TEXT_AI_TEAM_DOMAIN']);", "const WRITABLE_VARIABLE_NAMES = Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN']);"],
  ]) {
    expectSemanticPolicyFailure(replaceOnce(file, before, after));
  }
});

test('locks disabled preflight dispatch, approved SHA binding, and the exact false report', () => {
  const file = 'scripts/text-ai-preview-setup-github.mjs';
  for (const [before, after] of [
    ["        '-f', 'operation=preflight',", "        '-f', 'operation=deploy-disabled',"],
    ["        '-f', 'target=user-1',", "        '-f', 'target=user-2',"],
    ['        \'-f\', `expected_sha=${expectedSha}`,', '        \'-f\', `sha=${expectedSha}`,'],
    ['workerTextEnabled":false', 'workerTextEnabled":true'],
  ]) {
    expectSemanticPolicyFailure(replaceOnce(file, before, after));
  }
  expectSemanticPolicyFailure(replaceOnce(
    'scripts/text-ai-preview-setup.mjs',
    'workerTextEnabled=false photoEnabled=false',
    'workerTextEnabled=true photoEnabled=false',
  ));
});

test('locks the fixed COMPLETE, failure, cancellation, and BLOCKED output vocabulary', () => {
  const file = 'scripts/text-ai-preview-setup.mjs';
  for (const [before, after] of [
    ["const FAILED_OUTPUT = 'SETUP FAILED\\n';", "const FAILED_OUTPUT = 'FAILED\\n';"],
    ["const CANCELLED_OUTPUT = 'SETUP CANCELLED\\n';", "const CANCELLED_OUTPUT = 'CANCELLED\\n';"],
    ["const PREFLIGHT_BLOCKED_OUTPUT = 'SETUP BLOCKED preflight\\n';", "const PREFLIGHT_BLOCKED_OUTPUT = 'SETUP FAILED preflight\\n';"],
    ["const REPORT_BLOCKED_OUTPUT = 'SETUP BLOCKED output\\n';", "const REPORT_BLOCKED_OUTPUT = 'SETUP FAILED output\\n';"],
    ["const SUCCESS_OUTPUT = 'SETUP COMPLETE\\n", "const SUCCESS_OUTPUT = 'SETUP READY\\n"],
    ["`SETUP BLOCKED cleanup=${blocked.join(',')}\\n`", "`SETUP FAILED cleanup=${blocked.join(',')}\\n`"],
  ]) {
    expectSemanticPolicyFailure(replaceOnce(file, before, after));
  }
});

test('rejects every forbidden deployment, enablement, model, disclosure, and persistence insertion', () => {
  const file = 'scripts/text-ai-preview-setup-values.mjs';
  const marker = "import { randomBytes } from 'node:crypto';\n";
  for (const insertion of [
    'wrangler deploy',
    'wrangler pages deploy',
    'pages deploy',
    'deploy-disabled',
    'enable-admin-preview',
    'enable-account',
    '/api/nutrition/text/session',
    '/api/nutrition/text/estimate',
    'console.log(secret)',
    'process.env.ARK_API_KEY',
    'process.env.CLOUDFLARE_API_TOKEN',
    'writeFile',
    'createWriteStream',
    'exec(',
    'eval(',
    'curl https://example.invalid',
    'wget https://example.invalid',
  ]) {
    expectSemanticPolicyFailure(insertAfter(file, marker, `const mutation = ${JSON.stringify(insertion)};\n`));
  }
});

test('rejects additional executable families outside the fixed git and gh runner', () => {
  const file = 'scripts/text-ai-preview-setup-github.mjs';
  const marker = "import { spawn } from 'node:child_process';\n";
  for (const command of [
    'python3 -c pass',
    'ruby -e exit',
    'perl -e exit',
    'bash -c true',
    'zsh -c true',
    'npm exec arbitrary-package',
    'npx arbitrary-package',
    'node -e process.exit(0)',
  ]) {
    expectSemanticPolicyFailure(insertAfter(file, marker, `const executableMutation = ${JSON.stringify(command)};\n`));
  }
});

test('semantic gate independently rejects extra spawn calls, aliases, and child process families', () => {
  assert.equal(typeof setupVerifier.verifyTextPreviewSetupSemanticsForTest, 'function');
  assert.deepEqual(
    setupVerifier.verifyTextPreviewSetupSemanticsForTest(sourceRecord()),
    FIXED_REPORT,
  );
  const file = 'scripts/text-ai-preview-setup-github.mjs';
  const marker = "import { spawn } from 'node:child_process';\n";
  for (const insertion of [
    "spawn('sh', ['-c', 'true']);\n",
    "const launch = spawn;\nlaunch('sh', ['-c', 'true']);\n",
    "import { execFile as launch } from 'node:child_process';\n",
  ]) {
    assert.throws(
      () => setupVerifier.verifyTextPreviewSetupSemanticsForTest(
        insertAfter(file, marker, insertion),
      ),
      (error) => error?.constructor === Error && error.message === FAILURE_MESSAGE,
    );
  }
  for (const [before, after] of [
    [
      'function createBoundedCommandRunner(spawnCommand) {',
      'function createUnsafeRunner(spawnCommand) {',
    ],
    [
      "  if (typeof spawnCommand !== 'function') fail();",
      "  spawnCommand('sh', ['-c', 'true']);",
    ],
    [
      'const child = Reflect.apply(spawnCommand, undefined, [command, safeArguments, {',
      'const child = spawnCommand(command, safeArguments, {',
    ],
    [
      'export function createBoundedCommandRunnerForTest(spawnCommand) {',
      'export function exposeUnsafeRunnerForTest(spawnCommand) {',
    ],
    [
      '  return createBoundedCommandRunner(spawnCommand);',
      '  return createUnsafeRunner(spawnCommand);',
    ],
  ]) {
    expectSemanticPolicyFailure(replaceOnce(file, before, after));
  }
});

test('semantic gate rejects indirect arguments calls and Unicode-escaped spawn identifiers', () => {
  const file = 'scripts/text-ai-preview-setup-github.mjs';
  const marker = "      if (command !== 'git' && command !== 'gh') fail();\n";
  for (const insertion of [
    "      arguments[0]('sh', ['-c', 'true']);\n",
    String.raw`      sp\u0061wn('sh', ['-c', 'true']);
`,
  ]) {
    expectSemanticPolicyFailure(insertAfter(file, marker, insertion));
  }
});

test('semantic gate keeps the spawned command and arguments bound to the guarded snapshots', () => {
  const file = 'scripts/text-ai-preview-setup-github.mjs';
  expectSemanticPolicyFailure(insertAfter(
    file,
    "      if (command !== 'git' && command !== 'gh') fail();\n",
    "      command = 'sh';\n",
  ));
  expectSemanticPolicyFailure(insertAfter(
    file,
    '      return await new Promise((resolve, reject) => {\n',
    "        const command = 'sh';\n        const safeArguments = ['-c', 'true'];\n",
  ));
});

test('semantic gate binds Reflect.apply to the unshadowed intrinsic', () => {
  expectSemanticPolicyFailure(insertAfter(
    'scripts/text-ai-preview-setup-github.mjs',
    '      return await new Promise((resolve, reject) => {\n',
    `        const Reflect = {
          apply(target) {
            return target('sh', ['-c', 'true'], {
              shell: false,
              stdio: ['pipe', 'pipe', 'pipe'],
              env: {},
            });
          },
        };
`,
  ));
});

test('semantic gate rejects GitHub adapter parse diagnostics', () => {
  expectSemanticPolicyFailure(insertAfter(
    'scripts/text-ai-preview-setup-github.mjs',
    "import { spawn } from 'node:child_process';\n",
    'function malformed( {\n',
  ));
});

test('package scripts expose one safe setup entrypoint and include every setup test in control', async () => {
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  assert.equal(packageJson.scripts['setup:text-preview'], 'node scripts/text-ai-preview-setup.mjs');
  assert.equal(
    packageJson.scripts['test:text-preview-setup'],
    'node --test scripts/text-ai-preview-setup*.test.mjs scripts/verify-text-ai-preview-setup.test.mjs',
  );
  assert.equal(
    packageJson.scripts['verify:text-preview-setup'],
    'node scripts/verify-text-ai-preview-setup.mjs',
  );
  assert.equal(
    packageJson.scripts['test:text-preview-control'],
    'node --test scripts/cloudflare-api.test.mjs scripts/text-ai-preview-control.test.mjs scripts/verify-text-ai-preview-workflow.test.mjs scripts/text-ai-preview-setup*.test.mjs scripts/verify-text-ai-preview-setup.test.mjs',
  );
});

test('CLI accepts no arguments and prints only the fixed one-line JSON report', () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    '{"fourInputs":true,"stdinOnlySecrets":true,"firstRunOnly":true,"deploymentDisabled":true,"modelCalls":0}\n',
  );

  const rejected = runVerifier(resolve('.'), ['unexpected']);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.equal(rejected.stderr, `${FAILURE_MESSAGE}\n`);
});

test('CLI discovers and rejects an unknown production setup source before verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tiezheng-setup-verifier-'));
  try {
    await writeCliFixture(root, { extra: 'text-ai-preview-setup-extra.mjs' });
    const result = runVerifier(root);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `${FAILURE_MESSAGE}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI treats every non-test text-ai-preview-setup wildcard match as production', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tiezheng-setup-verifier-wildcard-'));
  try {
    await writeCliFixture(root, { extra: 'text-ai-preview-setup.injected.mjs' });
    const result = runVerifier(root);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `${FAILURE_MESSAGE}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI rejects unknown setup-prefixed sources across extensions and unknown test names', async () => {
  for (const extra of [
    'text-ai-preview-setup-extra.js',
    'text-ai-preview-setup-extra.cjs',
    'text-ai-preview-setup-extra.test.mjs',
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'tiezheng-setup-verifier-extension-'));
    try {
      await writeCliFixture(root, { extra });
      const result = runVerifier(root);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `${FAILURE_MESSAGE}\n`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('CLI rejects a missing fixed source but ignores test-only setup filenames', async () => {
  const missingRoot = await mkdtemp(join(tmpdir(), 'tiezheng-setup-verifier-missing-'));
  const passingRoot = await mkdtemp(join(tmpdir(), 'tiezheng-setup-verifier-test-file-'));
  try {
    await writeCliFixture(missingRoot, { omit: FIXED_FILES[0] });
    const missingResult = runVerifier(missingRoot);
    assert.equal(missingResult.status, 1);
    assert.equal(missingResult.stdout, '');
    assert.equal(missingResult.stderr, `${FAILURE_MESSAGE}\n`);

    await writeCliFixture(passingRoot, { extra: 'text-ai-preview-setup-values.test.mjs' });
    const passingResult = runVerifier(passingRoot);
    assert.equal(passingResult.status, 0, passingResult.stderr);
    assert.equal(passingResult.stderr, '');
    assert.equal(
      passingResult.stdout,
      '{"fourInputs":true,"stdinOnlySecrets":true,"firstRunOnly":true,"deploymentDisabled":true,"modelCalls":0}\n',
    );
  } finally {
    await rm(missingRoot, { recursive: true, force: true });
    await rm(passingRoot, { recursive: true, force: true });
  }
});
