import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { SETUP_POLICY } from './text-ai-preview-setup-values.mjs';
import { createGitHubSetupClient } from './text-ai-preview-setup-github.mjs';

const FAILURE = 'Text preview setup failed';
const SHA = 'b'.repeat(40);
const ACCOUNT_ID = 'a'.repeat(32);
const REPO = 'nuts-and-bytes/tiezheng';
const ENVIRONMENT = 'text-ai-preview';
const WORKFLOW = 'text-ai-preview.yml';
const RUN_ID = '123456789';
const RUN_URL = `https://github.com/${REPO}/actions/runs/${RUN_ID}`;
const REPORT = '{"command":"preflight","status":"ready","workerTextEnabled":false}';

function result(stdout = '', overrides = {}) {
  return { code: 0, stdout, stderr: '', ...overrides };
}

function fakeRunner(responses) {
  const calls = [];
  let index = 0;
  const runner = async (command, args, options = {}) => {
    const call = { command, args: [...args] };
    if (Object.hasOwn(options, 'input')) call.input = Buffer.from(options.input);
    if (Object.hasOwn(options, 'timeoutMs')) call.timeoutMs = options.timeoutMs;
    calls.push(call);
    const response = responses[index];
    index += 1;
    if (typeof response === 'function') return response({ command, args, options, calls });
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error(`unexpected fake command ${command} ${args.join(' ')}`);
    return response;
  };
  runner.calls = calls;
  return runner;
}

function environment(overrides = {}) {
  return JSON.stringify({
    name: ENVIRONMENT,
    protection_rules: [],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
    ...overrides,
  });
}

function policies(items = [{ name: 'main', type: 'branch' }]) {
  return JSON.stringify([{ total_count: items.length, branch_policies: items }]);
}

function names(items) {
  return JSON.stringify(items.map((name) => ({ name })));
}

function inspectionResponses(overrides = {}) {
  const values = [
    result('', { stderr: 'authenticated account metadata' }),
    result(''),
    result('main\n'),
    result('https://github.com/nuts-and-bytes/tiezheng.git\n'),
    result(`${SHA}\n`),
    result(`${SHA}\n`),
    result(environment()),
    result(policies()),
    result('[]'),
    result(names(['CLOUDFLARE_ACCOUNT_ID'])),
    result(`${ACCOUNT_ID}\n`),
  ];
  for (const [key, value] of Object.entries(overrides)) values[Number(key)] = value;
  return values;
}

function runMetadata(overrides = {}) {
  return JSON.stringify({
    event: 'workflow_dispatch',
    headBranch: 'main',
    headSha: SHA,
    status: 'completed',
    conclusion: 'success',
    workflowName: 'Text AI Preview Control',
    jobs: [{
      databaseId: 987654321,
      name: 'text-ai-preview',
      conclusion: 'success',
      steps: [{ name: 'Dispatch fixed operation', conclusion: 'success' }],
    }],
    ...overrides,
  });
}

function preflightResponses(overrides = {}) {
  const values = [
    result('[]'),
    result('[]'),
    result('[]'),
    result('[]'),
    result(`${RUN_URL}\n`),
    result(''),
    result(runMetadata()),
    result(`text-ai-preview\tDispatch fixed operation\t${REPORT}\n`),
  ];
  for (const [key, value] of Object.entries(overrides)) values[Number(key)] = value;
  return values;
}

async function assertFailure(action, forbidden = []) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.constructor, Error);
    assert.equal(error.message, FAILURE);
    for (const value of forbidden) assert.equal(error.message.includes(value), false);
    return true;
  });
}

function isMutation(call) {
  return call.command === 'gh'
    && (call.args[0] === 'workflow' || ['set', 'delete'].includes(call.args[1]));
}

test('client is frozen and exposes only the seven setup operations', () => {
  const github = createGitHubSetupClient(async () => result());
  assert.equal(Object.isFrozen(github), true);
  assert.deepEqual(Object.keys(github), [
    'inspectFirstRun',
    'setSecret',
    'setVariable',
    'deleteSecret',
    'deleteVariable',
    'verifyNames',
    'runDisabledPreflight',
  ]);
});

