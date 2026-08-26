import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FAILURE_MESSAGE = 'Text preview workflow policy failed';
const MAX_WORKFLOW_BYTES = 1_048_576;
const EXPECTED_DISPATCH_SHA256 = '5efa3a7b367efc06f89f6ff733c243a12cd0dd01c297d634b8adb7103b9264cf';
const EXPECTED_OPERATION_CASE_SHA256 = '1f9867044d07529750db2dcecf75d1cbdaf853efdd390cf51221f29319d13d4c';
const CHECKOUT_ACTION = 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5';
const SETUP_NODE_ACTION = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
const OPERATION_CHOICES = Object.freeze([
  'preflight',
  'deploy-disabled',
  'enable-admin-preview',
  'status',
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
const WORKER_CONFIG = 'workers/photo-ai-gateway/wrangler.jsonc';
const WORKER_VARS_DISABLED = Object.freeze([
  'TEXT_AI_ADMIN_ENABLED:false',
  'TEXT_AI_GATEWAY_ENABLED:false',
  'TEXT_AI_MAX_PROVIDER_ATTEMPTS:1',
  'TEXT_AI_MODEL:doubao-seed-2-1-pro-260628',
  'PHOTO_AI_GATEWAY_ENABLED:false',
  'PHOTO_AI_MODEL:doubao-seed-2-1-pro-260628',
  'PHOTO_AI_ALLOWED_ORIGINS:https://text-ai-preview.tiezheng.pages.dev',
  'PHOTO_AI_MONTHLY_BUDGET_MICROS:50000000',
]);
const WORKER_VARS_ENABLED = Object.freeze(WORKER_VARS_DISABLED.map((value) => (
  value === 'TEXT_AI_ADMIN_ENABLED:false'
    ? 'TEXT_AI_ADMIN_ENABLED:true'
    : value === 'TEXT_AI_GATEWAY_ENABLED:false'
      ? 'TEXT_AI_GATEWAY_ENABLED:true'
      : value
)));

function workerVarArguments(values) {
  return values.map((value) => `--var "${value}"`).join(' ');
}

const WRANGLER_DRY_RUN = `./node_modules/.bin/wrangler deploy --dry-run --config ${WORKER_CONFIG} --outdir "$RUNNER_TEMP/text-ai-worker-dry-run" ${workerVarArguments(WORKER_VARS_DISABLED)}`;
const WRANGLER_DEPLOY_DISABLED = `./node_modules/.bin/wrangler deploy --config ${WORKER_CONFIG} ${workerVarArguments(WORKER_VARS_DISABLED.map((value) => (
  value === 'TEXT_AI_ADMIN_ENABLED:false' ? 'TEXT_AI_ADMIN_ENABLED:true' : value
)))}`;
const WRANGLER_DEPLOY_ENABLED = `./node_modules/.bin/wrangler deploy --config ${WORKER_CONFIG} --secrets-file "$TEXT_AI_SECRET_FILE" ${workerVarArguments(WORKER_VARS_ENABLED)}`;
const WRANGLER_PAGES_DEPLOY = './node_modules/.bin/wrangler pages deploy dist --project-name=tiezheng --branch=text-ai-preview --commit-hash="$GITHUB_SHA"';
const EXPECTED_WRANGLER_COMMANDS = Object.freeze([
  WRANGLER_DRY_RUN,
  WRANGLER_DEPLOY_DISABLED,
  WRANGLER_DEPLOY_ENABLED,
  WRANGLER_PAGES_DEPLOY,
]);
const EXPECTED_CONTROL_COMMANDS = Object.freeze([
  'node scripts/text-ai-preview-control.mjs preflight > "$TEXT_AI_PREFLIGHT_FILE"',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=user-1 > "$TEXT_AI_USER_1_STATUS_FILE"',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=user-2 > "$TEXT_AI_USER_2_STATUS_FILE"',
  'node scripts/text-ai-preview-control.mjs configure > /dev/null',
  'node scripts/text-ai-preview-control.mjs configure > /dev/null',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-1 > /dev/null',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-text-global --target=user-1 > /dev/null',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=user-1 > "$TEXT_AI_USER_1_STATUS_FILE"',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=user-2 > "$TEXT_AI_USER_2_STATUS_FILE"',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-2 > /dev/null',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=disable-account --target=user-1 > /dev/null',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=disable-account --target=user-2 > /dev/null',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=disable-text-global --target=user-1 > /dev/null',
  'node scripts/text-ai-preview-control.mjs disable-access > /dev/null',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=delete-account --target=user-1 > /dev/null',
  'node scripts/text-ai-preview-control.mjs invoke-admin --operation=delete-account --target=user-2 > /dev/null',
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
  ['CLOUDFLARE_API_TOKEN', '${{ secrets.CLOUDFLARE_API_TOKEN }}'],
  ['TEXT_AI_TEAM_DOMAIN', '${{ vars.TEXT_AI_TEAM_DOMAIN }}'],
  ['TEXT_AI_ALLOWED_EMAIL_COUNT', "'2'"],
  ['TEXT_AI_USER_1_EMAIL', '${{ secrets.TEXT_AI_USER_1_EMAIL }}'],
  ['TEXT_AI_USER_2_EMAIL', '${{ secrets.TEXT_AI_USER_2_EMAIL }}'],
  ['TEXT_AI_ADMIN_EMAIL', '${{ secrets.TEXT_AI_ADMIN_EMAIL }}'],
  ['TEXT_AI_CF_ACCESS_CLIENT_ID', '${{ secrets.TEXT_AI_CF_ACCESS_CLIENT_ID }}'],
  ['TEXT_AI_CF_ACCESS_CLIENT_SECRET', '${{ secrets.TEXT_AI_CF_ACCESS_CLIENT_SECRET }}'],
  ['PHOTO_AI_ACCOUNT_HMAC_KEY', '${{ secrets.PHOTO_AI_ACCOUNT_HMAC_KEY }}'],
  ['ARK_API_KEY', "${{ inputs.operation == 'enable-admin-preview' && secrets.ARK_API_KEY || '' }}"],
  ['PHOTO_AI_CACHE_AES_KEY', "${{ inputs.operation == 'enable-admin-preview' && secrets.PHOTO_AI_CACHE_AES_KEY || '' }}"],
]));
const EXPECTED_EXPRESSIONS = Object.freeze([
  '${{ github.sha }}',
  ...[...EXPECTED_DISPATCH_ENV.values()]
    .flatMap((value) => value.match(/\$\{\{[^}\n]*\}\}/g) ?? []),
].sort());
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

