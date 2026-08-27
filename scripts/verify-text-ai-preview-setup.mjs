import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FAILURE_MESSAGE = 'Setup policy failed';
const MAX_SOURCE_BYTES = 1_048_576;
const SETUP_SOURCE_PREFIX = 'text-ai-preview-setup';

export const EXPECTED_FILES = Object.freeze([
  'scripts/text-ai-preview-setup-values.mjs',
  'scripts/text-ai-preview-setup-prompt.mjs',
  'scripts/text-ai-preview-setup-cloudflare.mjs',
  'scripts/text-ai-preview-setup-github.mjs',
  'scripts/text-ai-preview-setup.mjs',
]);
const EXPECTED_TEST_NAMES = Object.freeze(EXPECTED_FILES.map((file) => (
  `${basename(file, '.mjs')}.test.mjs`
)));

const EXPECTED_DIGESTS = Object.freeze({
  'scripts/text-ai-preview-setup-values.mjs': '5ac51ec36f81ccc1efd680bf9332dbdc44d5bc8804d47dd68a5b272fd25d50a3',
  'scripts/text-ai-preview-setup-prompt.mjs': 'eb04f7afe0dc9566c7d06b1c2595e16c4cf59005b567a380186902fe061a5c32',
  'scripts/text-ai-preview-setup-cloudflare.mjs': '4e1c711426a85553708606d529ce4fc8bbabdaf8ecbe98fb5e84afa3cb901961',
  'scripts/text-ai-preview-setup-github.mjs': 'a331ff8bfec61604f078ceb50f3e17bde9e0ea9b1acaf869be870ac1abef1cdf',
  'scripts/text-ai-preview-setup.mjs': '11e30f582b0a61f99b77140073eb307bdb13238eba39a98b1c743818fd1e73d0',
});

const FIXED_REPORT = Object.freeze({
  fourInputs: true,
  stdinOnlySecrets: true,
  firstRunOnly: true,
  deploymentDisabled: true,
  modelCalls: 0,
});
const FIXED_JSON = '{"fourInputs":true,"stdinOnlySecrets":true,"firstRunOnly":true,"deploymentDisabled":true,"modelCalls":0}';