test('writes values only through stdin with fixed repo and environment argv and clears originals', async () => {
  const secretRunner = fakeRunner([result()]);
  const secret = Buffer.from('secret-sentinel');
  secret.fill = () => { throw new Error('instance fill must not be used'); };
  await createGitHubSetupClient(secretRunner).setSecret('ARK_API_KEY', secret);
  assert.deepEqual(secretRunner.calls[0], {
    command: 'gh',
    args: ['secret', 'set', 'ARK_API_KEY', '--env', ENVIRONMENT, '--repo', REPO],
    input: Buffer.from('secret-sentinel'),
  });
  assert.equal(secretRunner.calls[0].args.join(' ').includes('secret-sentinel'), false);
  assert.ok(secret.every((byte) => byte === 0));

  const variableRunner = fakeRunner([new Error('variable-value-sentinel')]);
  const variable = Buffer.from('team-slug');
  await assertFailure(
    () => createGitHubSetupClient(variableRunner).setVariable('TEXT_AI_TEAM_DOMAIN', variable),
    ['variable-value-sentinel', 'team-slug'],
  );
  assert.deepEqual(variableRunner.calls[0], {
    command: 'gh',
    args: ['variable', 'set', 'TEXT_AI_TEAM_DOMAIN', '--env', ENVIRONMENT, '--repo', REPO],
    input: Buffer.from('team-slug'),
  });
  assert.ok(variable.every((byte) => byte === 0));
});

test('write validation fails closed, wipes a valid buffer, and never invokes the runner', async () => {
  for (const [method, name] of [
    ['setSecret', 'UNAPPROVED_SECRET'],
    ['setVariable', 'UNAPPROVED_VARIABLE'],
  ]) {
    const runner = fakeRunner([]);
    const value = Buffer.from('wipe-on-validation-failure');
    await assertFailure(() => createGitHubSetupClient(runner)[method](name, value));
    assert.equal(runner.calls.length, 0);
    assert.ok(value.every((byte) => byte === 0));
  }
  const runner = fakeRunner([]);
  await assertFailure(() => createGitHubSetupClient(runner).setSecret('ARK_API_KEY', 'not-a-buffer'));
  assert.equal(runner.calls.length, 0);
});

test('delete operations use exact fixed-name argv and no stdin', async () => {
  const runner = fakeRunner([result(), result()]);
  const github = createGitHubSetupClient(runner);
  await github.deleteSecret('ARK_API_KEY');
  await github.deleteVariable('TEXT_AI_TEAM_DOMAIN');
  assert.deepEqual(runner.calls, [
    {
      command: 'gh',
      args: ['secret', 'delete', 'ARK_API_KEY', '--env', ENVIRONMENT, '--repo', REPO],
    },
    {
      command: 'gh',
      args: ['variable', 'delete', 'TEXT_AI_TEAM_DOMAIN', '--env', ENVIRONMENT, '--repo', REPO],
    },
  ]);
});

test('read-only inspection requires clean protected main and empty setup targets', async () => {
  const runner = fakeRunner(inspectionResponses());
  const github = createGitHubSetupClient(runner);
  const inspected = await github.inspectFirstRun();
  assert.deepEqual(inspected, { accountId: ACCOUNT_ID, expectedSha: SHA });
  assert.equal(Object.isFrozen(inspected), true);
  assert.deepEqual(runner.calls, [
    { command: 'gh', args: ['auth', 'status', '--hostname', 'github.com'] },
    { command: 'git', args: ['status', '--porcelain=v1'] },
    { command: 'git', args: ['branch', '--show-current'] },
    { command: 'git', args: ['remote', 'get-url', '--push', 'origin'] },
    { command: 'git', args: ['rev-parse', 'HEAD'] },
    { command: 'gh', args: ['api', `repos/${REPO}/git/ref/heads/main`, '--jq', '.object.sha'] },
    { command: 'gh', args: ['api', `repos/${REPO}/environments/${ENVIRONMENT}`] },
    { command: 'gh', args: ['api', '--paginate', '--slurp', `repos/${REPO}/environments/${ENVIRONMENT}/deployment-branch-policies`] },
    { command: 'gh', args: ['secret', 'list', '--repo', REPO, '--env', ENVIRONMENT, '--json', 'name'] },
    { command: 'gh', args: ['variable', 'list', '--repo', REPO, '--env', ENVIRONMENT, '--json', 'name'] },
    { command: 'gh', args: ['variable', 'get', 'CLOUDFLARE_ACCOUNT_ID', '--repo', REPO, '--env', ENVIRONMENT] },
  ]);
  assert.equal(runner.calls.some(isMutation), false);
});