function countOccurrences(value, needle) {
  if (needle.length === 0) fail();
  let count = 0;
  let offset = 0;
  while (true) {
    const next = value.indexOf(needle, offset);
    if (next === -1) return count;
    count += 1;
    offset = next + needle.length;
  }
}

function sameStrings(actual, expected) {
  if (actual.length !== expected.length) fail();
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) fail();
  }
}

function indentation(line) {
  return line.length - line.trimStart().length;
}

function meaningful(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith('#');
}

function findUniqueExact(lines, expectedIndent, text) {
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (indentation(lines[index]) === expectedIndent && lines[index].trim() === text) {
      matches.push(index);
    }
  }
  if (matches.length !== 1) fail();
  return matches[0];
}

function blockEnd(lines, start) {
  const baseIndent = indentation(lines[start]);
  for (let index = start + 1; index < lines.length; index += 1) {
    if (meaningful(lines[index]) && indentation(lines[index]) <= baseIndent) return index;
  }
  return lines.length;
}

function directMappings(lines, start, end, expectedIndent) {
  const entries = [];
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (!meaningful(line) || indentation(line) !== expectedIndent) continue;
    const match = line.match(/^\s*([A-Za-z0-9_-]+):(.*)$/);
    if (match === null) fail();
    entries.push(Object.freeze({ key: match[1], value: match[2].trim(), index }));
  }
  const keys = entries.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) fail();
  return entries;
}

function mappingByKey(entries, key) {
  const matches = entries.filter((entry) => entry.key === key);
  if (matches.length !== 1) fail();
  return matches[0];
}

function requireEntryOrder(entries, keys) {
  sameStrings(entries.map(({ key }) => key), keys);
}

function listItems(lines, entry, parentEnd, expectedIndent) {
  const end = Math.min(blockEnd(lines, entry.index), parentEnd);
  const values = [];
  for (let index = entry.index + 1; index < end; index += 1) {
    const line = lines[index];
    if (!meaningful(line)) continue;
    if (indentation(line) !== expectedIndent) fail();
    const match = line.match(/^\s*- ([A-Za-z0-9-]+)$/);
    if (match === null) fail();
    values.push(match[1]);
  }
  return values;
}

