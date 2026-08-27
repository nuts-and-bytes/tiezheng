import { spawn } from 'node:child_process';
import { TextDecoder } from 'node:util';

import { SETUP_POLICY } from './text-ai-preview-setup-values.mjs';

const FAILURE = 'Text preview setup failed';
const MAX_OUTPUT = 262_144;
const MAX_INPUT = 4_096;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_LENGTH = 4_096;
const DEFAULT_TIMEOUT = 20_000;
const WATCH_TIMEOUT = 300_000;
const ALLOWED_ENV = Object.freeze(['PATH', 'HOME', 'XDG_CONFIG_HOME', 'LANG', 'LC_ALL']);
const REPO = 'nuts-and-bytes/tiezheng';
const ENVIRONMENT = 'text-ai-preview';
const WORKFLOW = 'text-ai-preview.yml';
const WORKFLOW_NAME = 'Text AI Preview Control';
const JOB_NAME = 'text-ai-preview';
const STEP_NAME = 'Dispatch fixed operation';
const ACCOUNT_VARIABLE = 'CLOUDFLARE_ACCOUNT_ID';
const WRITABLE_VARIABLE_NAMES = Object.freeze(['TEXT_AI_TEAM_DOMAIN']);
const ACTIVE_STATUSES = Object.freeze(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/u;
const RUN_ID_PATTERN = /^[0-9]+$/u;
const ARGUMENT_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const HTTPS_ORIGIN = `https://github.com/${REPO}.git`;
const SSH_ORIGIN = `git@github.com:${REPO}.git`;
const REPORT_LINE = '{"command":"preflight","status":"ready","workerTextEnabled":false}';
const TYPED_ARRAY_FILL = Uint8Array.prototype.fill;
const TYPED_ARRAY_BYTE_LENGTH_GET = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
).get;

function fail() {
  throw new Error(FAILURE);
}

function bufferLength(value) {
  try {
    if (!Buffer.isBuffer(value)) fail();
    return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GET, value, []);
  } catch {
    fail();
  }
}

function wipeBuffer(value) {
  try {
    Reflect.apply(TYPED_ARRAY_FILL, value, [0]);
    return true;
  } catch {
    return false;
  }
}

function snapshotArguments(value) {
  try {
    if (!Array.isArray(value)) fail();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined
      || !Object.hasOwn(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 1
      || lengthDescriptor.value > MAX_ARGUMENTS
    ) fail();
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) fail();
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
      const argument = descriptor.value;
      if (
        typeof argument !== 'string'
        || argument.length < 1
        || argument.length > MAX_ARGUMENT_LENGTH
        || ARGUMENT_CONTROL_PATTERN.test(argument)
      ) fail();
      result.push(argument);
    }
    return Object.freeze(result);
  } catch {
    fail();
  }
}

function boundedInput(value) {
  if (value === undefined) return undefined;
  const length = bufferLength(value);
  if (length < 1 || length > MAX_INPUT) fail();
  return value;
}

function snapshotRunOptions(value) {
  try {
    if (value === undefined) return Object.freeze({ input: undefined, timeoutMs: DEFAULT_TIMEOUT });
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !['input', 'timeoutMs'].includes(key))) fail();
    const input = keys.includes('input') ? dataProperty(value, 'input') : undefined;
    const timeoutMs = keys.includes('timeoutMs') ? dataProperty(value, 'timeoutMs') : DEFAULT_TIMEOUT;
    return Object.freeze({ input, timeoutMs });
  } catch {
    fail();
  }
}

function createBoundedCommandRunner(spawnCommand) {
  if (typeof spawnCommand !== 'function') fail();
  return async (command, args, options = undefined) => {
    try {
      if (command !== 'git' && command !== 'gh') fail();
      const { input, timeoutMs } = snapshotRunOptions(options);
      const safeArguments = snapshotArguments(args);
      const safeInput = boundedInput(input);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > WATCH_TIMEOUT) fail();
      const env = Object.fromEntries(ALLOWED_ENV
        .filter((name) => typeof process.env[name] === 'string')
        .map((name) => [name, process.env[name]]));
      env.NO_COLOR = '1';
      env.GH_PROMPT_DISABLED = '1';
      env.GIT_TERMINAL_PROMPT = '0';

      return await new Promise((resolve, reject) => {
        const child = Reflect.apply(spawnCommand, undefined, [command, safeArguments, {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        }]);
        const stdout = [];
        const stderr = [];
        let bytes = 0;
        let settled = false;
        let timer;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback(value);
        };
        const failCommand = () => {
          if (settled) return;
          try {
            child.kill('SIGKILL');
          } catch {
            // The fixed public failure below is sufficient after a failed kill.
          }
          finish(reject, new Error(FAILURE));
        };
        const collect = (target) => (chunk) => {
          if (!Buffer.isBuffer(chunk)) {
            failCommand();
            return;
          }
          bytes += chunk.length;
          if (bytes > MAX_OUTPUT) {
            failCommand();
            return;
          }
          target.push(chunk);
        };

        child.stdout.on('data', collect(stdout));
        child.stderr.on('data', collect(stderr));
        child.stdin.on('error', failCommand);
        child.once('error', failCommand);
        child.once('close', (code) => {
          if (!Number.isInteger(code) || code < 0 || code > 255) {
            failCommand();
            return;
          }
          try {
            const outputDecoder = new TextDecoder('utf-8', { fatal: true });
            const errorDecoder = new TextDecoder('utf-8', { fatal: true });
            finish(resolve, Object.freeze({
              code,
              stdout: outputDecoder.decode(Buffer.concat(stdout)),
              stderr: errorDecoder.decode(Buffer.concat(stderr)),
            }));
          } catch {
            failCommand();
          }
        });
        timer = setTimeout(failCommand, timeoutMs);
        try {
          if (safeInput === undefined) child.stdin.end();
          else child.stdin.end(safeInput);
        } catch {
          failCommand();
        }
      });
    } catch {
      fail();
    }
  };
}

