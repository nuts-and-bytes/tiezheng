import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCloudflareClient as createCloudflareApiClient } from './cloudflare-api.mjs';
import { TEXT_PREVIEW_SETUP_PERMISSION_NAMES } from './text-ai-preview-control.mjs';
import {
  createSetupServiceToken,
  deleteSetupServiceToken,
  inspectCloudflareSetup,
} from './text-ai-preview-setup-cloudflare.mjs';
import { createGitHubSetupClient } from './text-ai-preview-setup-github.mjs';
import { confirmSetup, promptSetupInputs } from './text-ai-preview-setup-prompt.mjs';
import {
  SETUP_POLICY,
  assembleSetupWrites,
  generateSetupKeys,
  parseSetupInputs,
  wipeSetupWrites,
} from './text-ai-preview-setup-values.mjs';

const FAILURE = 'Text preview setup failed';
const CLOUDFLARE_BLOCKED = 'Text preview setup blocked: cloudflare.service-token';
const FAILED_OUTPUT = 'SETUP FAILED\n';
const CANCELLED_OUTPUT = 'SETUP CANCELLED\n';
const PREFLIGHT_BLOCKED_OUTPUT = 'SETUP BLOCKED preflight\n';
const REPORT_BLOCKED_OUTPUT = 'SETUP BLOCKED output\n';
const SUCCESS_OUTPUT = 'SETUP COMPLETE\nsecrets=9 variables=2 preflight=pass workerTextEnabled=false photoEnabled=false\n';
const PREVIEW_OUTPUT = [
  'SETUP PREVIEW',
  `repo=${SETUP_POLICY.repo}`,
  `environment=${SETUP_POLICY.environment}`,
  `service_token=${SETUP_POLICY.serviceTokenName}`,
  `secrets=${SETUP_POLICY.secretNames.join(',')}`,
  'variable=TEXT_AI_TEAM_DOMAIN',
  '不会部署、不会启用、不会调用模型',
  '',
].join('\n');
const DEPENDENCY_NAMES = Object.freeze([
  'github',
  'promptInputs',
  'confirm',
  'createCloudflareClient',
  'inspectCloudflare',
  'createServiceToken',
  'deleteServiceToken',
  'generateKeys',
  'stdout',
  'stderr',
]);
const GITHUB_METHOD_NAMES = Object.freeze([
  'inspectFirstRun',
  'setSecret',
  'setVariable',
  'deleteSecret',
  'deleteVariable',
  'verifyNames',
  'runDisabledPreflight',
]);
const OVERRIDE_NAMES = Object.freeze(['githubRunner', 'fetcher', 'random']);
const ID_PATTERN = /^(?=.{1,255}$)[A-Za-z0-9._-]+$/u;
const TEAM_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const RESERVED_IDS = new Set(['.', '..', '__proto__', 'constructor', 'prototype']);
const TYPED_ARRAY_FILL = Uint8Array.prototype.fill;
const MAX_WIPE_NODES = 256;
const MAX_WIPE_PROPERTIES = 4_096;

function fail() {
  throw new Error(FAILURE);
}

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function ownDataValue(value, name) {
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
  } catch {
    fail();
  }
  fail();
}

function captureWriter(value) {
  try {
    return Object.freeze({ owner: value, method: dataMethod(value, 'write') });
  } catch {
    return null;
  }
}

async function writeFixed(writer, value) {
  if (writer === null) fail();
  try {
    await Reflect.apply(writer.method, writer.owner, [value]);
  } catch {
    fail();
  }
}

async function writeFixedNoThrow(writer, value) {
  if (writer === null) return false;
  try {
    await Reflect.apply(writer.method, writer.owner, [value]);
    return true;
  } catch {
    return false;
  }
}

function captureFunction(owner, value) {
  if (typeof value !== 'function') fail();
  return Object.freeze({ owner, method: value });
}

function invoke(target, ...args) {
  return Reflect.apply(target.method, target.owner, args);
}

function parseDependencies(value) {
  const record = exactDataRecord(value, DEPENDENCY_NAMES);
  const githubRecord = exactDataRecord(record.github, GITHUB_METHOD_NAMES);
  const github = {};
  for (const name of GITHUB_METHOD_NAMES) {
    github[name] = captureFunction(record.github, githubRecord[name]);
  }
  const parsed = {
    github: Object.freeze(github),
    promptInputs: captureFunction(value, record.promptInputs),
    confirm: captureFunction(value, record.confirm),
    createCloudflareClient: captureFunction(value, record.createCloudflareClient),
    inspectCloudflare: captureFunction(value, record.inspectCloudflare),
    createServiceToken: captureFunction(value, record.createServiceToken),
    deleteServiceToken: captureFunction(value, record.deleteServiceToken),
    generateKeys: captureFunction(value, record.generateKeys),
    stdout: captureWriter(record.stdout),
    stderr: captureWriter(record.stderr),
  };
  if (parsed.stdout === null || parsed.stderr === null) fail();
  return Object.freeze(parsed);
}

