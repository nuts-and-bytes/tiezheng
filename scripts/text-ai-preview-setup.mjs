import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCloudflareClient as createCloudflareApiClient } from './cloudflare-api.mjs';
import { TEXT_PREVIEW_SETUP_PERMISSION_NAMES } from './text-ai-preview-control.mjs';
import { inspectCloudflareSetup } from './text-ai-preview-setup-cloudflare.mjs';
import { createGitHubSetupClient } from './text-ai-preview-setup-github.mjs';
import { confirmSetup, promptSetupInputs } from './text-ai-preview-setup-prompt.mjs';
import {
  SETUP_POLICY,
  assembleSetupWrites,
  generateSetupMaterials,
  parseSetupInputs,
  renderAccessCodesOnce,
  wipeSetupMaterials,
  wipeSetupWrites,
} from './text-ai-preview-setup-values.mjs';

const FAILURE = 'Text preview setup failed';
const FAILED_OUTPUT = 'SETUP FAILED\n';
const CANCELLED_OUTPUT = 'SETUP CANCELLED\n';
const PREFLIGHT_BLOCKED_OUTPUT = 'SETUP BLOCKED preflight\n';
const REPORT_BLOCKED_OUTPUT = 'SETUP BLOCKED output\n';
const SUCCESS_OUTPUT = 'SETUP COMPLETE\nsecrets=11 variables=1 preflight=pass workerTextEnabled=false photoEnabled=false\n';
const PREVIEW_OUTPUT = [
  'SETUP PREVIEW',
  `repo=${SETUP_POLICY.repository}`,
  `environment=${SETUP_POLICY.environment}`,
  'secrets=11',
  'variables=1(existing)',
  '不会部署、不会启用、不会调用模型',
  '',
].join('\n');
const DEPENDENCY_NAMES = Object.freeze([
  'github',
  'promptInputs',
  'confirm',
  'createCloudflareClient',
  'inspectCloudflare',
  'generateMaterials',
  'stdout',
  'stderr',
]);
const GITHUB_METHODS = Object.freeze([
  'inspectFirstRun',
  'setSecret',
  'deleteSecret',
  'verifyNames',
  'runDisabledPreflight',
]);
const OVERRIDE_NAMES = Object.freeze(['githubRunner', 'fetcher', 'random']);
const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const SHA = /^[a-f0-9]{40}$/u;

function fail() {
  throw new Error(FAILURE);
}

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function exactDataRecord(value, names) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== names.length
      || keys.some((key) => typeof key !== 'string' || !names.includes(key))
    ) fail();
    const result = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
      result[name] = descriptor.value;
    }
    return result;
  } catch {
    fail();
  }
}

function dataMethod(value, name) {
  try {
    if (!isObjectLike(value)) fail();
    let current = value;
    for (let depth = 0; current !== null && depth < 32; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor !== undefined) {
        if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current);
    }
    fail();
  } catch {
    fail();
  }
}