function verifyInput(lines, inputEntry, inputEnd, expected) {
  if (inputEntry.value !== '') fail();
  const end = Math.min(blockEnd(lines, inputEntry.index), inputEnd);
  const properties = directMappings(lines, inputEntry.index + 1, end, 8);
  const allowed = new Set(['description', 'type', 'required', 'default', 'options']);
  if (properties.some(({ key }) => !allowed.has(key))) fail();
  const propertyMap = new Map(properties.map((entry) => [entry.key, entry]));
  if (
    !propertyMap.has('description')
    || propertyMap.get('description').value.length === 0
    || propertyMap.get('type')?.value !== expected.type
    || propertyMap.get('required')?.value !== expected.required
  ) {
    fail();
  }
  if (expected.default === undefined) {
    if (propertyMap.has('default')) fail();
  } else if (propertyMap.get('default')?.value !== expected.default) {
    fail();
  }
  if (expected.options === undefined) {
    if (propertyMap.has('options')) fail();
  } else {
    const optionEntry = propertyMap.get('options');
    if (optionEntry?.value !== '') fail();
    sameStrings(listItems(lines, optionEntry, end, 10), expected.options);
  }
}

function verifyManualInputs(lines) {
  const onIndex = findUniqueExact(lines, 0, 'on:');
  const onEnd = blockEnd(lines, onIndex);
  const triggers = directMappings(lines, onIndex + 1, onEnd, 2);
  requireEntryOrder(triggers, ['workflow_dispatch']);
  if (triggers[0].value !== '') fail();

  const dispatchEnd = Math.min(blockEnd(lines, triggers[0].index), onEnd);
  const dispatchMappings = directMappings(lines, triggers[0].index + 1, dispatchEnd, 4);
  requireEntryOrder(dispatchMappings, ['inputs']);
  if (dispatchMappings[0].value !== '') fail();

  const inputsEnd = Math.min(blockEnd(lines, dispatchMappings[0].index), dispatchEnd);
  const inputs = directMappings(lines, dispatchMappings[0].index + 1, inputsEnd, 6);
  requireEntryOrder(inputs, ['operation', 'target', 'confirmation']);
  verifyInput(lines, inputs[0], inputsEnd, {
    type: 'choice',
    required: 'true',
    options: OPERATION_CHOICES,
  });
  verifyInput(lines, inputs[1], inputsEnd, {
    type: 'choice',
    required: 'true',
    default: 'user-1',
    options: TARGET_CHOICES,
  });
  verifyInput(lines, inputs[2], inputsEnd, {
    type: 'string',
    required: 'false',
  });
}

function verifyExactMapping(entries, expected) {
  if (entries.length !== expected.size) fail();
  for (const entry of entries) {
    if (!expected.has(entry.key) || expected.get(entry.key) !== entry.value) fail();
  }
}

function stepBlocks(lines, stepsEntry, jobEnd) {
  const stepsEnd = Math.min(blockEnd(lines, stepsEntry.index), jobEnd);
  const starts = [];
  for (let index = stepsEntry.index + 1; index < stepsEnd; index += 1) {
    const line = lines[index];
    if (!meaningful(line) || indentation(line) !== 6) continue;
    const match = line.match(/^\s*- name: (.+)$/);
    if (match === null || match[1].length === 0) fail();
    starts.push(Object.freeze({ name: match[1], index }));
  }
  sameStrings(starts.map(({ name }) => name), STEP_NAMES);
  return starts.map((start, index) => Object.freeze({
    ...start,
    end: index + 1 < starts.length ? starts[index + 1].index : stepsEnd,
  }));
}

function stepProperties(lines, step) {
  return directMappings(lines, step.index + 1, step.end, 8);
}

function scalarRun(lines, step, expected) {
  const properties = stepProperties(lines, step);
  requireEntryOrder(properties, ['run']);
  if (properties[0].value !== expected) fail();
}

function blockRun(lines, step, expectedProperties = ['run']) {
  const properties = stepProperties(lines, step);
  requireEntryOrder(properties, expectedProperties);
  const run = mappingByKey(properties, 'run');
  if (run.value !== '|') fail();
  const output = [];
  for (let index = run.index + 1; index < step.end; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      output.push('');
      continue;
    }
    if (indentation(line) < 10) fail();
    output.push(line.slice(10));
  }
  while (output.length > 0 && output.at(-1) === '') output.pop();
  return output.join('\n');
}

function sortedMatches(value, pattern) {
  return [...value.matchAll(pattern)].map((match) => match[0].trim()).sort();
}