function snapshotDenseStrings(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')) fail();
    const length = lengthDescriptor.value;
    if (
      !Number.isSafeInteger(length)
      || length < 1
      || length > TEXT_PREVIEW_SETUP_PERMISSION_NAMES.length
    ) fail();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) fail();
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'string'
      ) fail();
      result.push(descriptor.value);
    }
    if (keys.some((key) => {
      if (key === 'length') return false;
      return typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length;
    })) fail();
    return result;
  } catch {
    fail();
  }
}

function renderMissingPermissions(value) {
  const missing = snapshotDenseStrings(value);
  if (
    new Set(missing).size !== missing.length
    || missing.some((name) => !TEXT_PREVIEW_SETUP_PERMISSION_NAMES.includes(name))
  ) fail();
  const ordered = TEXT_PREVIEW_SETUP_PERMISSION_NAMES.filter((name) => missing.includes(name));
  return `SETUP FAILED missing_permissions=${ordered.join(',')}\n`;
}

function parseGitHubState(value) {
  const state = exactDataRecord(value, ['accountId', 'expectedSha']);
  if (typeof state.accountId !== 'string' || typeof state.expectedSha !== 'string') fail();
  return Object.freeze(state);
}

function parseCloudflareState(value) {
  const status = ownDataValue(value, 'status');
  if (status === 'missing-permissions') {
    const state = exactDataRecord(value, ['status', 'missingPermissions']);
    return Object.freeze({
      status,
      missingPermissions: state.missingPermissions,
    });
  }
  if (status === 'ready') {
    const state = exactDataRecord(value, ['status', 'teamDomain']);
    if (typeof state.teamDomain !== 'string' || !TEAM_SLUG_PATTERN.test(state.teamDomain)) fail();
    return Object.freeze({ status, teamDomain: state.teamDomain });
  }
  fail();
}

function validServiceTokenId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) && !RESERVED_IDS.has(value);
}

function inspectResolvedCredential(value) {
  let safeId = null;
  try {
    if (isObjectLike(value)) {
      const idDescriptor = Object.getOwnPropertyDescriptor(value, 'id');
      if (
        idDescriptor !== undefined
        && Object.hasOwn(idDescriptor, 'value')
        && validServiceTokenId(idDescriptor.value)
      ) safeId = idDescriptor.value;
    }
  } catch {
    return Object.freeze({ valid: false, safeId: null });
  }

  try {
    const credential = exactDataRecord(value, ['id', 'clientId', 'clientSecret']);
    if (!validServiceTokenId(credential.id)) fail();
    if (typeof credential.clientId !== 'string' || typeof credential.clientSecret !== 'string') fail();
    return Object.freeze({
      valid: true,
      safeId: credential.id,
      credential: Object.freeze(credential),
    });
  } catch {
    return Object.freeze({ valid: false, safeId });
  }
}

function readWriteEntry(value, expectedName) {
  const entry = exactDataRecord(value, ['name', 'value']);
  if (entry.name !== expectedName || !Buffer.isBuffer(entry.value)) fail();
  return Object.freeze(entry);
}

function snapshotWriteGroup(value, expectedNames) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined
      || !Object.hasOwn(lengthDescriptor, 'value')
      || lengthDescriptor.value !== expectedNames.length
    ) fail();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedNames.length + 1) fail();
    return Object.freeze(expectedNames.map((name, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
      return readWriteEntry(descriptor.value, name);
    }));
  } catch {
    fail();
  }
}

function snapshotWrites(value) {
  const record = exactDataRecord(value, ['secrets', 'variables']);
  return Object.freeze({
    secrets: snapshotWriteGroup(record.secrets, SETUP_POLICY.secretNames),
    variables: snapshotWriteGroup(record.variables, ['TEXT_AI_TEAM_DOMAIN']),
  });
}

