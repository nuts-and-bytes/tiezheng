import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createGitHubSetupClient } from './text-ai-preview-setup-github.mjs';
import { confirmAccessCodeSaved } from './text-ai-preview-setup-prompt.mjs';

const FAILURE = 'Text access-code rotation failed';
const FAILED_OUTPUT = 'ROTATION FAILED\n';
const CANCELLED_OUTPUT = 'ROTATION CANCELLED\n';
const SHA = /^[a-f0-9]{40}$/u;
const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const CODE = /^[A-Za-z0-9_-]{32}$/u;
const KEY = /^[A-Za-z0-9_-]{43}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const MATERIAL_NAMES = Object.freeze(['target', 'code', 'pepper', 'digest']);
const MATERIALS = new WeakSet();
const RENDERED = new WeakSet();
const TYPED_ARRAY_FILL = Uint8Array.prototype.fill;
const DEPENDENCY_NAMES = Object.freeze([
  'github',
  'confirm',
  'generateMaterials',
  'stdout',
  'stderr',
]);
const GITHUB_METHODS = Object.freeze([
  'inspectRotation',
  'setSecret',
  'runAccessCodeRotation',
]);
const OVERRIDE_NAMES = Object.freeze(['githubRunner', 'random']);

function fail() {
  throw new Error(FAILURE);
}

function validTarget(value) {
  return value === 'user-1' || value === 'user-2';
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
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) fail();
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
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function capture(owner, name) {
  return Object.freeze({ owner, method: dataMethod(owner, name) });
}

function invoke(target, ...args) {
  return Reflect.apply(target.method, target.owner, args);
}