export function createBoundedCommandRunnerForTest(spawnCommand) {
  return createBoundedCommandRunner(spawnCommand);
}

const BOUNDED_COMMAND_RUNNER = createBoundedCommandRunner(spawn);

export async function runBoundedCommand(command, args, options = undefined) {
  return BOUNDED_COMMAND_RUNNER(command, args, options);
}

function dataProperty(value, name) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
    return descriptor.value;
  } catch {
    fail();
  }
}

function parseRunnerResult(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 3
      || keys.some((key) => typeof key !== 'string' || !['code', 'stdout', 'stderr'].includes(key))
    ) fail();
    const code = dataProperty(value, 'code');
    const stdout = dataProperty(value, 'stdout');
    const stderr = dataProperty(value, 'stderr');
    if (!Number.isInteger(code) || code < 0 || code > 255) fail();
    if (typeof stdout !== 'string' || typeof stderr !== 'string') fail();
    if (Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(stderr, 'utf8') > MAX_OUTPUT) fail();
    return Object.freeze({ code, stdout, stderr });
  } catch {
    fail();
  }
}

function createCheckedRunner(runner) {
  if (typeof runner !== 'function') fail();
  return async (command, args, options = undefined) => {
    try {
      const safeArgs = Object.freeze([...args]);
      const safeOptions = options === undefined ? Object.freeze({}) : Object.freeze(options);
      const result = parseRunnerResult(await Reflect.apply(runner, undefined, [
        command,
        safeArgs,
        safeOptions,
      ]));
      if (result.code !== 0) fail();
      return result.stdout;
    } catch {
      fail();
    }
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail();
  }
}

function plainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  return value;
}

function canonicalLine(value) {
  if (typeof value !== 'string') fail();
  const line = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (line.length === 0 || /[\r\n]/u.test(line)) fail();
  return line;
}

function parseNames(value) {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) fail();
  const seen = new Set();
  for (const item of parsed) {
    const record = plainRecord(item);
    const keys = Object.keys(record);
    if (keys.length !== 1 || keys[0] !== 'name' || typeof record.name !== 'string') fail();
    if (record.name.length === 0 || seen.has(record.name)) fail();
    seen.add(record.name);
  }
  return seen;
}

function exactNames(actual, expected) {
  if (actual.size !== expected.length) fail();
  for (const name of expected) if (!actual.has(name)) fail();
}

function validateEnvironment(value) {
  const record = plainRecord(parseJson(value));
  if (record.name !== ENVIRONMENT || !Array.isArray(record.protection_rules)) fail();
  let reviewerCount = 0;
  for (const item of record.protection_rules) {
    const rule = plainRecord(item);
    if (rule.type === 'required_reviewers') {
      if (!Array.isArray(rule.reviewers)) fail();
      reviewerCount += rule.reviewers.length;
    }
  }
  if (reviewerCount !== 0) fail();
  const policy = plainRecord(record.deployment_branch_policy);
  if (policy.protected_branches !== false || policy.custom_branch_policies !== true) fail();
}

function validatePolicies(value) {
  const pages = parseJson(value);
  if (!Array.isArray(pages) || pages.length === 0) fail();
  const items = [];
  const declaredTotals = [];
  for (const page of pages) {
    if (Array.isArray(page)) {
      items.push(...page);
      continue;
    }
    const record = plainRecord(page);
    if (!Array.isArray(record.branch_policies)) fail();
    if (Object.hasOwn(record, 'total_count')) {
      if (!Number.isSafeInteger(record.total_count) || record.total_count < 0) fail();
      declaredTotals.push(record.total_count);
    }
    items.push(...record.branch_policies);
  }
  if (declaredTotals.some((total) => total !== items.length)) fail();
  if (items.length !== 1) fail();
  const policy = plainRecord(items[0]);
  if (policy.name !== 'main' || policy.type !== 'branch') fail();
}

