import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FAILURE = 'Text preview setup policy failed';
const MAX_SOURCE_BYTES = 1_048_576;

export const EXPECTED_FILES = Object.freeze([
  'scripts/text-ai-preview-setup-values.mjs',
  'scripts/text-ai-preview-setup-prompt.mjs',
  'scripts/text-ai-preview-setup-cloudflare.mjs',
  'scripts/text-ai-preview-setup-github.mjs',
  'scripts/text-ai-preview-setup.mjs',
  'scripts/text-ai-access-code-rotate.mjs',
  'package.json',
]);

const EXPECTED_SHA256 = Object.freeze(new Map([
  ['scripts/text-ai-preview-setup-values.mjs', '29ae8334fe34870933400b72e950327898fe0ef2c03cb07091b92856f91b9057'],
  ['scripts/text-ai-preview-setup-prompt.mjs', 'bd5c91b9ebcfc73ac6e9078ec0d571a1d52189763fdb7d4753ce6fc1c8690f04'],
  ['scripts/text-ai-preview-setup-cloudflare.mjs', '9f555d3bac14621cb2ff5cfb8ea689d42ceb36c18cafc7684609df0805427853'],
  ['scripts/text-ai-preview-setup-github.mjs', '7ab5ab98699017ee160853e89f7e7cf1e384b271c2dbe9f42d28f11576dcb608'],
  ['scripts/text-ai-preview-setup.mjs', 'cec3b507f40f0daa870ea766e28430d01dc3a1f7dbdd5509b7f29c9a14ebecc0'],
  ['scripts/text-ai-access-code-rotate.mjs', 'cfe17d0944d23a804c25ead58580d84751a0a8d960a72ff5a8702f78e468d44b'],
  ['package.json', '00c9c4ae2073f19ea25fe2f93fc575aa056d381fa3d0665c40cbae764391ef1d'],
]));

const SECRET_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN',
  'ARK_API_KEY',
  'PHOTO_AI_CACHE_AES_KEY',
  'PHOTO_AI_ACCOUNT_HMAC_KEY',
  'TEXT_AI_USER_1_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_1_ACCESS_CODE_DIGEST',
  'TEXT_AI_USER_2_ACCESS_CODE_PEPPER',
  'TEXT_AI_USER_2_ACCESS_CODE_DIGEST',
  'TEXT_AI_SESSION_SIGNING_KEY',
  'TEXT_AI_RATE_LIMIT_HMAC_KEY',
  'TEXT_AI_ADMIN_SIGNING_KEY',
]);

const FORBIDDEN_SHAPES = Object.freeze([
  '/access/',
  'cloudflareaccess.com',
  'Cf-Access-Jwt-Assertion',
  'cf-access-client-id',
  'cf-access-client-secret',
  'TEXT_AI_TEAM_DOMAIN',
  'TEXT_AI_USER_1_EMAIL',
  'TEXT_AI_USER_2_EMAIL',
  'TEXT_AI_ADMIN_EMAIL',
  'TEXT_AI_CF_ACCESS',
  'Zero Trust',
  'serviceToken',
  'service_token',
  'wrangler deploy',
  'operation=enable-admin-preview',
  'operation=enable-second-account',
  'ark.cn',
  'volces.com',
]);

const FIXED_REPORT = Object.freeze({
  setupOnly: true,
  hiddenInputs: 2,
  secrets: 11,
  variables: 1,
  accessCodes: 2,
  cloudflareWrites: 0,
});

function fail() {
  throw new Error(FAILURE);
}

function exactSources(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== EXPECTED_FILES.length
      || keys.some((key) => typeof key !== 'string' || !EXPECTED_FILES.includes(key))
    ) fail();
    const result = new Map();
    for (const file of EXPECTED_FILES) {
      const descriptor = Object.getOwnPropertyDescriptor(value, file);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) fail();
      const source = descriptor.value;
      if (
        typeof source !== 'string'
        || Buffer.byteLength(source, 'utf8') < 1
        || Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES
        || source.includes('\u0000')
        || source.includes('\r')
        || !source.endsWith('\n')
      ) fail();
      result.set(file, source);
    }
    return result;
  } catch {
    fail();
  }
}

function count(value, needle) {
  let total = 0;
  let offset = 0;
  while (true) {
    const next = value.indexOf(needle, offset);
    if (next === -1) return total;
    total += 1;
    offset = next + needle.length;
  }
}

function verifyHashes(sources) {
  for (const file of EXPECTED_FILES) {
    const expected = EXPECTED_SHA256.get(file);
    const actual = createHash('sha256').update(sources.get(file), 'utf8').digest('hex');
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/u.test(expected) || actual !== expected) fail();
  }
}