function verifyShellPolicy(allRunScripts, dispatchScript) {
  if (
    /(^|\n)\s*set\s+-[^\n]*x/u.test(allRunScripts)
    || /(^|\n)\s*(?:echo|printf|printenv|env)(?:\s|$)/u.test(allRunScripts)
    || /\b(?:eval|bash\s+-c|curl|wget)\b/u.test(allRunScripts)
    || /\$\{\{[^\n]*\}\}/u.test(allRunScripts)
    || /\btoJson\s*\(/u.test(allRunScripts)
    || /\/api\/nutrition\/text\/(?:session|estimate)\b/u.test(allRunScripts)
  ) {
    fail();
  }

  const wranglerCommands = allRunScripts
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('./node_modules/.bin/wrangler '))
    .sort();
  sameStrings(wranglerCommands, [...EXPECTED_WRANGLER_COMMANDS].sort());

  const controlCommands = sortedMatches(
    dispatchScript,
    /node scripts\/text-ai-preview-control\.mjs(?: [^;\n]*)?/gu,
  );
  sameStrings(controlCommands, [...EXPECTED_CONTROL_COMMANDS].sort());

  const operationCaseStart = dispatchScript.indexOf('case "$TEXT_AI_OPERATION" in');
  const operationCase = dispatchScript.slice(operationCaseStart);
  if (
    operationCaseStart === -1
    || createHash('sha256').update(operationCase, 'utf8').digest('hex') !== EXPECTED_OPERATION_CASE_SHA256
  ) {
    fail();
  }

  const requiredSnippets = [
    'set -euo pipefail\numask 077',
    "if (process.env.TEXT_AI_OPERATION === 'preflight') {",
    'const canonicalStatus = Object.freeze({\n  textGlobalEnabled: value.textGlobalEnabled,',
    'process.stdout.write(`${JSON.stringify(canonicalStatus)}\\n`);',
    'trap cleanup_preview_temp_files EXIT\nif [ "$TEXT_AI_OPERATION" != \'disable-all\' ]; then\n  run_full_preflight\nfi\n\ncase "$TEXT_AI_OPERATION" in',
    'deploy-disabled)\n    assert_worker_disabled_preflight\n    node scripts/text-ai-preview-control.mjs configure > /dev/null\n    deploy_worker_disabled\n    deploy_pages_preview',
    "const stableFields = Object.freeze(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']);",
    '(before.mode & 0o777n) !== 0o600n',
    'value.workerTextEnabled !== false',
    'enable-admin-preview)\n    if [ "$TEXT_AI_TARGET" != \'user-1\' ] || [ "$TEXT_AI_CONFIRMATION" != \'ENABLE_ONE_TEXT_PREVIEW_ACCOUNT\' ]; then\n      exit 1\n    fi\n    write_worker_secret_file\n    capture_status_pair\n    assert_enable_admin_preconditions\n    node scripts/text-ai-preview-control.mjs configure > /dev/null',
    'arkKey.trim() !== arkKey',
    "const decodedAesKey = Buffer.from(aesKey, 'base64');",
    'decodedAesKey.length !== 32\n  || decodedAesKey.toString(\'base64\') !== aesKey',
    'enable-second-account)\n    if [ "$TEXT_AI_TARGET" != \'user-2\' ]; then\n      exit 1\n    fi\n    capture_status_pair\n    assert_enable_second_preconditions',
    'disable-all)\n    disable_failure_mask=0',
    "TEXT_AI_DISABLE_ACCESS_ATTEMPTED='false'\n    if [ \"$disable_failure_mask\" -eq 0 ]; then\n      TEXT_AI_DISABLE_ACCESS_ATTEMPTED='true'\n      if node scripts/text-ai-preview-control.mjs disable-access > /dev/null; then",
    'accessAttempted !== ((failureMask & 3) === 0)',
    'attempted: index < 2 || accessAttempted,',
    'delete-account)\n    if [ "$TEXT_AI_CONFIRMATION" != \'DELETE_TEXT_PREVIEW_ACCOUNT_STATE\' ]; then',
  ];
  for (const snippet of requiredSnippets) {
    if (countOccurrences(dispatchScript, snippet) !== 1) fail();
  }

  const exactCounts = new Map([
    ['assert_worker_disabled_preflight', 2],
    ['write_worker_secret_file', 2],
    ['/\\p{Cc}/u', 2],
    ['deploy_worker_disabled', 3],
    ['deploy_worker_enabled', 2],
    ['deploy_pages_preview', 2],
    ['$TEXT_AI_OPERATION', 2],
    ['$TEXT_AI_TARGET', 5],
    ['$TEXT_AI_CONFIRMATION', 2],
    ['$TEXT_AI_SECRET_FILE', 1],
    ['$GITHUB_SHA', 1],
    ['ENABLE_ONE_TEXT_PREVIEW_ACCOUNT', 1],
    ['DELETE_TEXT_PREVIEW_ACCOUNT_STATE', 1],
    ['# REAL_TEXT_AI_REQUEST_BUDGET: 1', 1],
    ['# NO_REAL_MEAL_REQUEST_IN_WORKFLOW', 1],
    ["node --input-type=module <<'NODE'", 8],
    ["{ flag: 'wx', mode: 0o600 }", 1],
    ['await chmod(path, 0o600);', 1],
    ['await Promise.all(paths.map((path) => rm(path, { force: true })));', 1],
    ['process.stdout.write', 3],
    ['TEXT_AI_DISABLE_ACCESS_ATTEMPTED', 5],
  ]);
  for (const [needle, count] of exactCounts) {
    if (countOccurrences(dispatchScript, needle) !== count) fail();
  }
  if (dispatchScript.includes('PHOTO_AI_ACCOUNT_HMAC_KEY')) fail();
}