function isCloudflareBlockedError(error) {
  try {
    if (!(error instanceof Error)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
    return descriptor !== undefined
      && Object.hasOwn(descriptor, 'value')
      && descriptor.value === CLOUDFLARE_BLOCKED;
  } catch {
    return false;
  }
}

function intrinsicWipe(value) {
  try {
    if (!Buffer.isBuffer(value)) return true;
    Reflect.apply(TYPED_ARRAY_FILL, value, [0]);
    return true;
  } catch {
    return false;
  }
}

function wipeSecretCandidates(candidates) {
  const buffers = new Set();
  for (const value of candidates) {
    for (const name of ['aesKey', 'hmacKey', 'clientSecret']) {
      const candidate = ownDataValue(value, name);
      try {
        if (Buffer.isBuffer(candidate)) buffers.add(candidate);
      } catch {
        // Continue the bounded data-property scan below.
      }
    }
  }

  const seen = new WeakSet();
  const stack = candidates.filter(isObjectLike);
  let nodes = 0;
  let properties = 0;
  while (stack.length > 0 && nodes < MAX_WIPE_NODES && properties < MAX_WIPE_PROPERTIES) {
    const current = stack.pop();
    try {
      if (!isObjectLike(current) || seen.has(current)) continue;
      seen.add(current);
      nodes += 1;
      if (Buffer.isBuffer(current)) {
        buffers.add(current);
        continue;
      }
      const keys = Reflect.ownKeys(current);
      for (const key of keys) {
        if (properties >= MAX_WIPE_PROPERTIES) break;
        properties += 1;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) continue;
        const child = descriptor.value;
        if (Buffer.isBuffer(child)) buffers.add(child);
        else if (isObjectLike(child)) stack.push(child);
      }
    } catch {
      // Cleanup is best effort, bounded, and never changes the fixed public result.
    }
  }
  for (const buffer of buffers) intrinsicWipe(buffer);
}

async function compensateAttemptedResources(attempted, dependencies, cloudflareClient) {
  const blocked = [];
  for (let index = attempted.variables.length - 1; index >= 0; index -= 1) {
    const name = attempted.variables[index];
    try {
      await invoke(dependencies.github.deleteVariable, name);
    } catch {
      blocked.push(`github.variable:${name}`);
    }
  }
  for (let index = attempted.secrets.length - 1; index >= 0; index -= 1) {
    const name = attempted.secrets[index];
    try {
      await invoke(dependencies.github.deleteSecret, name);
    } catch {
      blocked.push(`github.secret:${name}`);
    }
  }
  if (attempted.serviceTokenResolved) {
    if (attempted.serviceTokenId === null) {
      blocked.push('cloudflare.service-token');
    } else {
      try {
        await invoke(
          dependencies.deleteServiceToken,
          cloudflareClient,
          attempted.serviceTokenId,
        );
      } catch {
        blocked.push('cloudflare.service-token');
      }
    }
  }
  return blocked;
}

function cleanupLocalSecrets(writes, candidates) {
  if (writes !== undefined) {
    try {
      wipeSetupWrites(writes);
    } catch {
      // wipeSetupWrites already attempts intrinsic clearing before reporting malformed input.
    }
  }
  wipeSecretCandidates(candidates);
}

