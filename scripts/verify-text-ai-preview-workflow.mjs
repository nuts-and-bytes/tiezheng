import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FAILURE_MESSAGE = 'Text preview workflow policy failed';
const WORKFLOW_PATH = resolve('.github/workflows/text-ai-preview.yml');
const MAX_WORKFLOW_BYTES = 1_048_576;
const EXPECTED_DISPATCH_SHA256 =
  '3669a359be89c2dfd0298811986d731f4cb894b3baf4d1207e37aef9f13020b3';
const EXPECTED_OPERATION_CASE_SHA256 =
  'ce301cfb0c26710bc3ed5c6a793aa20738c0b320572ad878ab2ec15f7d8e30c5';
const OPERATION_CHOICES = Object.freeze([
  'preflight',
  'deploy-disabled',
  'rotate-user-code',
  'enable-admin-preview',
  'status',
  'deploy-diagnostics',
  'enable-second-account',
  'disable-account',
  'disable-all',
  'delete-account',
]);
const TARGET_CHOICES = Object.freeze(['user-1', 'user-2']);
const STEP_NAMES = Object.freeze([
  'Checkout',
  'Set up Node 22',
  'Install dependencies',
  'Typecheck',
  'Unit tests',
  'Edge typecheck',
  'Edge tests',
  'Build text-only preview',
  'Verify preview workflow policy',
  'Worker dry-run',
  'Dispatch fixed operation',
]);
const SECRET_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN',
  'DEEPSEEK_API_KEY',
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
const EXPECTED_DISPATCH_ENV = Object.freeze(new Map([
  ['TEXT_AI_OPERATION', '${{ inputs.operation }}'],
  ['TEXT_AI_TARGET', '${{ inputs.target }}'],
  ['TEXT_AI_CONFIRMATION', '${{ inputs.confirmation }}'],
  ['TEXT_AI_SECRET_FILE', '${{ runner.temp }}/text-ai-preview-secrets-${{ github.run_id }}-${{ github.run_attempt }}.json'],
  ['TEXT_AI_PREFLIGHT_FILE', '${{ runner.temp }}/text-ai-preview-preflight-${{ github.run_id }}-${{ github.run_attempt }}.json'],
  ['TEXT_AI_USER_1_STATUS_FILE', '${{ runner.temp }}/text-ai-preview-user-1-status-${{ github.run_id }}-${{ github.run_attempt }}.json'],
  ['TEXT_AI_USER_2_STATUS_FILE', '${{ runner.temp }}/text-ai-preview-user-2-status-${{ github.run_id }}-${{ github.run_attempt }}.json'],
  ['CLOUDFLARE_ACCOUNT_ID', '${{ vars.CLOUDFLARE_ACCOUNT_ID }}'],
  ...SECRET_NAMES.map((name) => [name, `\${{ secrets.${name} }}`]),
]));
const FORBIDDEN_ACCESS_SHAPES = Object.freeze([
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
  'disable-access',
]);
const FIXED_REPORT = Object.freeze({
  manualOnly: true,
  protectedEnvironment: true,
  productionDisabled: true,
  photoDisabled: true,
  maxProviderAttempts: 1,
  realRequestBudget: 1,
});

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function count(value, needle) {
  if (needle.length === 0) fail();
  let total = 0;
  let offset = 0;
  while (true) {
    const next = value.indexOf(needle, offset);
    if (next === -1) return total;
    total += 1;
    offset = next + needle.length;
  }
}

function exactStrings(actual, expected) {
  if (
    actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])
  ) {
    fail();
  }
}

function extractBetween(source, startMarker, endMarker, from = 0) {
  const start = source.indexOf(startMarker, from);
  if (start === -1 || source.indexOf(startMarker, start + startMarker.length) !== -1) fail();
  const bodyStart = start + startMarker.length;
  const end = source.indexOf(endMarker, bodyStart);
  if (end === -1) fail();
  return source.slice(bodyStart, end);
}

function extractChoiceOptions(source, inputName, nextInputName) {
  const block = extractBetween(
    source,
    `      ${inputName}:\n`,
    `      ${nextInputName}:\n`,
  );
  const optionsMarker = '        options:\n';
  const optionsStart = block.indexOf(optionsMarker);
  if (optionsStart === -1 || count(block, optionsMarker) !== 1) fail();
  return block
    .slice(optionsStart + optionsMarker.length)
    .split('\n')
    .filter((line) => line.startsWith('          - '))
    .map((line) => line.slice('          - '.length));
}