function verifyForbiddenCapabilities(sources) {
  const runtime = EXPECTED_FILES
    .filter((file) => file !== 'package.json')
    .map((file) => sources.get(file))
    .join('\n');
  for (const shape of FORBIDDEN_SHAPES) if (runtime.includes(shape)) fail();
  if (count(runtime, "from 'node:child_process'") !== 1) fail();
  const github = sources.get('scripts/text-ai-preview-setup-github.mjs');
  if (
    !github.includes("if (command !== 'git' && command !== 'gh') fail();")
    || !github.includes('shell: false,')
    || github.includes("command === 'curl'")
  ) fail();
}

function verifyValueContract(sources) {
  const values = sources.get('scripts/text-ai-preview-setup-values.mjs');
  for (const name of SECRET_NAMES) if (count(values, `'${name}'`) < 2) fail();
  if (
    !values.includes("repository: 'nuts-and-bytes/tiezheng',")
    || !values.includes("environment: 'text-ai-preview',")
    || !values.includes("variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID']),")
    || !values.includes('const RANDOM_LENGTHS = Object.freeze([24, 24, 32, 32, 32, 32, 32, 32, 32]);')
    || !values.includes("renderAccessCodesOnce(output, materials)")
    || values.includes('user1Email')
    || values.includes('user2Email')
  ) fail();
}

function verifyPromptContract(sources) {
  const prompt = sources.get('scripts/text-ai-preview-setup-prompt.mjs');
  if (
    count(prompt, "['Cloudflare API Token', 'ARK_API_KEY']") !== 1
    || !prompt.includes('const hidden = true;')
    || prompt.includes('email')
  ) fail();
}

function verifyCloudflareContract(sources) {
  const cloudflare = sources.get('scripts/text-ai-preview-setup-cloudflare.mjs');
  for (const path of [
    "'/pages/projects/tiezheng'",
    "'/workers/scripts'",
  ]) if (count(cloudflare, path) !== 1) fail();
  for (const mutation of ["'post'", "'put'", "'patch'", "'delete'"]) {
    if (cloudflare.includes(mutation)) fail();
  }
}

function verifySetupContract(sources) {
  const setup = sources.get('scripts/text-ai-preview-setup.mjs');
  const render = setup.indexOf('renderAccessCodesOnce(parsed.stdout.owner, materials);');
  const preflight = setup.indexOf('await invoke(parsed.github.runDisabledPreflight, githubState.expectedSha);');
  if (
    !setup.includes("const SUCCESS_OUTPUT = 'SETUP COMPLETE\\nsecrets=11 variables=1 preflight=pass workerTextEnabled=false photoEnabled=false\\n';")
    || render === -1
    || preflight === -1
    || render >= preflight
    || setup.includes('setVariable')
    || setup.includes('deleteVariable')
  ) fail();
}

function verifyRotationContract(sources) {
  const rotate = sources.get('scripts/text-ai-access-code-rotate.mjs');
  for (const snippet of [
    "argument === '--target=user-1'",
    "argument === '--target=user-2'",
    "argument === '--resume=user-1'",
    "argument === '--resume=user-2'",
    'ROTATION BLOCKED deploy',
    'confirmation=ROTATE_ONE_TEXT_ACCESS_CODE',
  ]) if (!rotate.includes(snippet) && !sources.get('scripts/text-ai-preview-setup-github.mjs').includes(snippet)) fail();
  if (
    !rotate.includes('await invoke(parsed.github.setSecret, names[0], record.pepper);')
    || !rotate.includes('await invoke(parsed.github.setSecret, names[1], record.digest);')
    || !rotate.includes('if (selected.mode === \'resume\')')
  ) fail();
}

function verifyPackageContract(sources) {
  let pkg;
  try {
    pkg = JSON.parse(sources.get('package.json'));
  } catch {
    fail();
  }
  if (
    pkg?.scripts?.['rotate:text-preview-code'] !== 'node scripts/text-ai-access-code-rotate.mjs'
    || pkg?.scripts?.['test:text-access-code-rotate'] !== 'node --test scripts/text-ai-access-code-rotate.test.mjs'
  ) fail();
}

export function verifyTextPreviewSetup(value) {
  const sources = exactSources(value);
  verifyForbiddenCapabilities(sources);
  verifyValueContract(sources);
  verifyPromptContract(sources);
  verifyCloudflareContract(sources);
  verifySetupContract(sources);
  verifyRotationContract(sources);
  verifyPackageContract(sources);
  verifyHashes(sources);
  return { ...FIXED_REPORT };
}

async function readSources() {
  const entries = await Promise.all(EXPECTED_FILES.map(async (file) => [
    file,
    await readFile(resolve(file), 'utf8'),
  ]));
  return Object.fromEntries(entries);
}

async function runCli(argv) {
  try {
    if (!Array.isArray(argv) || argv.length !== 0) fail();
    const report = verifyTextPreviewSetup(await readSources());
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch {
    process.stderr.write(`${FAILURE}\n`);
    return 1;
  }
}

if (
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