function validateEmptyRunList(value) {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.length !== 0) fail();
}

function extractRunId(value) {
  if (typeof value !== 'string' || /\r/u.test(value)) fail();
  const pattern = new RegExp(`^https://github\\.com/${REPO}/actions/runs/([0-9]+)$`, 'u');
  const urlTokens = value.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]+/gu) ?? [];
  if (urlTokens.length !== 1) fail();
  const matchingLines = value.split('\n').filter((line) => line === urlTokens[0]);
  const match = pattern.exec(urlTokens[0]);
  if (matchingLines.length !== 1 || match === null || !RUN_ID_PATTERN.test(match[1])) fail();
  return match[1];
}

function parseJobId(value, expectedSha) {
  const metadata = plainRecord(parseJson(value));
  const metadataNames = Object.freeze([
    'event',
    'headBranch',
    'headSha',
    'status',
    'conclusion',
    'workflowName',
    'jobs',
  ]);
  const metadataKeys = Reflect.ownKeys(metadata);
  if (
    metadataKeys.length !== metadataNames.length
    || metadataKeys.some((key) => typeof key !== 'string' || !metadataNames.includes(key))
    || metadata.event !== 'workflow_dispatch'
    || metadata.headBranch !== 'main'
    || metadata.headSha !== expectedSha
    || metadata.status !== 'completed'
    || metadata.conclusion !== 'success'
    || metadata.workflowName !== WORKFLOW_NAME
    || !Array.isArray(metadata.jobs)
    || metadata.jobs.length !== 1
  ) fail();
  const job = plainRecord(metadata.jobs[0]);
  if (job.name !== JOB_NAME || job.conclusion !== 'success' || !Array.isArray(job.steps)) fail();
  const steps = job.steps.filter((item) => {
    const step = plainRecord(item);
    return step.name === STEP_NAME;
  });
  if (steps.length !== 1 || steps[0].conclusion !== 'success') fail();
  const jobId = job.databaseId;
  if (typeof jobId === 'number') {
    if (!Number.isSafeInteger(jobId) || jobId < 1) fail();
    return String(jobId);
  }
  if (typeof jobId !== 'string' || !RUN_ID_PATTERN.test(jobId)) fail();
  return jobId;
}

function validatePreflightLog(value) {
  if (typeof value !== 'string' || /\r/u.test(value)) fail();
  const reports = [];
  for (const line of value.split('\n')) {
    const columns = line.split('\t');
    if (columns.length < 3) continue;
    const payload = columns.at(-1);
    let report;
    try {
      report = JSON.parse(payload);
    } catch {
      continue;
    }
    if (report === null || typeof report !== 'object' || Array.isArray(report)) continue;
    if (
      Object.hasOwn(report, 'command')
      || Object.hasOwn(report, 'status')
      || Object.hasOwn(report, 'workerTextEnabled')
    ) reports.push({ columns, payload, report });
  }
  if (reports.length !== 1) fail();
  const { columns, payload, report } = reports[0];
  const keys = Object.keys(report);
  if (
    columns[1] !== STEP_NAME
    || payload !== REPORT_LINE
    || keys.length !== 3
    || keys[0] !== 'command'
    || keys[1] !== 'status'
    || keys[2] !== 'workerTextEnabled'
    || report.command !== 'preflight'
    || report.status !== 'ready'
    || report.workerTextEnabled !== false
  ) fail();
}