function extractDispatch(source) {
  const stepMarker = '      - name: Dispatch fixed operation\n';
  const stepStart = source.indexOf(stepMarker);
  if (stepStart === -1 || count(source, stepMarker) !== 1) fail();
  const runMarker = '        run: |\n';
  const runStart = source.indexOf(runMarker, stepStart);
  if (runStart === -1) fail();
  const lines = source.slice(runStart + runMarker.length).split('\n');
  const output = [];
  for (const line of lines) {
    if (line === '') {
      output.push('');
    } else if (line.startsWith('          ')) {
      output.push(line.slice(10));
    } else {
      fail();
    }
  }
  while (output.at(-1) === '') output.pop();
  if (output.length === 0) fail();
  return output.join('\n');
}

function extractOperationCase(dispatch) {
  const marker = 'case "$TEXT_AI_OPERATION" in';
  const start = dispatch.indexOf(marker);
  const end = dispatch.lastIndexOf('esac');
  if (start === -1 || end <= start || count(dispatch, marker) !== 1) fail();
  return dispatch.slice(start, end + 'esac'.length);
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseDispatchEnv(source) {
  const stepMarker = '      - name: Dispatch fixed operation\n';
  const stepStart = source.indexOf(stepMarker);
  const envMarker = '        env:\n';
  const envStart = source.indexOf(envMarker, stepStart);
  const runStart = source.indexOf('        run: |\n', envStart);
  if (stepStart === -1 || envStart === -1 || runStart === -1) fail();
  const result = new Map();
  for (const line of source.slice(envStart + envMarker.length, runStart).trimEnd().split('\n')) {
    const match = /^          ([A-Z0-9_]+): (.+)$/.exec(line);
    if (match === null || result.has(match[1])) fail();
    result.set(match[1], match[2]);
  }
  return result;
}

function verifyTopLevel(source) {
  if (
    (source.match(/^on:$/gmu)?.length ?? 0) !== 1
    || (source.match(/^  workflow_dispatch:$/gmu)?.length ?? 0) !== 1
    || /^  (push|pull_request|schedule|workflow_call|repository_dispatch):/mu.test(source)
    || (source.match(/^jobs:$/gmu)?.length ?? 0) !== 1
    || (source.match(/^  text-ai-preview:$/gmu)?.length ?? 0) !== 1
    || !source.includes('concurrency:\n  group: text-ai-preview\n  cancel-in-progress: false\n')
  ) {
    fail();
  }
  exactStrings(extractChoiceOptions(source, 'operation', 'target'), OPERATION_CHOICES);
  exactStrings(extractChoiceOptions(source, 'target', 'expected_sha'), TARGET_CHOICES);
}

function verifyJob(source) {
  const required = [
    "    if: github.ref == 'refs/heads/main' && github.ref_protected == true && github.sha == inputs.expected_sha\n",
    '    environment: text-ai-preview\n',
    '    permissions:\n      contents: read\n',
    '    runs-on: ubuntu-latest\n',
    '    timeout-minutes: 30\n',
    '        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5\n',
    '        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n',
    '          ref: ${{ github.sha }}\n',
    '          persist-credentials: false\n',
  ];
  for (const item of required) if (count(source, item) !== 1) fail();
  const steps = [...source.matchAll(/^      - name: (.+)$/gmu)].map((match) => match[1]);
  exactStrings(steps, STEP_NAMES);
  const uses = [...source.matchAll(/^        uses: (.+)$/gmu)].map((match) => match[1]);
  exactStrings(uses, [
    'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  ]);
}

function verifyEnvironment(source) {
  const actual = parseDispatchEnv(source);
  if (actual.size !== EXPECTED_DISPATCH_ENV.size) fail();
  for (const [name, value] of EXPECTED_DISPATCH_ENV) {
    if (actual.get(name) !== value) fail();
  }
  const secretReferences = [...source.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/gu)]
    .map((match) => match[1]);
  exactStrings([...new Set(secretReferences)].sort(), [...SECRET_NAMES].sort());
  if (secretReferences.length !== SECRET_NAMES.length) fail();
  const variableReferences = [...source.matchAll(/\$\{\{ vars\.([A-Z0-9_]+) \}\}/gu)]
    .map((match) => match[1]);
  exactStrings(variableReferences, ['CLOUDFLARE_ACCOUNT_ID']);
}

function verifyDispatch(source) {
  const dispatch = extractDispatch(source);
  const operationCase = extractOperationCase(dispatch);
  if (
    sha256(dispatch) !== EXPECTED_DISPATCH_SHA256
    || sha256(operationCase) !== EXPECTED_OPERATION_CASE_SHA256
    || !dispatch.startsWith('set -euo pipefail\numask 077\n')
    || count(dispatch, 'trap cleanup_preview_temp_files EXIT') !== 1
    || count(dispatch, '# REAL_TEXT_AI_REQUEST_BUDGET: 1') !== 1
    || count(dispatch, '# NO_REAL_MEAL_REQUEST_IN_WORKFLOW') !== 1
  ) {
    fail();
  }
  const rotateStart = operationCase.indexOf('rotate-user-code)');
  const rotateEnd = operationCase.indexOf('enable-admin-preview)', rotateStart);
  const rotate = operationCase.slice(rotateStart, rotateEnd);
  if (
    rotateStart === -1
    || rotateEnd === -1
    || count(rotate, 'ROTATE_ONE_TEXT_ACCESS_CODE') !== 1
    || count(rotate, 'text-ai-preview-control.mjs configure > /dev/null') !== 1
    || count(rotate, 'deploy_pages_preview') !== 1
    || rotate.includes('invoke-admin')
    || rotate.includes('deploy_worker_')
    || rotate.includes('write_worker_secret_file')
  ) {
    fail();
  }
  const disableStart = operationCase.indexOf('disable-all)');
  const disableEnd = operationCase.indexOf('delete-account)', disableStart);
  const disable = operationCase.slice(disableStart, disableEnd);
  if (
    disableStart === -1
    || disableEnd === -1
    || count(disable, '--operation=disable-text-global --target=user-1') !== 1
    || count(disable, 'deploy_worker_disabled') !== 1
    || !disable.includes("['disable-text-global', 'deploy-worker-disabled']")
    || disable.includes('disable-access')
  ) {
    fail();
  }
  for (const forbidden of [
    'set -x',
    'set -eux',
    'printenv',
    'GITHUB_OUTPUT',
    'GITHUB_ENV',
    'upload-artifact',
    'curl ',
    'wget ',
    'eval ',
  ]) {
    if (dispatch.includes(forbidden)) fail();
  }
}

function verifyFixedRuntime(source) {
  for (const forbidden of FORBIDDEN_ACCESS_SHAPES) {
    if (source.toLowerCase().includes(forbidden.toLowerCase())) fail();
  }
  const required = [
    "          VITE_ENABLE_TEXT_AI: 'true'\n",
    "          VITE_ENABLE_PHOTO_AI: 'false'\n",
    '--branch=text-ai-preview --commit-hash="$GITHUB_SHA"',
    'TEXT_AI_DIAGNOSTICS_ENABLED:false',
    'TEXT_AI_DIAGNOSTICS_ENABLED:true',
    'TEXT_AI_MAX_PROVIDER_ATTEMPTS:1',
    'PHOTO_AI_GATEWAY_ENABLED:false',
    'TEXT_AI_MODEL:deepseek-v4-flash',
    'PHOTO_AI_MODEL:doubao-seed-2-1-pro-260628',
    'PHOTO_AI_ALLOWED_ORIGINS:https://text-ai-preview.tiezheng.pages.dev',
    'PHOTO_AI_MONTHLY_BUDGET_MICROS:50000000',
  ];
  for (const item of required) if (!source.includes(item)) fail();
  const dryRunStart = source.indexOf('      - name: Worker dry-run\n');
  const dryRunEnd = source.indexOf('      - name: Dispatch fixed operation\n', dryRunStart + 1);
  const dryRun = dryRunStart === -1 || dryRunEnd === -1
    ? ''
    : source.slice(dryRunStart, dryRunEnd);
  if (
    dryRun.length === 0
    || count(dryRun, '--dry-run') !== 1
    || count(dryRun, 'TEXT_AI_DIAGNOSTICS_ENABLED:false') !== 1
    || dryRun.includes('TEXT_AI_DIAGNOSTICS_ENABLED:true')
    || source.includes('--branch=main')
    || source.includes('/api/nutrition/text/estimate')
    || source.includes('ark.cn')
    || source.includes('volces.com')
  ) {
    fail();
  }
}

export function verifyTextPreviewWorkflow(source) {
  if (
    typeof source !== 'string'
    || Buffer.byteLength(source, 'utf8') === 0
    || Buffer.byteLength(source, 'utf8') > MAX_WORKFLOW_BYTES
    || source.includes('\u0000')
    || source.includes('\r')
    || !source.endsWith('\n')
  ) {
    fail();
  }
  verifyTopLevel(source);
  verifyJob(source);
  verifyEnvironment(source);
  verifyFixedRuntime(source);
  verifyDispatch(source);
  return { ...FIXED_REPORT };
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
  try {
    const source = await readFile(WORKFLOW_PATH, 'utf8');
    process.stdout.write(`${JSON.stringify(verifyTextPreviewWorkflow(source))}\n`);
  } catch {
    process.stderr.write(`${FAILURE_MESSAGE}\n`);
    process.exitCode = 1;
  }
}