export async function runTextPreviewSetup(dependencies) {
  const fallbackStderr = captureWriter(ownDataValue(dependencies, 'stderr'));
  let parsed;
  try {
    parsed = parseDependencies(dependencies);
  } catch {
    await writeFixedNoThrow(fallbackStderr, FAILED_OUTPUT);
    return 1;
  }

  const attempted = {
    serviceTokenResolved: false,
    serviceTokenId: null,
    secrets: [],
    variables: [],
  };
  let keys;
  let writes;
  let cloudflareClient;
  let rawKeysCandidate;
  let resolvedKeysCandidate;
  let rawCredentialCandidate;
  let resolvedCredentialCandidate;
  let phase = 'read-only-checks';
  try {
    const githubState = parseGitHubState(await invoke(parsed.github.inspectFirstRun));

    phase = 'collect';
    const inputs = parseSetupInputs(await invoke(parsed.promptInputs));

    phase = 'validate';
    cloudflareClient = await invoke(parsed.createCloudflareClient, {
      accountId: githubState.accountId,
      apiToken: inputs.cloudflareApiToken,
    });
    const cloudflareState = parseCloudflareState(await invoke(
      parsed.inspectCloudflare,
      githubState.accountId,
      cloudflareClient,
    ));
    if (cloudflareState.status === 'missing-permissions') {
      await writeFixed(parsed.stderr, renderMissingPermissions(cloudflareState.missingPermissions));
      return 1;
    }

    rawKeysCandidate = invoke(parsed.generateKeys);
    resolvedKeysCandidate = await rawKeysCandidate;
    keys = resolvedKeysCandidate;
    await writeFixed(parsed.stdout, PREVIEW_OUTPUT);

    phase = 'confirm';
    const confirmed = await invoke(parsed.confirm);
    if (confirmed === false) {
      await writeFixed(parsed.stderr, CANCELLED_OUTPUT);
      return 1;
    }
    if (confirmed !== true) fail();

    phase = 'create-token';
    rawCredentialCandidate = invoke(parsed.createServiceToken, cloudflareClient);
    resolvedCredentialCandidate = await rawCredentialCandidate;
    attempted.serviceTokenResolved = true;
    const inspectedCredential = inspectResolvedCredential(resolvedCredentialCandidate);
    attempted.serviceTokenId = inspectedCredential.safeId;
    if (!inspectedCredential.valid) fail();

    writes = assembleSetupWrites({
      inputs,
      teamDomain: cloudflareState.teamDomain,
      serviceClientId: inspectedCredential.credential.clientId,
      serviceClientSecret: inspectedCredential.credential.clientSecret,
      keys,
    });
    const writePlan = snapshotWrites(writes);

    phase = 'write-github';
    for (const item of writePlan.secrets) {
      attempted.secrets.push(item.name);
      await invoke(parsed.github.setSecret, item.name, item.value);
    }
    for (const item of writePlan.variables) {
      attempted.variables.push(item.name);
      await invoke(parsed.github.setVariable, item.name, item.value);
    }

    phase = 'verify-names';
    await invoke(parsed.github.verifyNames);

    phase = 'preflight';
    await invoke(parsed.github.runDisabledPreflight, githubState.expectedSha);

    phase = 'report';
    await writeFixed(parsed.stdout, SUCCESS_OUTPUT);

    phase = 'complete';
    return 0;
  } catch (error) {
    if (phase === 'create-token' && isCloudflareBlockedError(error)) {
      await writeFixedNoThrow(parsed.stderr, 'SETUP BLOCKED cleanup=cloudflare.service-token\n');
      return 1;
    }
    if (phase === 'preflight') {
      await writeFixedNoThrow(parsed.stderr, PREFLIGHT_BLOCKED_OUTPUT);
      return 1;
    }
    if (phase === 'report') {
      await writeFixedNoThrow(parsed.stderr, REPORT_BLOCKED_OUTPUT);
      return 1;
    }
    const blocked = await compensateAttemptedResources(attempted, parsed, cloudflareClient);
    await writeFixedNoThrow(
      parsed.stderr,
      blocked.length === 0
        ? FAILED_OUTPUT
        : `SETUP BLOCKED cleanup=${blocked.join(',')}\n`,
    );
    return 1;
  } finally {
    cleanupLocalSecrets(writes, [
      rawKeysCandidate,
      resolvedKeysCandidate,
      rawCredentialCandidate,
      resolvedCredentialCandidate,
    ]);
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

function readIoChannel(io, name) {
  if (io === process) return process[name];
  const value = ownDataValue(io, name);
  if (value === undefined) fail();
  return value;
}

function dataBoolean(value, name) {
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
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined
      || !Object.hasOwn(lengthDescriptor, 'value')
      || lengthDescriptor.value !== 0
    ) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === 1 && keys[0] === 'length';
  } catch {
    return false;
  }
}

function createRealDependencies(io, overrides) {
  const stdin = readIoChannel(io, 'stdin');
  const stdout = readIoChannel(io, 'stdout');
  const stderr = readIoChannel(io, 'stderr');
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
    createServiceToken: createSetupServiceToken,
    deleteServiceToken: deleteSetupServiceToken,
    generateKeys: () => parsedOverrides.random === undefined
      ? generateSetupKeys()
      : generateSetupKeys(parsedOverrides.random),
    stdout,
    stderr,
  });
}

export async function runTextPreviewSetupCli(argv, io = process, overrides = {}) {
  let stderrWriter = null;
  try {
    const stdin = readIoChannel(io, 'stdin');
    const stdout = readIoChannel(io, 'stdout');
    const stderr = readIoChannel(io, 'stderr');
    stderrWriter = captureWriter(stderr);
    if (
      !emptyArguments(argv)
      || dataBoolean(stdin, 'isTTY') !== true
      || dataBoolean(stdout, 'isTTY') !== true
    ) {
      await writeFixedNoThrow(stderrWriter, FAILED_OUTPUT);
      return 1;
    }
    return await runTextPreviewSetup(createRealDependencies(io, overrides));
  } catch {
    await writeFixedNoThrow(stderrWriter, FAILED_OUTPUT);
    return 1;
  }
}

if (
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runTextPreviewSetupCli(process.argv.slice(2));
}