function captureWriter(value) {
  try {
    return capture(value, 'write');
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

function wipe(value) {
  try {
    if (!Buffer.isBuffer(value)) return false;
    Reflect.apply(TYPED_ARRAY_FILL, value, [0]);
    return true;
  } catch {
    return false;
  }
}

function materialRecord(value, requireCode = true) {
  if (!MATERIALS.has(value)) fail();
  const record = exactDataRecord(value, MATERIAL_NAMES);
  if (!validTarget(record.target)) fail();
  for (const name of ['code', 'pepper', 'digest']) if (!Buffer.isBuffer(record[name])) fail();
  const code = record.code.toString('ascii');
  const pepper = record.pepper.toString('ascii');
  const digest = record.digest.toString('ascii');
  if ((requireCode && !CODE.test(code)) || !KEY.test(pepper) || !DIGEST.test(digest)) fail();
  return Object.freeze({ ...record, codeText: code, pepperText: pepper, digestText: digest });
}

export function generateAccessCodeRotationMaterials(target, random = randomBytes) {
  const raw = [];
  const encoded = [];
  let complete = false;
  try {
    if (!validTarget(target) || typeof random !== 'function') fail();
    for (const length of [24, 32]) {
      const value = random(length);
      raw.push(value);
      if (!Buffer.isBuffer(value) || value.byteLength !== length) fail();
    }
    const codeText = raw[0].toString('base64url');
    const pepperText = raw[1].toString('base64url');
    const digestText = createHmac('sha256', raw[1]).update(codeText, 'utf8').digest('hex');
    encoded.push(
      Buffer.from(codeText, 'ascii'),
      Buffer.from(pepperText, 'ascii'),
      Buffer.from(digestText, 'ascii'),
    );
    const materials = Object.freeze({
      target,
      code: encoded[0],
      pepper: encoded[1],
      digest: encoded[2],
    });
    MATERIALS.add(materials);
    materialRecord(materials);
    complete = true;
    return materials;
  } catch {
    fail();
  } finally {
    for (const value of raw) wipe(value);
    if (!complete) for (const value of encoded) wipe(value);
  }
}

function renderCodeOnce(writer, materials) {
  try {
    if (RENDERED.has(materials)) fail();
    const record = materialRecord(materials);
    RENDERED.add(materials);
    const result = invoke(writer, `${record.target}: ${record.codeText}\n`);
    if (result !== undefined && typeof result !== 'boolean') fail();
  } catch {
    fail();
  } finally {
    if (MATERIALS.has(materials)) {
      try {
        wipe(exactDataRecord(materials, MATERIAL_NAMES).code);
      } catch {
        // The fixed public failure is sufficient after best-effort clearing.
      }
    }
  }
}

function wipeMaterials(materials) {
  if (!MATERIALS.has(materials)) return;
  try {
    const record = exactDataRecord(materials, MATERIAL_NAMES);
    wipe(record.code);
    wipe(record.pepper);
    wipe(record.digest);
  } catch {
    // The fixed public failure is sufficient after best-effort clearing.
  }
}

function parseOperation(value) {
  const operation = exactDataRecord(value, ['mode', 'target']);
  if ((operation.mode !== 'rotate' && operation.mode !== 'resume') || !validTarget(operation.target)) {
    fail();
  }
  return Object.freeze(operation);
}

function parseDependencies(value) {
  const record = exactDataRecord(value, DEPENDENCY_NAMES);
  const github = {};
  for (const name of GITHUB_METHODS) github[name] = capture(record.github, name);
  const stdout = captureWriter(record.stdout);
  const stderr = captureWriter(record.stderr);
  if (stdout === null || stderr === null) fail();
  return Object.freeze({
    github: Object.freeze(github),
    confirm: capture(value, 'confirm'),
    generateMaterials: capture(value, 'generateMaterials'),
    stdout,
    stderr,
  });
}

function parseGitHubState(value) {
  const state = exactDataRecord(value, ['accountId', 'expectedSha']);
  if (!ACCOUNT_ID.test(state.accountId) || !SHA.test(state.expectedSha)) fail();
  return Object.freeze(state);
}

function secretNames(target) {
  const slot = target === 'user-1' ? '1' : '2';
  return Object.freeze([
    `TEXT_AI_USER_${slot}_ACCESS_CODE_PEPPER`,
    `TEXT_AI_USER_${slot}_ACCESS_CODE_DIGEST`,
  ]);
}

export async function runTextAccessCodeRotation(operation, dependencies) {
  const fallbackStderr = captureWriter(ownData(dependencies, 'stderr'));
  let parsed;
  let selected;
  try {
    selected = parseOperation(operation);
    parsed = parseDependencies(dependencies);
  } catch {
    await writeTextNoThrow(fallbackStderr, FAILED_OUTPUT);
    return 1;
  }

  let materials;
  let phase = 'inspect';
  let writesComplete = false;
  try {
    const githubState = parseGitHubState(await invoke(parsed.github.inspectRotation));
    if (selected.mode === 'resume') {
      phase = 'deploy';
      await invoke(parsed.github.runAccessCodeRotation, selected.target, githubState.expectedSha);
      phase = 'report';
      await writeText(parsed.stdout, `ROTATION COMPLETE target=${selected.target}\n`);
      return 0;
    }

    materials = await invoke(parsed.generateMaterials, selected.target);
    if (!MATERIALS.has(materials)) fail();
    phase = 'render';
    renderCodeOnce(parsed.stdout, materials);
    phase = 'confirm';
    const confirmed = await invoke(parsed.confirm, selected.target);
    if (confirmed === false) {
      await writeText(parsed.stderr, CANCELLED_OUTPUT);
      return 1;
    }
    if (confirmed !== true) fail();

    const record = materialRecord(materials, false);
    const names = secretNames(selected.target);
    phase = 'write';
    await invoke(parsed.github.setSecret, names[0], record.pepper);
    await invoke(parsed.github.setSecret, names[1], record.digest);
    writesComplete = true;

    phase = 'deploy';
    await invoke(parsed.github.runAccessCodeRotation, selected.target, githubState.expectedSha);
    phase = 'report';
    await writeText(parsed.stdout, `ROTATION COMPLETE target=${selected.target}\n`);
    return 0;
  } catch {
    if (phase === 'deploy' && (writesComplete || selected.mode === 'resume')) {
      await writeTextNoThrow(
        parsed.stderr,
        `ROTATION BLOCKED deploy\nresume=npm run rotate:text-preview-code -- --resume=${selected.target}\n`,
      );
    } else {
      await writeTextNoThrow(parsed.stderr, FAILED_OUTPUT);
    }
    return 1;
  } finally {
    wipeMaterials(materials);
  }
}

function parseArguments(argv) {
  try {
    if (!Array.isArray(argv) || Object.getPrototypeOf(argv) !== Array.prototype || argv.length !== 1) fail();
    const keys = Reflect.ownKeys(argv);
    if (keys.length !== 2 || !Object.hasOwn(argv, '0')) fail();
    const argument = argv[0];
    if (argument === '--target=user-1') return Object.freeze({ mode: 'rotate', target: 'user-1' });
    if (argument === '--target=user-2') return Object.freeze({ mode: 'rotate', target: 'user-2' });
    if (argument === '--resume=user-1') return Object.freeze({ mode: 'resume', target: 'user-1' });
    if (argument === '--resume=user-2') return Object.freeze({ mode: 'resume', target: 'user-2' });
    fail();
  } catch {
    fail();
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
    let current = value;
    for (let depth = 0; current !== null && current !== undefined && depth < 32; depth += 1) {
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
    confirm: (target) => confirmAccessCodeSaved(stdin, stdout, target),
    generateMaterials: (target) => parsedOverrides.random === undefined
      ? generateAccessCodeRotationMaterials(target)
      : generateAccessCodeRotationMaterials(target, parsedOverrides.random),
    stdout,
    stderr,
  });
}

export async function runTextAccessCodeRotationCli(argv, io = process, overrides = {}) {
  let stderr = null;
  try {
    stderr = captureWriter(ioChannel(io, 'stderr'));
    const selected = parseArguments(argv);
    const stdin = ioChannel(io, 'stdin');
    const stdout = ioChannel(io, 'stdout');
    if (
      selected.mode === 'rotate'
      && (booleanProperty(stdin, 'isTTY') !== true || booleanProperty(stdout, 'isTTY') !== true)
    ) fail();
    return await runTextAccessCodeRotation(selected, createRealDependencies(io, overrides));
  } catch {
    await writeTextNoThrow(stderr, FAILED_OUTPUT);
    return 1;
  }
}

if (
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runTextAccessCodeRotationCli(process.argv.slice(2));
}
