import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { SETUP_POLICY } from './text-ai-preview-setup-values.mjs';
import {
  createBoundedCommandRunnerForTest,
  createGitHubSetupClient,
} from './text-ai-preview-setup-github.mjs';

const FAILURE = 'Text preview setup failed';
const SHA = 'a'.repeat(40);
const ACCOUNT_ID = 'b'.repeat(32);

function environmentJson() {
  return JSON.stringify({
    name: 'text-ai-preview',
    protection_rules: [],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  });
}

function policyJson() {
  return JSON.stringify([{ total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] }]);
}

function namesJson(names) {
  return JSON.stringify(names.map((name) => ({ name })));
}

function runMetadata() {
  return JSON.stringify({
    event: 'workflow_dispatch',
    headBranch: 'main',
    headSha: SHA,
    status: 'completed',
    conclusion: 'success',
    workflowName: 'Text AI Preview Control',
    jobs: [{
      databaseId: 88,
      name: 'text-ai-preview',
      conclusion: 'success',
      steps: [{ name: 'Dispatch fixed operation', conclusion: 'success' }],
    }],
  });
}

function fakeRunner({ secretNames = [], activeRuns = [] } = {}) {
  const calls = [];
  const runner = async (command, args, options = {}) => {
    const joined = `${command} ${args.join(' ')}`;
    calls.push({
      command,
      args: [...args],
      input: Buffer.isBuffer(options.input) ? options.input.toString('utf8') : undefined,
      timeoutMs: options.timeoutMs,
    });
    let stdout;
    if (joined === 'gh auth status --hostname github.com') stdout = '';
    else if (joined === 'git status --porcelain=v1') stdout = '';
    else if (joined === 'git branch --show-current') stdout = 'main\n';
    else if (joined === 'git remote get-url --push origin') stdout = 'https://github.com/nuts-and-bytes/tiezheng.git\n';
    else if (joined === 'git rev-parse HEAD') stdout = `${SHA}\n`;
    else if (joined.includes('repos/nuts-and-bytes/tiezheng/git/ref/heads/main')) stdout = `${SHA}\n`;
    else if (joined.endsWith('repos/nuts-and-bytes/tiezheng/environments/text-ai-preview')) stdout = environmentJson();
    else if (joined.includes('deployment-branch-policies')) stdout = policyJson();
    else if (joined.startsWith('gh secret list')) stdout = namesJson(secretNames);
    else if (joined.startsWith('gh variable list')) stdout = namesJson(['CLOUDFLARE_ACCOUNT_ID']);
    else if (joined.startsWith('gh variable get CLOUDFLARE_ACCOUNT_ID')) stdout = `${ACCOUNT_ID}\n`;
    else if (joined.startsWith('gh secret set ')) stdout = '';
    else if (joined.startsWith('gh secret delete ')) stdout = '';
    else if (joined.startsWith('gh run list ')) stdout = JSON.stringify(activeRuns);
    else if (joined.startsWith('gh workflow run text-ai-preview.yml ')) stdout = 'https://github.com/nuts-and-bytes/tiezheng/actions/runs/123\n';
    else if (joined.startsWith('gh run watch 123 ')) stdout = '';
    else if (joined.includes('gh run view 123') && joined.includes('--json')) stdout = runMetadata();
    else if (joined.includes('gh run view 123') && joined.includes('--log')) {
      stdout = `2026-01-01\tDispatch fixed operation\t{\"command\":\"preflight\",\"status\":\"ready\",\"workerTextEnabled\":false}\n`;
    } else throw new Error(`unexpected secret-sentinel: ${joined}`);
    return { code: 0, stdout, stderr: '' };
  };
  return { runner, calls };
}

test('first-run inspection requires a clean pinned main and an empty secret inventory', async () => {
  const fixture = fakeRunner();
  const client = createGitHubSetupClient(fixture.runner);
  assert.deepEqual(await client.inspectFirstRun(), { accountId: ACCOUNT_ID, expectedSha: SHA });
  assert.equal(
    fixture.calls.some(({ args }) => args.some((value) => value.includes('deployment-branch-policies'))),
    true,
  );

  const existing = fakeRunner({ secretNames: SETUP_POLICY.secretNames });
  await assert.rejects(
    createGitHubSetupClient(existing.runner).inspectFirstRun(),
    { message: FAILURE },
  );
});