function verifyConcurrency(lines) {
  const concurrencyIndex = findUniqueExact(lines, 0, 'concurrency:');
  const concurrencyEnd = blockEnd(lines, concurrencyIndex);
  const properties = directMappings(lines, concurrencyIndex + 1, concurrencyEnd, 2);
  requireEntryOrder(properties, ['group', 'cancel-in-progress']);
  verifyExactMapping(properties, new Map([
    ['group', 'text-ai-preview'],
    ['cancel-in-progress', 'false'],
  ]));
}

function verifyJobAndSteps(lines, source) {
  const jobsIndex = findUniqueExact(lines, 0, 'jobs:');
  const jobsEnd = blockEnd(lines, jobsIndex);
  const jobs = directMappings(lines, jobsIndex + 1, jobsEnd, 2);
  requireEntryOrder(jobs, ['text-ai-preview']);
  if (jobs[0].value !== '') fail();

  const jobEnd = Math.min(blockEnd(lines, jobs[0].index), jobsEnd);
  const properties = directMappings(lines, jobs[0].index + 1, jobEnd, 4);
  requireEntryOrder(properties, [
    'if',
    'environment',
    'permissions',
    'runs-on',
    'timeout-minutes',
    'steps',
  ]);
  if (
    mappingByKey(properties, 'if').value !== "github.ref == 'refs/heads/main' && github.ref_protected == true"
    || mappingByKey(properties, 'environment').value !== 'text-ai-preview'
    || mappingByKey(properties, 'runs-on').value !== 'ubuntu-latest'
    || mappingByKey(properties, 'timeout-minutes').value !== '30'
  ) {
    fail();
  }

  const permissions = mappingByKey(properties, 'permissions');
  if (permissions.value !== '') fail();
  const permissionEntries = directMappings(
    lines,
    permissions.index + 1,
    Math.min(blockEnd(lines, permissions.index), jobEnd),
    6,
  );
  verifyExactMapping(permissionEntries, new Map([['contents', 'read']]));

  const expressions = source.match(/\$\{\{[^}\n]*\}\}/g) ?? [];
  if (countOccurrences(source, '${{') !== expressions.length) fail();
  sameStrings([...expressions].sort(), EXPECTED_EXPRESSIONS);

  const steps = stepBlocks(lines, mappingByKey(properties, 'steps'), jobEnd);
  const checkout = stepProperties(lines, steps[0]);
  requireEntryOrder(checkout, ['uses', 'with']);
  if (checkout[0].value !== CHECKOUT_ACTION || checkout[1].value !== '') fail();
  const checkoutWith = directMappings(
    lines,
    checkout[1].index + 1,
    Math.min(blockEnd(lines, checkout[1].index), steps[0].end),
    10,
  );
  verifyExactMapping(checkoutWith, new Map([
    ['ref', '${{ github.sha }}'],
    ['persist-credentials', 'false'],
  ]));

  const setup = stepProperties(lines, steps[1]);
  requireEntryOrder(setup, ['uses', 'with']);
  if (setup[0].value !== SETUP_NODE_ACTION || setup[1].value !== '') fail();
  const setupWith = directMappings(
    lines,
    setup[1].index + 1,
    Math.min(blockEnd(lines, setup[1].index), steps[1].end),
    10,
  );
  verifyExactMapping(setupWith, new Map([['node-version', '22'], ['cache', 'npm']]));

  scalarRun(lines, steps[2], 'npm ci');
  scalarRun(lines, steps[3], 'npm run typecheck');
  scalarRun(lines, steps[4], 'npm test');
  scalarRun(lines, steps[5], 'npm run typecheck:edge');
  scalarRun(lines, steps[6], 'npm run test:edge');

  const build = stepProperties(lines, steps[7]);
  requireEntryOrder(build, ['run', 'env']);
  if (build[0].value !== 'npm run build' || build[1].value !== '') fail();
  const buildEnv = directMappings(
    lines,
    build[1].index + 1,
    Math.min(blockEnd(lines, build[1].index), steps[7].end),
    10,
  );
  verifyExactMapping(buildEnv, new Map([
    ['VITE_ENABLE_TEXT_AI', "'true'"],
    ['VITE_ENABLE_PHOTO_AI', "'false'"],
  ]));

  scalarRun(lines, steps[8], 'npm run verify:text-preview-workflow');
  const dryRun = blockRun(lines, steps[9]);
  if (dryRun !== WRANGLER_DRY_RUN) fail();
  const dispatchProperties = stepProperties(lines, steps[10]);
  requireEntryOrder(dispatchProperties, ['env', 'run']);
  const dispatchEnv = mappingByKey(dispatchProperties, 'env');
  if (dispatchEnv.value !== '') fail();
  const dispatchEnvEntries = directMappings(
    lines,
    dispatchEnv.index + 1,
    Math.min(blockEnd(lines, dispatchEnv.index), steps[10].end),
    10,
  );
  verifyExactMapping(dispatchEnvEntries, EXPECTED_DISPATCH_ENV);
  const dispatch = blockRun(lines, steps[10], ['env', 'run']);
  if (createHash('sha256').update(dispatch, 'utf8').digest('hex') !== EXPECTED_DISPATCH_SHA256) {
    fail();
  }

  const runScripts = [
    'npm ci',
    'npm run typecheck',
    'npm test',
    'npm run typecheck:edge',
    'npm run test:edge',
    'npm run build',
    'npm run verify:text-preview-workflow',
    dryRun,
    dispatch,
  ].join('\n');
  verifyShellPolicy(runScripts, dispatch);
}