function ownData(value, name) {
  try {
    if (!isObjectLike(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function captureCall(owner, name) {
  return Object.freeze({ owner, method: dataMethod(owner, name) });
}

function invoke(target, ...args) {
  return Reflect.apply(target.method, target.owner, args);
}

function captureWriter(value) {
  try {
    return captureCall(value, 'write');
  } catch {
    return null;
  }
}

async function writeText(writer, value) {
  if (writer === null) fail();
  try {
    await invoke(writer, value);
  } catch {
    fail();
  }
}

async function writeTextNoThrow(writer, value) {
  try {
    if (writer === null) return false;
    await invoke(writer, value);
    return true;
  } catch {
    return false;
  }
}

function parseDependencies(value) {
  const record = exactDataRecord(value, DEPENDENCY_NAMES);
  const github = {};
  for (const name of GITHUB_METHODS) github[name] = captureCall(record.github, name);
  return Object.freeze({
    github: Object.freeze(github),
    promptInputs: captureCall(value, 'promptInputs'),
    confirm: captureCall(value, 'confirm'),
    createCloudflareClient: captureCall(value, 'createCloudflareClient'),
    inspectCloudflare: captureCall(value, 'inspectCloudflare'),
    generateMaterials: captureCall(value, 'generateMaterials'),
    stdout: captureWriter(record.stdout),
    stderr: captureWriter(record.stderr),
  });
}

function parseGitHubState(value) {
  const state = exactDataRecord(value, ['accountId', 'expectedSha']);
  if (!ACCOUNT_ID.test(state.accountId) || !SHA.test(state.expectedSha)) fail();
  return Object.freeze(state);
}

function parseMissingPermissions(value) {
  try {
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) fail();
    const result = [...value];
    if (
      new Set(result).size !== result.length
      || result.some((name) => (
        typeof name !== 'string' || !TEXT_PREVIEW_SETUP_PERMISSION_NAMES.includes(name)
      ))
    ) fail();
    return TEXT_PREVIEW_SETUP_PERMISSION_NAMES.filter((name) => result.includes(name));
  } catch {
    fail();
  }
}

function parseCloudflareState(value) {
  const status = ownData(value, 'status');
  if (status === 'ready') {
    exactDataRecord(value, ['status']);
    return Object.freeze({ status });
  }
  if (status === 'missing-permissions') {
    const state = exactDataRecord(value, ['status', 'missingPermissions']);
    return Object.freeze({ status, missingPermissions: parseMissingPermissions(state.missingPermissions) });
  }
  fail();
}

function snapshotWrites(writes) {
  const record = exactDataRecord(writes, ['secrets']);
  try {
    if (!Array.isArray(record.secrets) || record.secrets.length !== SETUP_POLICY.secretNames.length) fail();
    return Object.freeze(SETUP_POLICY.secretNames.map((name, index) => {
      const item = exactDataRecord(record.secrets[index], ['name', 'value']);
      if (item.name !== name || !Buffer.isBuffer(item.value) || item.value.byteLength < 1) fail();
      return Object.freeze(item);
    }));
  } catch {
    fail();
  }
}

async function compensateSecrets(names, dependencies) {
  const blocked = [];
  for (let index = names.length - 1; index >= 0; index -= 1) {
    const name = names[index];
    try {
      await invoke(dependencies.github.deleteSecret, name);
    } catch {
      blocked.push(`github.secret:${name}`);
    }
  }
  return blocked;
}

function cleanupLocal(writes, materials) {
  if (writes !== undefined) {
    try {
      wipeSetupWrites(writes);
    } catch {
      // The public failure remains fixed after best-effort intrinsic cleanup.
    }
  }
  if (materials !== undefined) {
    try {
      wipeSetupMaterials(materials);
    } catch {
      // The public failure remains fixed after best-effort intrinsic cleanup.
    }
  }
}

export async function runTextPreviewSetup(dependencies) {
  const fallbackStderr = captureWriter(ownData(dependencies, 'stderr'));
  let parsed;
  try {
    parsed = parseDependencies(dependencies);
    if (parsed.stdout === null || parsed.stderr === null) fail();
  } catch {
    await writeTextNoThrow(fallbackStderr, FAILED_OUTPUT);
    return 1;
  }

  let materials;
  let writes;
  let phase = 'read-only';
  const attemptedSecrets = [];
  try {
    const githubState = parseGitHubState(await invoke(parsed.github.inspectFirstRun));
    const inputs = parseSetupInputs(await invoke(parsed.promptInputs));
    const cloudflareClient = await invoke(parsed.createCloudflareClient, {
      accountId: githubState.accountId,
      apiToken: inputs.cloudflareApiToken,
    });
    const cloudflareState = parseCloudflareState(await invoke(
      parsed.inspectCloudflare,
      githubState.accountId,
      cloudflareClient,
    ));
    if (cloudflareState.status === 'missing-permissions') {
      await writeText(
        parsed.stderr,
        `SETUP FAILED missing_permissions=${cloudflareState.missingPermissions.join(',')}\n`,
      );
      return 1;
    }

    materials = await invoke(parsed.generateMaterials);
    writes = assembleSetupWrites({ inputs, materials });
    const writePlan = snapshotWrites(writes);
    await writeText(parsed.stdout, PREVIEW_OUTPUT);

    phase = 'confirm';
    const confirmed = await invoke(parsed.confirm);
    if (confirmed === false) {
      await writeText(parsed.stderr, CANCELLED_OUTPUT);
      return 1;
    }
    if (confirmed !== true) fail();

    phase = 'write-github';
    for (const item of writePlan) {
      attemptedSecrets.push(item.name);
      await invoke(parsed.github.setSecret, item.name, item.value);
    }

    phase = 'verify-names';
    await invoke(parsed.github.verifyNames);

    phase = 'render-codes';
    renderAccessCodesOnce(parsed.stdout.owner, materials);

    phase = 'preflight';
    await invoke(parsed.github.runDisabledPreflight, githubState.expectedSha);

    phase = 'report';
    await writeText(parsed.stdout, SUCCESS_OUTPUT);
    phase = 'complete';
    return 0;
  } catch {
    const blocked = await compensateSecrets(attemptedSecrets, parsed);
    if (blocked.length > 0) {
      await writeTextNoThrow(parsed.stderr, `SETUP BLOCKED cleanup=${blocked.join(',')}\n`);
    } else if (phase === 'preflight') {
      await writeTextNoThrow(parsed.stderr, PREFLIGHT_BLOCKED_OUTPUT);
    } else if (phase === 'report') {
      await writeTextNoThrow(parsed.stderr, REPORT_BLOCKED_OUTPUT);
    } else {
      await writeTextNoThrow(parsed.stderr, FAILED_OUTPUT);
    }
    return 1;
  } finally {
    cleanupLocal(writes, materials);
  }
}

function parseOverrides(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !OVERRIDE_NAMES.includes(key)) fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
      ) fail();
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    fail();
  }
}