test('rotation inspection requires the exact configured 11+1 inventory', async () => {
  const fixture = fakeRunner({ secretNames: SETUP_POLICY.secretNames });
  const client = createGitHubSetupClient(fixture.runner);
  assert.deepEqual(await client.inspectRotation(), { accountId: ACCOUNT_ID, expectedSha: SHA });

  const missing = fakeRunner({ secretNames: SETUP_POLICY.secretNames.slice(1) });
  await assert.rejects(
    createGitHubSetupClient(missing.runner).inspectRotation(),
    { message: FAILURE },
  );
});

test('secret writes use bounded stdin, never arguments, and wipe the caller buffer', async () => {
  const fixture = fakeRunner();
  const client = createGitHubSetupClient(fixture.runner);
  const value = Buffer.from('private-secret-value');
  await client.setSecret('ARK_API_KEY', value);
  const call = fixture.calls.at(-1);
  assert.deepEqual(call.args, [
    'secret', 'set', 'ARK_API_KEY', '--env', 'text-ai-preview', '--repo', 'nuts-and-bytes/tiezheng',
  ]);
  assert.equal(call.input, 'private-secret-value');
  assert.equal(call.args.join(' ').includes('private-secret-value'), false);
  assert.equal(value.every((byte) => byte === 0), true);
  await assert.rejects(client.setSecret('TEXT_AI_USER_1_EMAIL', Buffer.from('nope')), { message: FAILURE });
});

test('name verification checks exactly 11 secrets and the existing account variable', async () => {
  const fixture = fakeRunner({ secretNames: SETUP_POLICY.secretNames });
  await createGitHubSetupClient(fixture.runner).verifyNames();
  const extra = fakeRunner({ secretNames: [...SETUP_POLICY.secretNames, 'EXTRA'] });
  await assert.rejects(createGitHubSetupClient(extra.runner).verifyNames(), { message: FAILURE });
});

test('disabled preflight dispatch is exact and binds the unique successful run/job/step', async () => {
  const fixture = fakeRunner({ secretNames: SETUP_POLICY.secretNames });
  await createGitHubSetupClient(fixture.runner).runDisabledPreflight(SHA);
  const dispatch = fixture.calls.find(({ args }) => args[0] === 'workflow');
  assert.deepEqual(dispatch.args, [
    'workflow', 'run', 'text-ai-preview.yml',
    '--ref', 'main',
    '--repo', 'nuts-and-bytes/tiezheng',
    '-f', 'operation=preflight',
    '-f', 'target=user-1',
    '-f', `expected_sha=${SHA}`,
    '-f', 'confirmation=',
  ]);
});

test('access-code rotation dispatch is exact and never fetches logs or secrets', async () => {
  const fixture = fakeRunner({ secretNames: SETUP_POLICY.secretNames });
  await createGitHubSetupClient(fixture.runner).runAccessCodeRotation('user-2', SHA);
  const dispatch = fixture.calls.find(({ args }) => args[0] === 'workflow');
  assert.deepEqual(dispatch.args.slice(-8), [
    '-f', 'operation=rotate-user-code',
    '-f', 'target=user-2',
    '-f', `expected_sha=${SHA}`,
    '-f', 'confirmation=ROTATE_ONE_TEXT_ACCESS_CODE',
  ]);
  assert.equal(fixture.calls.some(({ args }) => args.includes('--log')), false);
});

test('bounded process runner permits only git/gh and forces shell=false with a tiny environment', async () => {
  const invocations = [];
  const spawn = (command, args, options) => {
    invocations.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => queueMicrotask(() => child.emit('close', 0));
    child.kill = () => true;
    return child;
  };
  const run = createBoundedCommandRunnerForTest(spawn);
  assert.deepEqual(await run('gh', ['auth', 'status']), { code: 0, stdout: '', stderr: '' });
  assert.equal(invocations[0].options.shell, false);
  assert.deepEqual(invocations[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  await assert.rejects(run('curl', ['https://example.com']), { message: FAILURE });
});