export function verifyTextPreviewWorkflow(source) {
  try {
    if (
      typeof source !== 'string'
      || source.length === 0
      || Buffer.byteLength(source, 'utf8') > MAX_WORKFLOW_BYTES
      || source.includes('\0')
      || source.includes('\r')
      || source.includes('\t')
      || !source.endsWith('\n')
      || source.includes('actions/upload-artifact')
      || source.includes('workflow_call:')
      || source.includes('pull_request:')
      || source.includes('schedule:')
      || source.includes('push:')
    ) {
      fail();
    }
    const lines = source.slice(0, -1).split('\n');
    const topLevel = directMappings(lines, 0, lines.length, 0);
    requireEntryOrder(topLevel, ['name', 'on', 'concurrency', 'jobs']);
    if (
      topLevel[0].value !== 'Text AI Preview Control'
      || topLevel[1].value !== ''
      || topLevel[2].value !== ''
      || topLevel[3].value !== ''
    ) {
      fail();
    }
    verifyManualInputs(lines);
    verifyConcurrency(lines);
    verifyJobAndSteps(lines, source);
    return { ...FIXED_REPORT };
  } catch {
    fail();
  }
}

async function runCli(argv, dependencies = {}) {
  const read = dependencies.readFile ?? readFile;
  const writeStdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr = dependencies.writeStderr ?? ((value) => process.stderr.write(value));
  try {
    if (
      !Array.isArray(argv)
      || argv.length !== 1
      || typeof argv[0] !== 'string'
      || argv[0].length === 0
      || argv[0].includes('\0')
      || typeof read !== 'function'
      || typeof writeStdout !== 'function'
      || typeof writeStderr !== 'function'
    ) {
      fail();
    }
    const report = verifyTextPreviewWorkflow(await read(resolve(argv[0]), 'utf8'));
    writeStdout(`${JSON.stringify(report)}\n`);
    return 0;
  } catch {
    try {
      writeStderr(`${FAILURE_MESSAGE}\n`);
    } catch {
      // Output failures do not expose a path, workflow source, or secret expression.
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