test('inspection also accepts only the fixed SSH origin', async () => {
  const runner = fakeRunner(inspectionResponses({
    3: result('git@github.com:nuts-and-bytes/tiezheng.git\n'),
  }));
  await assert.doesNotReject(createGitHubSetupClient(runner).inspectFirstRun());
});

test('inspection failure matrix stops before any mutation and sanitizes output', async (t) => {
  const sentinel = 'inspection-private-sentinel';
  const cases = [
    ['dirty tree', 1, result(' M private-file\n')],
    ['wrong branch', 2, result('feature/private\n')],
    ['wrong origin', 3, result('https://github.com/private/fork.git\n')],
    ['local SHA mismatch', 4, result(`${'c'.repeat(40)}\n`)],
    ['remote SHA mismatch', 5, result(`${'c'.repeat(40)}\n`)],
    ['reviewer configured', 6, result(environment({
      protection_rules: [{ type: 'required_reviewers', reviewers: [{ id: 1 }] }],
    }))],
    ['environment policy drift', 6, result(environment({
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    }))],
    ['branch policy missing', 7, result(policies([]))],
    ['branch policy duplicate', 7, result(policies([{ name: 'main' }, { name: 'main' }]))],
    ['branch policy drift', 7, result(policies([{ name: 'release' }]))],
    ['branch policy total drift', 7, result('[{"total_count":2,"branch_policies":[{"name":"main"}]}]')],
    ['secret already exists', 8, result(names(['ARK_API_KEY']))],
    ['variable target drift', 9, result(names(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN']))],
    ['uppercase account id', 10, result(`${ACCOUNT_ID.toUpperCase()}\n`)],
    ['short account id', 10, result(`abc${sentinel}\n`)],
  ];
  for (const [label, index, response] of cases) {
    await t.test(label, async () => {
      const runner = fakeRunner(inspectionResponses({ [index]: response }));
      await assertFailure(() => createGitHubSetupClient(runner).inspectFirstRun(), [sentinel]);
      assert.equal(runner.calls.some(isMutation), false);
      assert.equal(JSON.stringify(runner.calls).includes(sentinel), false);
    });
  }
});

test('inspection rejects command failures and malformed runner result records without leaking raw output', async () => {
  for (const response of [
    result('raw-output-sentinel', { code: 1, stderr: 'raw-error-sentinel' }),
    { code: 0, stdout: Buffer.from('not text'), stderr: '' },
    Object.defineProperty({ code: 0, stderr: '' }, 'stdout', {
      get() { throw new Error('accessor-sentinel'); },
    }),
  ]) {
    const runner = fakeRunner(inspectionResponses({ 0: response }));
    await assertFailure(
      () => createGitHubSetupClient(runner).inspectFirstRun(),
      ['raw-output-sentinel', 'raw-error-sentinel', 'accessor-sentinel'],
    );
  }
});

test('verifyNames accepts only the complete exact secret and variable name sets', async () => {
  const runner = fakeRunner([
    result(names([...SETUP_POLICY.secretNames].reverse())),
    result(names([...SETUP_POLICY.variableNames].reverse())),
  ]);
  await createGitHubSetupClient(runner).verifyNames();
  assert.deepEqual(runner.calls, [
    { command: 'gh', args: ['secret', 'list', '--repo', REPO, '--env', ENVIRONMENT, '--json', 'name'] },
    { command: 'gh', args: ['variable', 'list', '--repo', REPO, '--env', ENVIRONMENT, '--json', 'name'] },
  ]);

  for (const [secretNames, variableNames] of [
    [SETUP_POLICY.secretNames.slice(1), SETUP_POLICY.variableNames],
    [[...SETUP_POLICY.secretNames, 'EXTRA'], SETUP_POLICY.variableNames],
    [SETUP_POLICY.secretNames, ['CLOUDFLARE_ACCOUNT_ID']],
    [SETUP_POLICY.secretNames, [...SETUP_POLICY.variableNames, 'EXTRA']],
  ]) {
    const bad = fakeRunner([result(names(secretNames)), result(names(variableNames))]);
    await assertFailure(() => createGitHubSetupClient(bad).verifyNames());
  }
});

test('dispatches exact preflight SHA, binds canonical run/job/step/log, and never requests latest run', async () => {
  const runner = fakeRunner(preflightResponses());
  const github = createGitHubSetupClient(runner);
  await github.runDisabledPreflight(SHA);
  const statuses = ['queued', 'in_progress', 'waiting', 'pending'];
  for (let index = 0; index < statuses.length; index += 1) {
    assert.deepEqual(runner.calls[index], {
      command: 'gh',
      args: ['run', 'list', '--workflow', WORKFLOW, '--event', 'workflow_dispatch', '--status', statuses[index], '--limit', '100', '--json', 'databaseId', '--repo', REPO],
    });
  }
  assert.deepEqual(runner.calls[4], {
    command: 'gh',
    args: ['workflow', 'run', WORKFLOW, '--ref', 'main', '--repo', REPO,
      '-f', 'operation=preflight', '-f', 'target=user-1', '-f', `expected_sha=${SHA}`,
      '-f', 'confirmation='],
  });
  assert.deepEqual(runner.calls[5], {
    command: 'gh',
    args: ['run', 'watch', RUN_ID, '--exit-status', '--repo', REPO],
    timeoutMs: 300_000,
  });
  assert.deepEqual(runner.calls[6], {
    command: 'gh',
    args: ['run', 'view', RUN_ID, '--repo', REPO, '--json', 'event,headBranch,headSha,status,conclusion,workflowName,jobs'],
  });
  assert.deepEqual(runner.calls[7], {
    command: 'gh',
    args: ['run', 'view', RUN_ID, '--repo', REPO, '--job', '987654321', '--log'],
  });
  assert.equal(runner.calls.some(({ args }) => (
    args[0] === 'run' && args[1] === 'list' && args.includes('--limit') && args.includes('1')
  )), false);
});

test('each active-run status must be empty before dispatch', async (t) => {
  for (let index = 0; index < 4; index += 1) {
    await t.test(['queued', 'in_progress', 'waiting', 'pending'][index], async () => {
      const runner = fakeRunner(preflightResponses({
        [index]: result('[{"databaseId":42}]'),
      }));
      await assertFailure(() => createGitHubSetupClient(runner).runDisabledPreflight(SHA));
      assert.equal(runner.calls.some(({ args }) => args[0] === 'workflow'), false);
    });
  }
});

test('dispatch URL must contain exactly one canonical current-repository run URL', async (t) => {
  const outputs = [
    '',
    `${RUN_URL}\n${RUN_URL}\n`,
    'https://github.com/other/repo/actions/runs/123\n',
    `${RUN_URL}/jobs/999\n`,
  ];
  for (const stdout of outputs) {
    await t.test(JSON.stringify(stdout), async () => {
      const runner = fakeRunner(preflightResponses({ 4: result(stdout) }));
      await assertFailure(() => createGitHubSetupClient(runner).runDisabledPreflight(SHA));
      assert.equal(runner.calls.some(({ args }) => args[0] === 'run' && args[1] === 'watch'), false);
    });
  }
});

test('preflight metadata binds exact SHA, workflow, unique successful job, and unique successful step', async (t) => {
  const mutations = [
    { headSha: 'c'.repeat(40) },
    { event: 'push' },
    { headBranch: 'feature' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { workflowName: 'Other Workflow' },
    { unexpected: 'metadata-drift' },
    { jobs: [] },
    { jobs: [
      { databaseId: 1, name: 'text-ai-preview', conclusion: 'success', steps: [] },
      { databaseId: 2, name: 'other', conclusion: 'success', steps: [] },
    ] },
    { jobs: [{ databaseId: 1, name: 'other', conclusion: 'success', steps: [] }] },
    { jobs: [{ databaseId: 1, name: 'text-ai-preview', conclusion: 'failure', steps: [] }] },
    { jobs: [{ databaseId: 1, name: 'text-ai-preview', conclusion: 'success', steps: [] }] },
    { jobs: [{ databaseId: 1, name: 'text-ai-preview', conclusion: 'success', steps: [
      { name: 'Dispatch fixed operation', conclusion: 'success' },
      { name: 'Dispatch fixed operation', conclusion: 'success' },
    ] }] },
    { jobs: [{ databaseId: 1, name: 'text-ai-preview', conclusion: 'success', steps: [
      { name: 'Dispatch fixed operation', conclusion: 'failure' },
    ] }] },
    { jobs: [{ databaseId: 'not-digits', name: 'text-ai-preview', conclusion: 'success', steps: [
      { name: 'Dispatch fixed operation', conclusion: 'success' },
    ] }] },
  ];
  for (const mutation of mutations) {
    await t.test(JSON.stringify(mutation), async () => {
      const runner = fakeRunner(preflightResponses({ 6: result(runMetadata(mutation)) }));
      await assertFailure(() => createGitHubSetupClient(runner).runDisabledPreflight(SHA));
      assert.equal(runner.calls.some(({ args }) => args.includes('--job')), false);
    });
  }
});

test('preflight log requires one exact false report from the bound dispatch step', async (t) => {
  const logs = [
    '',
    `text-ai-preview\tDispatch fixed operation\t${REPORT}\ntext-ai-preview\tDispatch fixed operation\t${REPORT}\n`,
    'text-ai-preview\tDispatch fixed operation\t{"command":"preflight","status":"ready","workerTextEnabled":false,"extra":true}\n',
    'text-ai-preview\tDispatch fixed operation\t{"command":"preflight","status":"ready","workerTextEnabled":true}\n',
    `text-ai-preview\tOther step\t${REPORT}\n`,
  ];
  for (const log of logs) {
    await t.test(JSON.stringify(log), async () => {
      const runner = fakeRunner(preflightResponses({ 7: result(log) }));
      await assertFailure(() => createGitHubSetupClient(runner).runDisabledPreflight(SHA));
    });
  }
});

test('invalid expected SHA and failed watch stop closed with fixed error', async () => {
  const invalid = fakeRunner([]);
  await assertFailure(() => createGitHubSetupClient(invalid).runDisabledPreflight('B'.repeat(40)));
  assert.equal(invalid.calls.length, 0);

  const failedWatch = fakeRunner(preflightResponses({
    5: result('', { code: 1, stderr: 'watch-private-sentinel' }),
  }));
  await assertFailure(
    () => createGitHubSetupClient(failedWatch).runDisabledPreflight(SHA),
    ['watch-private-sentinel'],
  );
  assert.equal(failedWatch.calls.some(({ args }) => args[0] === 'run' && args[1] === 'view'), false);
});

test('source locks bounded subprocess, safe env, stdin-only writes, exact SHA, and no latest-run fallback', async () => {
  const source = await readFile(resolve('scripts/text-ai-preview-setup-github.mjs'), 'utf8');
  for (const required of [
    "const MAX_OUTPUT = 262_144",
    "const ALLOWED_ENV = Object.freeze(['PATH', 'HOME', 'XDG_CONFIG_HOME', 'LANG', 'LC_ALL'])",
    "shell: false",
    "stdio: ['pipe', 'pipe', 'pipe']",
    "env.NO_COLOR = '1'",
    "env.GH_PROMPT_DISABLED = '1'",
    "env.GIT_TERMINAL_PROMPT = '0'",
    "child.kill('SIGKILL')",
    "new TextDecoder('utf-8', { fatal: true })",
    "`expected_sha=${expectedSha}`",
    "'workerTextEnabled'",
    "report.workerTextEnabled !== false",
  ]) assert.ok(source.includes(required), `missing source lock: ${required}`);
  for (const forbidden of [
    /shell\s*:\s*true/u,
    /['"]--body['"]/u,
    /GH_TOKEN/u,
    /--limit['"],\s*['"]1['"]/u,
    /workerTextEnabled\s*===\s*true/u,
    /recent|latest.?run|most.?recent/iu,
  ]) assert.equal(forbidden.test(source), false, `forbidden source pattern: ${forbidden}`);
});