const FORBIDDEN = /\b(?:wrangler|deploy|enable)\b|\bpages\s+deploy\b|deploy-disabled|enable-admin-preview|enable-account|\/api\/nutrition\/text\/(?:session|estimate)|shell:\s*true|--body|(?<!\.)\b(?:eval|exec)\s*\(|\b(?:curl|wget)\b|\b(?:writeFile|createWriteStream)\b|process\.env\.(?:ARK_API_KEY|CLOUDFLARE_API_TOKEN)|console\.(?:log|dir|table)/u;
const EXTRA_EXECUTABLE_FAMILY = /\b(?:python(?:3)?|ruby|perl|php|java|bash|zsh|fish|powershell|pwsh|npx)\b|\bnpm\s+exec\b|\bnode\s+(?:--input-type=module\s+)?-e\b/u;
const FORBIDDEN_PROCESS_API = /\b(?:spawnSync|execFile|execFileSync|fork)\b|\b(?:Bun\.spawn|Deno\.Command)\b/u;
const FORBIDDEN_FILESYSTEM_API = /from\s+['"]node:fs(?:\/promises)?['"]|\b(?:appendFile|openSync|writeSync|writeFileSync|createWriteStream)\b/u;

const PROMPT_LABEL_BLOCK = `const PROMPT_LABELS = new Set([
  'Cloudflare API Token',
  'ARK_API_KEY',
  'user-1 email',
  'user-2 email',
  'Continue? [y/N]',
]);`;
const FOUR_INPUT_BLOCK = `    for (const [label, hidden] of [
      ['Cloudflare API Token', true],
      ['ARK_API_KEY', true],
      ['user-1 email', false],
      ['user-2 email', false],
    ]) {`;
const SECRET_POLICY_BLOCK = `  secretNames: Object.freeze([
    'CLOUDFLARE_API_TOKEN',
    'ARK_API_KEY',
    'PHOTO_AI_CACHE_AES_KEY',
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
    'TEXT_AI_USER_1_EMAIL',
    'TEXT_AI_USER_2_EMAIL',
    'TEXT_AI_ADMIN_EMAIL',
    'TEXT_AI_CF_ACCESS_CLIENT_ID',
    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
  ]),`;
const SECRET_WRITE_BLOCK = `    const secrets = Object.freeze([
      entry('CLOUDFLARE_API_TOKEN', inputs.cloudflareApiToken),
      entry('ARK_API_KEY', inputs.arkApiKey),
      entry('PHOTO_AI_CACHE_AES_KEY', keys.aesKey),
      entry('PHOTO_AI_ACCOUNT_HMAC_KEY', keys.hmacKey),
      entry('TEXT_AI_USER_1_EMAIL', inputs.user1Email),
      entry('TEXT_AI_USER_2_EMAIL', inputs.user2Email),
      entry('TEXT_AI_ADMIN_EMAIL', inputs.user1Email),
      entry('TEXT_AI_CF_ACCESS_CLIENT_ID', args.serviceClientId),
      entry('TEXT_AI_CF_ACCESS_CLIENT_SECRET', args.serviceClientSecret),
    ]);`;
const SUCCESS_OUTPUT = "const SUCCESS_OUTPUT = 'SETUP COMPLETE\\nsecrets=9 variables=2 preflight=pass workerTextEnabled=false photoEnabled=false\\n';";

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function countOccurrences(value, needle) {
  if (typeof value !== 'string' || typeof needle !== 'string' || needle.length === 0) fail();
  let count = 0;
  let offset = 0;
  while (true) {
    const next = value.indexOf(needle, offset);
    if (next === -1) return count;
    count += 1;
    offset = next + needle.length;
  }
}

function requireCount(source, snippet, expected = 1) {
  if (countOccurrences(source, snippet) !== expected) fail();
}

function snapshotSources(value) {
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
    let totalBytes = 0;
    for (const file of EXPECTED_FILES) {
      const descriptor = Object.getOwnPropertyDescriptor(value, file);
      if (
        descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true
        || typeof descriptor.value !== 'string'
      ) fail();
      const source = descriptor.value;
      const bytes = Buffer.byteLength(source, 'utf8');
      totalBytes += bytes;
      if (
        bytes < 1
        || bytes > MAX_SOURCE_BYTES
        || totalBytes > MAX_SOURCE_BYTES * EXPECTED_FILES.length
        || source.includes('\0')
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

function verifyDigests(sources) {
  for (const file of EXPECTED_FILES) {
    const digest = createHash('sha256').update(sources.get(file), 'utf8').digest('hex');
    if (digest !== EXPECTED_DIGESTS[file]) fail();
  }
}

function verifyNoForbiddenCapabilities(sources) {
  for (const file of EXPECTED_FILES) {
    const source = sources.get(file);
    if (
      FORBIDDEN.test(source)
      || EXTRA_EXECUTABLE_FAMILY.test(source)
      || FORBIDDEN_PROCESS_API.test(source)
      || FORBIDDEN_FILESYSTEM_API.test(source)
    ) fail();
    if (
      file !== 'scripts/text-ai-preview-setup-github.mjs'
      && source.includes("node:child_process")
    ) fail();
  }
}

function verifyPromptContract(sources) {
  const prompt = sources.get('scripts/text-ai-preview-setup-prompt.mjs');
  requireCount(prompt, PROMPT_LABEL_BLOCK);
  requireCount(prompt, FOUR_INPUT_BLOCK);
  requireCount(prompt, "    label: 'Continue? [y/N]',");
  requireCount(prompt, "    maxBytes: 1,");
  requireCount(prompt, "    return answer.toString('utf8') === 'y';");
  for (const label of ['Cloudflare API Token', 'ARK_API_KEY', 'user-1 email', 'user-2 email']) {
    requireCount(prompt, `'${label}'`, 2);
  }
  requireCount(prompt, "'Continue? [y/N]'", 2);
}

function verifyValueContract(sources) {
  const values = sources.get('scripts/text-ai-preview-setup-values.mjs');
  requireCount(values, SECRET_POLICY_BLOCK);
  requireCount(values, SECRET_WRITE_BLOCK);
  requireCount(values, "  variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN']),");
  requireCount(values, "    variables: Object.freeze([entry('TEXT_AI_TEAM_DOMAIN', teamDomain)]),");
  requireCount(values, "  serviceTokenName: 'tiezheng-text-ai-preview-github-actions',");
  requireCount(values, "  serviceTokenDuration: '8760h',");
}

function verifyCloudflareContract(sources) {
  const cloudflare = sources.get('scripts/text-ai-preview-setup-cloudflare.mjs');
  requireCount(cloudflare, `  const body = Object.freeze({
    name: SETUP_POLICY.serviceTokenName,
    duration: SETUP_POLICY.serviceTokenDuration,
    enabled: true,
  });`);
  requireCount(cloudflare, "    if (name === SETUP_POLICY.serviceTokenName) fail();");
  requireCount(cloudflare, "    && data.get('name') === SETUP_POLICY.serviceTokenName");
  requireCount(cloudflare, "    && data.get('duration') === SETUP_POLICY.serviceTokenDuration");
}

function verifyGitHubContract(sources) {
  const github = sources.get('scripts/text-ai-preview-setup-github.mjs');
  requireCount(github, "import { spawn } from 'node:child_process';");
  requireCount(github, 'node:child_process');
  requireCount(github, 'child_process');
  if (
    (github.match(/\bspawn\b/gu) ?? []).length !== 2
    || (github.match(/\bspawnCommand\b/gu) ?? []).length !== 5
    || (github.match(/\bcreateBoundedCommandRunner\b/gu) ?? []).length !== 3
  ) fail();
  requireCount(
    github,
    'const child = Reflect.apply(spawnCommand, undefined, [command, safeArguments, {',
  );
  requireCount(github, 'const BOUNDED_COMMAND_RUNNER = createBoundedCommandRunner(spawn);');
  requireCount(github, "      if (command !== 'git' && command !== 'gh') fail();");
  requireCount(github, '          shell: false,');
  requireCount(github, "          stdio: ['pipe', 'pipe', 'pipe'],");
  requireCount(github, '          else child.stdin.end(safeInput);');
  requireCount(github, "      await run('gh', args, { input: value });");
  requireCount(github, "    const args = ['secret', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];");
  requireCount(github, "    const args = ['variable', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];");
  requireCount(github, "const WRITABLE_VARIABLE_NAMES = Object.freeze(['TEXT_AI_TEAM_DOMAIN']);");
  requireCount(github, '      if (secretNames.size !== 0) fail();');
  requireCount(github, '      exactNames(variableNames, [ACCOUNT_VARIABLE]);');
  requireCount(github, "        '-f', 'operation=preflight',");
  requireCount(github, "        '-f', 'target=user-1',");
  requireCount(github, "        '-f', `expected_sha=${expectedSha}`,");
  requireCount(github, 'const REPORT_LINE = \'{"command":"preflight","status":"ready","workerTextEnabled":false}\';');
  requireCount(github, '    || report.workerTextEnabled !== false');
}

function verifyOrchestrationContract(sources) {
  const setup = sources.get('scripts/text-ai-preview-setup.mjs');
  for (const output of [
    "const FAILED_OUTPUT = 'SETUP FAILED\\n';",
    "const CANCELLED_OUTPUT = 'SETUP CANCELLED\\n';",
    "const PREFLIGHT_BLOCKED_OUTPUT = 'SETUP BLOCKED preflight\\n';",
    "const REPORT_BLOCKED_OUTPUT = 'SETUP BLOCKED output\\n';",
    SUCCESS_OUTPUT,
    "'SETUP BLOCKED cleanup=cloudflare.service-token\\n'",
    "`SETUP BLOCKED cleanup=${blocked.join(',')}\\n`",
  ]) requireCount(setup, output);
  requireCount(setup, "    secrets: snapshotWriteGroup(record.secrets, SETUP_POLICY.secretNames),");
  requireCount(setup, "    variables: snapshotWriteGroup(record.variables, ['TEXT_AI_TEAM_DOMAIN']),");
  requireCount(setup, '    await invoke(parsed.github.runDisabledPreflight, githubState.expectedSha);');
  requireCount(setup, '    for (const item of writePlan.secrets) {');
  requireCount(setup, '    for (const item of writePlan.variables) {');
  requireCount(setup, '    phase = \'complete\';');
}

function verifySemantics(value) {
  const sources = snapshotSources(value);
  verifyNoForbiddenCapabilities(sources);
  verifyPromptContract(sources);
  verifyValueContract(sources);
  verifyCloudflareContract(sources);
  verifyGitHubContract(sources);
  verifyOrchestrationContract(sources);
  return sources;
}

export function verifyTextPreviewSetupSemanticsForTest(value) {
  try {
    verifySemantics(value);
    return Object.freeze({ ...FIXED_REPORT });
  } catch {
    fail();
  }
}

export function verifyTextPreviewSetup(value) {
  try {
    const sources = verifySemantics(value);
    verifyDigests(sources);
    return Object.freeze({ ...FIXED_REPORT });
  } catch {
    fail();
  }
}

function sameStrings(actual, expected) {
  if (actual.length !== expected.length) fail();
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) fail();
  }
}

async function runCli(argv) {
  try {
    if (
      !Array.isArray(argv)
      || Object.getPrototypeOf(argv) !== Array.prototype
      || argv.length !== 0
    ) fail();

    const names = await readdir(resolve('scripts'), { encoding: 'utf8' });
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) fail();
    const discovered = names
      .filter((name) => (
        name.startsWith(SETUP_SOURCE_PREFIX) && !EXPECTED_TEST_NAMES.includes(name)
      ))
      .map((name) => `scripts/${name}`)
      .sort();
    sameStrings(discovered, [...EXPECTED_FILES].sort());

    const entries = await Promise.all(EXPECTED_FILES.map(async (file) => (
      [file, await readFile(resolve(file), 'utf8')]
    )));
    verifyTextPreviewSetup(Object.fromEntries(entries));
    process.stdout.write(`${FIXED_JSON}\n`);
    return 0;
  } catch {
    try {
      process.stderr.write(`${FAILURE_MESSAGE}\n`);
    } catch {
      // The fixed exit status is sufficient if the output channel itself fails.
    }
    return 1;
  }
}

function isDirectExecution() {
  try {
    return (
      typeof process.argv[1] === 'string'
      && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