export function createGitHubSetupClient(runner = runBoundedCommand) {
  const run = createCheckedRunner(runner);

  async function inspectFirstRun() {
    try {
      await run('gh', ['auth', 'status', '--hostname', 'github.com']);
      if (await run('git', ['status', '--porcelain=v1']) !== '') fail();
      if (canonicalLine(await run('git', ['branch', '--show-current'])) !== 'main') fail();
      const origin = canonicalLine(await run('git', ['remote', 'get-url', '--push', 'origin']));
      if (origin !== HTTPS_ORIGIN && origin !== SSH_ORIGIN) fail();
      const localSha = canonicalLine(await run('git', ['rev-parse', 'HEAD']));
      if (!SHA_PATTERN.test(localSha)) fail();
      const remoteSha = canonicalLine(await run('gh', [
        'api',
        `repos/${REPO}/git/ref/heads/main`,
        '--jq',
        '.object.sha',
      ]));
      if (!SHA_PATTERN.test(remoteSha) || remoteSha !== localSha) fail();
      validateEnvironment(await run('gh', ['api', `repos/${REPO}/environments/${ENVIRONMENT}`]));
      validatePolicies(await run('gh', [
        'api',
        '--paginate',
        '--slurp',
        `repos/${REPO}/environments/${ENVIRONMENT}/deployment-branch-policies`,
      ]));
      const secretNames = parseNames(await run('gh', [
        'secret', 'list', '--repo', REPO, '--env', ENVIRONMENT, '--json', 'name',
      ]));
      if (secretNames.size !== 0) fail();
      const variableNames = parseNames(await run('gh', [
        'variable', 'list', '--repo', REPO, '--env', ENVIRONMENT, '--json', 'name',
      ]));
      exactNames(variableNames, [ACCOUNT_VARIABLE]);
      const accountId = canonicalLine(await run('gh', [
        'variable', 'get', ACCOUNT_VARIABLE, '--repo', REPO, '--env', ENVIRONMENT,
      ]));
      if (!ACCOUNT_ID_PATTERN.test(accountId)) fail();
      return Object.freeze({ accountId, expectedSha: remoteSha });
    } catch {
      fail();
    }
  }

  async function writeValue(allowedNames, name, value, args) {
    const shouldWipe = Buffer.isBuffer(value);
    let failed = false;
    try {
      const length = bufferLength(value);
      if (length < 1 || length > MAX_INPUT || !allowedNames.includes(name)) fail();
      await run('gh', args, { input: value });
    } catch {
      failed = true;
    } finally {
      if (shouldWipe && !wipeBuffer(value)) failed = true;
    }
    if (failed) fail();
  }

  async function setSecret(name, value) {
    const args = ['secret', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];
    return writeValue(SETUP_POLICY.secretNames, name, value, args);
  }

  async function setVariable(name, value) {
    const args = ['variable', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];
    return writeValue(WRITABLE_VARIABLE_NAMES, name, value, args);
  }

  async function deleteValue(allowedNames, name, args) {
    try {
      if (!allowedNames.includes(name)) fail();
      await run('gh', args);
    } catch {
      fail();
    }
  }

  async function deleteSecret(name) {
    return deleteValue(SETUP_POLICY.secretNames, name, [
      'secret', 'delete', name, '--env', ENVIRONMENT, '--repo', REPO,
    ]);
  }

  async function deleteVariable(name) {
    return deleteValue(WRITABLE_VARIABLE_NAMES, name, [
      'variable', 'delete', name, '--env', ENVIRONMENT, '--repo', REPO,
    ]);
  }

  async function verifyNames() {
    try {
      const secrets = parseNames(await run('gh', [
        'secret', 'list', '--repo', REPO, '--env', ENVIRONMENT, '--json', 'name',
      ]));
      const variables = parseNames(await run('gh', [
        'variable', 'list', '--repo', REPO, '--env', ENVIRONMENT, '--json', 'name',
      ]));
      exactNames(secrets, SETUP_POLICY.secretNames);
      exactNames(variables, SETUP_POLICY.variableNames);
    } catch {
      fail();
    }
  }

  async function runDisabledPreflight(expectedSha) {
    try {
      if (typeof expectedSha !== 'string' || !SHA_PATTERN.test(expectedSha)) fail();
      for (const status of ACTIVE_STATUSES) {
        validateEmptyRunList(await run('gh', [
          'run', 'list',
          '--workflow', WORKFLOW,
          '--event', 'workflow_dispatch',
          '--status', status,
          '--limit', '100',
          '--json', 'databaseId',
          '--repo', REPO,
        ]));
      }
      const dispatchOutput = await run('gh', [
        'workflow', 'run', WORKFLOW,
        '--ref', 'main',
        '--repo', REPO,
        '-f', 'operation=preflight',
        '-f', 'target=user-1',
        '-f', `expected_sha=${expectedSha}`,
        '-f', 'confirmation=',
      ]);
      const runId = extractRunId(dispatchOutput);
      await run('gh', [
        'run', 'watch', runId, '--exit-status', '--repo', REPO,
      ], { timeoutMs: WATCH_TIMEOUT });
      const metadata = await run('gh', [
        'run', 'view', runId,
        '--repo', REPO,
        '--json', 'event,headBranch,headSha,status,conclusion,workflowName,jobs',
      ]);
      const jobId = parseJobId(metadata, expectedSha);
      const log = await run('gh', [
        'run', 'view', runId,
        '--repo', REPO,
        '--job', jobId,
        '--log',
      ]);
      validatePreflightLog(log);
    } catch {
      fail();
    }
  }

  return Object.freeze({
    inspectFirstRun,
    setSecret,
    setVariable,
    deleteSecret,
    deleteVariable,
    verifyNames,
    runDisabledPreflight,
  });
}