function ioChannel(io, name) {
  if (io === process) return process[name];
  const value = ownData(io, name);
  if (value === undefined) fail();
  return value;
}

function booleanProperty(value, name) {
  try {
    if (!isObjectLike(value)) return undefined;
    let current = value;
    for (let depth = 0; current !== null && depth < 32; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor !== undefined) {
        return Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'boolean'
          ? descriptor.value
          : undefined;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function emptyArguments(value) {
  try {
    return Array.isArray(value)
      && Object.getPrototypeOf(value) === Array.prototype
      && value.length === 0
      && Reflect.ownKeys(value).length === 1;
  } catch {
    return false;
  }
}

function createRealDependencies(io, overrides) {
  const stdin = ioChannel(io, 'stdin');
  const stdout = ioChannel(io, 'stdout');
  const stderr = ioChannel(io, 'stderr');
  const parsedOverrides = parseOverrides(overrides);
  const github = parsedOverrides.githubRunner === undefined
    ? createGitHubSetupClient()
    : createGitHubSetupClient(parsedOverrides.githubRunner);
  return Object.freeze({
    github,
    promptInputs: () => promptSetupInputs(stdin, stdout),
    confirm: () => confirmSetup(stdin, stdout),
    createCloudflareClient: ({ accountId, apiToken }) => createCloudflareApiClient({
      accountId,
      apiToken,
      ...(parsedOverrides.fetcher === undefined ? {} : { fetcher: parsedOverrides.fetcher }),
    }),
    inspectCloudflare: inspectCloudflareSetup,
    generateMaterials: () => parsedOverrides.random === undefined
      ? generateSetupMaterials()
      : generateSetupMaterials(parsedOverrides.random),
    stdout,
    stderr,
  });
}

export async function runTextPreviewSetupCli(argv, io = process, overrides = {}) {
  let stderr = null;
  try {
    const stdin = ioChannel(io, 'stdin');
    const stdout = ioChannel(io, 'stdout');
    stderr = captureWriter(ioChannel(io, 'stderr'));
    if (
      !emptyArguments(argv)
      || booleanProperty(stdin, 'isTTY') !== true
      || booleanProperty(stdout, 'isTTY') !== true
    ) {
      await writeTextNoThrow(stderr, FAILED_OUTPUT);
      return 1;
    }
    return await runTextPreviewSetup(createRealDependencies(io, overrides));
  } catch {
    await writeTextNoThrow(stderr, FAILED_OUTPUT);
    return 1;
  }
}

if (
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runTextPreviewSetupCli(process.argv.slice(2));
}
