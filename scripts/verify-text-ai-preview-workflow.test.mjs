import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let testModule;
try {
  testModule = await import('vitest');
} catch {
  testModule = await import('node:test');
}
const { test } = testModule;

import { verifyTextPreviewWorkflow } from './verify-text-ai-preview-workflow.mjs';

const WORKFLOW_PATH = resolve('.github/workflows/text-ai-preview.yml');
const source = await readFile(WORKFLOW_PATH, 'utf8');
const FAILURE_MESSAGE = 'Text preview workflow policy failed';

function extractDispatchScript(value) {
  const marker = '      - name: Dispatch fixed operation\n';
  const stepStart = value.indexOf(marker);
  assert.notEqual(stepStart, -1, 'dispatch step is missing');
  const runMarker = '        run: |\n';
  const runStart = value.indexOf(runMarker, stepStart);
  assert.notEqual(runStart, -1, 'dispatch run block is missing');
  const output = [];
  for (const line of value.slice(runStart + runMarker.length).split('\n')) {
    if (line.length === 0) {
      output.push('');
      continue;
    }
    assert.ok(line.startsWith('          '), 'dispatch run indentation drifted');
    output.push(line.slice(10));
  }
  while (output.length > 0 && output.at(-1) === '') output.pop();
  return output.join('\n');
}

const dispatchScript = extractDispatchScript(source);

function replaceOnce(value, before, after) {
  const first = value.indexOf(before);
  assert.notEqual(first, -1, `fixture is missing mutation anchor: ${before}`);
  assert.equal(value.indexOf(before, first + before.length), -1, `fixture anchor is not unique: ${before}`);
  return `${value.slice(0, first)}${after}${value.slice(first + before.length)}`;
}

function replaceFirst(value, before, after) {
  const first = value.indexOf(before);
  assert.notEqual(first, -1, `fixture is missing mutation anchor: ${before}`);
  return `${value.slice(0, first)}${after}${value.slice(first + before.length)}`;
}

function expectPolicyFailure(value) {
  assert.throws(
    () => verifyTextPreviewWorkflow(value),
    (error) => error?.constructor === Error && error.message === FAILURE_MESSAGE,
  );
}

test('accepts the single protected manual workflow and returns the fixed redacted report', () => {
  assert.deepEqual(verifyTextPreviewWorkflow(source), {
    manualOnly: true,
    protectedEnvironment: true,
    productionDisabled: true,
    photoDisabled: true,
    maxProviderAttempts: 1,
    realRequestBudget: 1,
  });
});

test('rejects every non-manual or unknown top-level trigger', () => {
  for (const trigger of ['push', 'pull_request', 'schedule', 'workflow_call', 'repository_dispatch']) {
    expectPolicyFailure(replaceOnce(
      source,
      '  workflow_dispatch:\n',
      `  workflow_dispatch:\n  ${trigger}:\n`,
    ));
  }
  expectPolicyFailure(replaceOnce(source, '  workflow_dispatch:\n', '  push:\n'));
  expectPolicyFailure(`${source}\non:\n  workflow_dispatch:\n`);
});

test('requires the exact operation choice contract and rejects arbitrary operation strings', () => {
  expectPolicyFailure(replaceOnce(
    source,
    '        description: Fixed preview control operation\n        type: choice\n',
    '        description: Fixed preview control operation\n        type: string\n',
  ));
  expectPolicyFailure(replaceOnce(source, '          - preflight\n', '          - arbitrary-command\n'));
  expectPolicyFailure(replaceOnce(
    source,
    '          - delete-account\n',
    '          - delete-account\n          - arbitrary-command\n',
  ));
  expectPolicyFailure(replaceOnce(source, '        required: true\n        options:\n', '        required: false\n        options:\n'));
});

test('requires the exact two-slot target and string confirmation contracts', () => {
  expectPolicyFailure(replaceOnce(source, '        default: user-1\n', '        default: user-2\n'));
  expectPolicyFailure(replaceOnce(source, '          - user-2\n', '          - user-2\n          - user-3\n'));
  expectPolicyFailure(replaceOnce(
    source,
    '      confirmation:\n        description: Fixed phrase for protected operations\n        type: string\n',
    '      confirmation:\n        description: Fixed phrase for protected operations\n        type: choice\n',
  ));
  expectPolicyFailure(replaceOnce(
    source,
    '        type: string\n        required: false\n',
    '        type: string\n        required: true\n',
  ));
});

test('requires one protected job with read-only contents permission and a 30 minute timeout', () => {
  for (const [before, after] of [
    ['    environment: text-ai-preview\n', '    environment: production\n'],
    ['      contents: read\n', '      contents: write\n'],
    ['      contents: read\n', '      contents: read\n      id-token: write\n'],
    ['    timeout-minutes: 30\n', '    timeout-minutes: 31\n'],
    ['    runs-on: ubuntu-latest\n', '    runs-on: self-hosted\n'],
  ]) {
    expectPolicyFailure(replaceFirst(source, before, after));
  }
  expectPolicyFailure(`${source}\n  unexpected-job:\n    runs-on: ubuntu-latest\n`);
  expectPolicyFailure(`${source}defaults:\n  run:\n    shell: pwsh\n`);
});

test('locks dispatch concurrency and hard-gates the protected main ref', () => {
  assert.ok(source.includes(
    'concurrency:\n  group: text-ai-preview\n  cancel-in-progress: false\n\n',
  ));
  assert.ok(source.includes(
    "  text-ai-preview:\n    if: github.ref == 'refs/heads/main' && github.ref_protected == true\n",
  ));
  for (const [before, after] of [
    ['  group: text-ai-preview\n', '  group: text-ai-preview-${{ github.ref }}\n'],
    ['  cancel-in-progress: false\n', '  cancel-in-progress: true\n'],
    ["github.ref == 'refs/heads/main'", "github.ref == 'refs/heads/text-ai-preview'"],
    ['github.ref_protected == true', 'github.ref_protected == false'],
  ]) {
    expectPolicyFailure(replaceOnce(source, before, after));
  }
  expectPolicyFailure(replaceOnce(
    source,
    "    if: github.ref == 'refs/heads/main' && github.ref_protected == true\n",
    '',
  ));
});

test('pins official actions by full release SHA and checks out the dispatched commit without credentials', () => {
  const checkoutSha = '34e114876b0b11c390a56381ad16ebd13914f8d5';
  const setupNodeSha = '49933ea5288caeca8642d1e84afbd3f7d6820020';
  assert.ok(source.includes(`        uses: actions/checkout@${checkoutSha}\n`));
  assert.ok(source.includes(
    '        with:\n          ref: ${{ github.sha }}\n          persist-credentials: false\n',
  ));
  assert.ok(source.includes(`        uses: actions/setup-node@${setupNodeSha}\n`));
  for (const [before, after] of [
    [`actions/checkout@${checkoutSha}`, 'actions/checkout@v4'],
    [`actions/checkout@${checkoutSha}`, 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d4'],
    [`actions/setup-node@${setupNodeSha}`, 'actions/setup-node@v4'],
    [`actions/setup-node@${setupNodeSha}`, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820021'],
    ['          ref: ${{ github.sha }}\n', '          ref: main\n'],
    ['          persist-credentials: false\n', '          persist-credentials: true\n'],
  ]) {
    expectPolicyFailure(replaceOnce(source, before, after));
  }
});

test('scopes every environment secret to the final dispatcher after all validation steps', () => {
  const dispatchIndex = source.indexOf('      - name: Dispatch fixed operation\n');
  assert.notEqual(dispatchIndex, -1);
  assert.equal(source.includes('\n    env:\n'), false);
  for (const name of [
    'CLOUDFLARE_API_TOKEN',
    'TEXT_AI_USER_1_EMAIL',
    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
  ]) {
    const expression = '${{ secrets.' + name + ' }}';
    assert.ok(source.indexOf(`          ${name}: ${expression}\n`) > dispatchIndex);
  }
  for (const name of ['ARK_API_KEY', 'PHOTO_AI_CACHE_AES_KEY']) {
    const expression = "${{ inputs.operation == 'enable-admin-preview' && secrets." + name + " || '' }}";
    assert.ok(source.indexOf(`          ${name}: ${expression}\n`) > dispatchIndex);
  }
});

test('injects and writes Worker secrets only for the first enabled deployment', () => {
  for (const name of ['ARK_API_KEY', 'PHOTO_AI_CACHE_AES_KEY']) {
    const expected = `          ${name}: `
      + "${{ inputs.operation == 'enable-admin-preview' && secrets."
      + name
      + " || '' }}\n";
    assert.ok(source.includes(expected));
    expectPolicyFailure(replaceOnce(
      source,
      expected,
      `          ${name}: ` + '${{ secrets.' + name + ' }}\n',
    ));
  }
  const disabledDeploy = source.split('\n').find((line) => (
    line.includes('wrangler deploy --config')
    && line.includes('TEXT_AI_GATEWAY_ENABLED:false')
  ));
  const enabledDeploy = source.split('\n').find((line) => (
    line.includes('wrangler deploy --config')
    && line.includes('TEXT_AI_GATEWAY_ENABLED:true')
  ));
  assert.equal(typeof disabledDeploy, 'string');
  assert.equal(typeof enabledDeploy, 'string');
  assert.equal(disabledDeploy.includes('--secrets-file'), false);
  assert.equal(enabledDeploy.includes('--secrets-file "$TEXT_AI_SECRET_FILE"'), true);
  expectPolicyFailure(replaceOnce(
    source,
    'deploy-disabled)\n              node scripts/text-ai-preview-control.mjs configure > /dev/null\n              deploy_worker_disabled',
    'deploy-disabled)\n              node scripts/text-ai-preview-control.mjs configure > /dev/null\n              write_worker_secret_file\n              deploy_worker_disabled',
  ));
});

test('requires the exact validation step order before the fixed operation dispatcher', () => {
  expectPolicyFailure(replaceOnce(
    source,
    '      - name: Typecheck\n        run: npm run typecheck\n      - name: Unit tests\n        run: npm test\n',
    '      - name: Unit tests\n        run: npm test\n      - name: Typecheck\n        run: npm run typecheck\n',
  ));
  expectPolicyFailure(replaceOnce(source, '      - name: Worker dry-run\n', '      - name: Worker compile\n'));
  expectPolicyFailure(replaceOnce(source, ' --dry-run ', ' '));
  expectPolicyFailure(replaceOnce(
    source,
    '      - name: Verify preview workflow policy\n        run: npm run verify:text-preview-workflow\n',
    '',
  ));
});

test('keeps both browser and Worker photo paths disabled and builds only the text client', () => {
  for (const [before, after] of [
    ["          VITE_ENABLE_PHOTO_AI: 'false'\n", "          VITE_ENABLE_PHOTO_AI: 'true'\n"],
    ["          VITE_ENABLE_TEXT_AI: 'true'\n", "          VITE_ENABLE_TEXT_AI: 'false'\n"],
    ['--var "PHOTO_AI_GATEWAY_ENABLED:false"', '--var "PHOTO_AI_GATEWAY_ENABLED:true"'],
    ['--var "TEXT_AI_MAX_PROVIDER_ATTEMPTS:1"', '--var "TEXT_AI_MAX_PROVIDER_ATTEMPTS:2"'],
  ]) {
    expectPolicyFailure(replaceFirst(source, before, after));
  }
});

test('pins the source Worker config, Preview origin, model, budget and admin boundary', () => {
  for (const [before, after] of [
    ['workers/photo-ai-gateway/wrangler.jsonc', 'workers/alternate/wrangler.jsonc'],
    ['PHOTO_AI_ALLOWED_ORIGINS:https://text-ai-preview.tiezheng.pages.dev', 'PHOTO_AI_ALLOWED_ORIGINS:https://tiezheng.pages.dev'],
    ['TEXT_AI_MODEL:doubao-seed-2-1-pro-260628', 'TEXT_AI_MODEL:other-model'],
    ['PHOTO_AI_MODEL:doubao-seed-2-1-pro-260628', 'PHOTO_AI_MODEL:other-model'],
    ['PHOTO_AI_MONTHLY_BUDGET_MICROS:50000000', 'PHOTO_AI_MONTHLY_BUDGET_MICROS:90000000'],
    ['--var "TEXT_AI_ADMIN_ENABLED:true"', '--var "TEXT_AI_ADMIN_ENABLED:false"'],
  ]) {
    expectPolicyFailure(replaceFirst(source, before, after));
  }
  expectPolicyFailure(replaceFirst(source, '--config workers/photo-ai-gateway/wrangler.jsonc', '--name alternate-worker'));
});

test('pins Preview Pages deployment and cannot overwrite the production branch', () => {
  for (const [before, after] of [
    ['--project-name=tiezheng', '--project-name=other-project'],
    ['--branch=text-ai-preview', '--branch=main'],
    ['--commit-hash="$GITHUB_SHA"', '--commit-hash=main'],
  ]) {
    expectPolicyFailure(replaceOnce(source, before, after));
  }
});

test('requires both dangerous-operation confirmation phrases exactly once', () => {
  expectPolicyFailure(replaceOnce(
    source,
    'ENABLE_ONE_TEXT_PREVIEW_ACCOUNT',
    'ENABLE_TEXT_PREVIEW',
  ));
  expectPolicyFailure(replaceOnce(
    source,
    'DELETE_TEXT_PREVIEW_ACCOUNT_STATE',
    'DELETE_TEXT_STATE',
  ));
  expectPolicyFailure(replaceOnce(
    source,
    'ENABLE_ONE_TEXT_PREVIEW_ACCOUNT',
    'DELETE_TEXT_PREVIEW_ACCOUNT_STATE',
  ));
});

test('runs strict full preflight for every operation except disable-all', () => {
  const guard = 'if [ "$TEXT_AI_OPERATION" != \'disable-all\' ]; then\n            run_full_preflight\n          fi';
  assert.ok(source.includes(guard));
  expectPolicyFailure(replaceOnce(
    source,
    guard,
    'run_full_preflight',
  ));
  expectPolicyFailure(replaceOnce(
    source,
    "[ \"$TEXT_AI_OPERATION\" != 'disable-all' ]",
    "[ \"$TEXT_AI_OPERATION\" != 'never' ]",
  ));
  expectPolicyFailure(replaceOnce(
    source,
    'disable-all)\n              disable_failure_mask=0',
    'disable-all)\n              run_full_preflight\n              disable_failure_mask=0',
  ));
});

test('requires every first-account precondition before any configuration or enable write', () => {
  const branch = [
    'enable-admin-preview)',
    '              if [ "$TEXT_AI_TARGET" != \'user-1\' ] || [ "$TEXT_AI_CONFIRMATION" != \'ENABLE_ONE_TEXT_PREVIEW_ACCOUNT\' ]; then',
    '                exit 1',
    '              fi',
    '              capture_status_pair',
    '              assert_enable_admin_preconditions',
    '              node scripts/text-ai-preview-control.mjs configure > /dev/null',
  ].join('\n');
  assert.ok(source.includes(branch));
  for (const [before, after] of [
    ['preflight.workerTextEnabled !== false', 'preflight.workerTextEnabled !== true'],
    ['userOne.textGlobalEnabled !== false', 'userOne.textGlobalEnabled !== true'],
    ['userOne.accountEnabled !== false', 'userOne.accountEnabled !== true'],
    ['userTwo.textGlobalEnabled !== false', 'userTwo.textGlobalEnabled !== true'],
    ['userTwo.accountEnabled !== false', 'userTwo.accountEnabled !== true'],
    ['              capture_status_pair\n              assert_enable_admin_preconditions\n', ''],
  ]) {
    expectPolicyFailure(replaceOnce(source, before, after));
  }
  expectPolicyFailure(replaceOnce(
    source,
    '              capture_status_pair\n              assert_enable_admin_preconditions\n              node scripts/text-ai-preview-control.mjs configure > /dev/null\n',
    '              node scripts/text-ai-preview-control.mjs configure > /dev/null\n              capture_status_pair\n              assert_enable_admin_preconditions\n',
  ));
});

test('requires the exact second-account preconditions and performs only its fixed account enable', () => {
  const branch = [
    'enable-second-account)',
    '              if [ "$TEXT_AI_TARGET" != \'user-2\' ]; then',
    '                exit 1',
    '              fi',
    '              capture_status_pair',
    '              assert_enable_second_preconditions',
    '              node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-2 > /dev/null',
    '              ;;',
  ].join('\n');
  assert.ok(source.includes(branch));
  for (const [before, after] of [
    ['secondPreflight.workerTextEnabled !== true', 'secondPreflight.workerTextEnabled !== false'],
    ['secondUserOne.textGlobalEnabled !== true', 'secondUserOne.textGlobalEnabled !== false'],
    ['secondUserOne.accountEnabled !== true', 'secondUserOne.accountEnabled !== false'],
    ['secondUserTwo.textGlobalEnabled !== true', 'secondUserTwo.textGlobalEnabled !== false'],
    ['secondUserTwo.accountEnabled !== false', 'secondUserTwo.accountEnabled !== true'],
    ['              capture_status_pair\n              assert_enable_second_preconditions\n', ''],
  ]) {
    expectPolicyFailure(replaceOnce(source, before, after));
  }
  expectPolicyFailure(replaceOnce(
    source,
    '              assert_enable_second_preconditions\n              node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-2 > /dev/null\n',
    '              assert_enable_second_preconditions\n              deploy_worker_enabled\n              node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-2 > /dev/null\n',
  ));
});

test('captures status JSON to bounded files and emits only a canonical whitelist for explicit status', () => {
  for (const target of ['user-1', 'user-2']) {
    const slot = target === 'user-1' ? 'USER_1' : 'USER_2';
    const command = `node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=${target} > "$TEXT_AI_${slot}_STATUS_FILE"`;
    assert.ok(source.includes(command));
    expectPolicyFailure(replaceFirst(source, command, command.split(' > ')[0]));
  }
  assert.ok(source.includes(
    "const statusKeys = Object.freeze(['operation', 'textGlobalEnabled', 'accountEnabled', 'accountRemaining', 'globalRemaining', 'budgetSpentMicros', 'budgetReservedMicros', 'resetAt']);",
  ));
  const canonicalOutput = [
    'const canonicalStatus = Object.freeze({',
    '            textGlobalEnabled: value.textGlobalEnabled,',
    '            accountEnabled: value.accountEnabled,',
    '            accountRemaining: value.accountRemaining,',
    '            globalRemaining: value.globalRemaining,',
    '            budgetSpentMicros: value.budgetSpentMicros,',
    '            budgetReservedMicros: value.budgetReservedMicros,',
    '            resetAt: value.resetAt,',
    '          });',
    '          process.stdout.write(`${JSON.stringify(canonicalStatus)}\\n`);',
  ].join('\n');
  assert.ok(source.includes(canonicalOutput));
  assert.equal((source.match(/assert_status_file "\$TEXT_AI_USER_[12]_STATUS_FILE"/gu) ?? []).length, 2);
  assert.equal((source.match(/process\.stdout\.write\(`\$\{JSON\.stringify\(canonicalStatus\)\}\\n`\);/gu) ?? []).length, 1);
  assert.equal(canonicalOutput.includes('operation:'), false);
  assert.equal(canonicalOutput.includes('target:'), false);
  for (const forbidden of ['email', 'accountId', 'jwt', 'otp', 'secret', 'audience', 'meal']) {
    assert.equal(canonicalOutput.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
  for (const command of ['echo ', 'printf ', 'printenv', 'eval ', 'curl ']) {
    assert.equal(source.includes(command), false);
  }
});

test('keeps enable precondition status captures silent and limits preflight output to explicit preflight', () => {
  const capturePair = [
    'capture_status_pair() {',
    '            node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=user-1 > "$TEXT_AI_USER_1_STATUS_FILE"',
    '            node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=user-2 > "$TEXT_AI_USER_2_STATUS_FILE"',
    '          }',
  ].join('\n');
  assert.ok(source.includes(capturePair));
  assert.ok(source.includes("if (process.env.TEXT_AI_OPERATION === 'preflight') {"));
  expectPolicyFailure(replaceOnce(
    source,
    "          if (process.env.TEXT_AI_OPERATION === 'preflight') {\n",
    '          if (true) {\n',
  ));
  expectPolicyFailure(replaceFirst(
    source,
    '            node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=user-1 > "$TEXT_AI_USER_1_STATUS_FILE"\n',
    '            node scripts/text-ai-preview-control.mjs invoke-admin --operation=status --target=user-1\n',
  ));
});

test('sets a restrictive umask before creating or capturing any temporary output', () => {
  assert.ok(source.includes('          set -euo pipefail\n          umask 077\n'));
  expectPolicyFailure(replaceOnce(source, '          umask 077\n', '          umask 022\n'));
  expectPolicyFailure(replaceOnce(
    source,
    '          set -euo pipefail\n          umask 077\n',
    '          umask 077\n          set -euo pipefail\n',
  ));
});

test('disable-all always attempts both inner gates and guards the final Access removal', () => {
  const branch = [
    'disable-all)',
    '              disable_failure_mask=0',
    '              if node scripts/text-ai-preview-control.mjs invoke-admin --operation=disable-text-global --target=user-1 > /dev/null; then',
    '                :',
    '              else',
    '                disable_failure_mask=$((disable_failure_mask | 1))',
    '              fi',
    '              if deploy_worker_disabled > /dev/null; then',
    '                :',
    '              else',
    '                disable_failure_mask=$((disable_failure_mask | 2))',
    '              fi',
    "              TEXT_AI_DISABLE_ACCESS_ATTEMPTED='false'",
    '              if [ "$disable_failure_mask" -eq 0 ]; then',
    "                TEXT_AI_DISABLE_ACCESS_ATTEMPTED='true'",
    '                if node scripts/text-ai-preview-control.mjs disable-access > /dev/null; then',
    '                  :',
    '                else',
    '                  disable_failure_mask=$((disable_failure_mask | 4))',
    '                fi',
    '              else',
    '                disable_failure_mask=$((disable_failure_mask | 4))',
    '              fi',
  ].join('\n');
  assert.ok(source.includes(branch));
  assert.ok(source.includes("const stepNames = Object.freeze(['disable-text-global', 'deploy-worker-disabled', 'disable-access']);"));
  assert.ok(source.includes('attempted: index < 2 || accessAttempted,'));
  assert.ok(source.includes('if (failureMask !== 0) process.exitCode = 1;'));
  for (const [before, after] of [
    [
      'if node scripts/text-ai-preview-control.mjs invoke-admin --operation=disable-text-global --target=user-1 > /dev/null; then',
      'node scripts/text-ai-preview-control.mjs invoke-admin --operation=disable-text-global --target=user-1 > /dev/null\n              if true; then',
    ],
    ['disable_failure_mask=$((disable_failure_mask | 2))', 'disable_failure_mask=$((disable_failure_mask | 0))'],
    ['if node scripts/text-ai-preview-control.mjs disable-access > /dev/null; then', 'if true; then'],
    ['if (failureMask !== 0) process.exitCode = 1;', 'if (failureMask !== 0) process.exitCode = 0;'],
  ]) {
    expectPolicyFailure(replaceOnce(source, before, after));
  }
});

test('disable-all preserves Access unless both inner disable gates succeed across the full failure matrix', () => {
  const stubbedDispatch = replaceOnce(
    dispatchScript,
    'trap cleanup_preview_temp_files EXIT\n',
    [
      'node() {',
      "  if [ \"${1:-}\" = 'scripts/text-ai-preview-control.mjs' ]; then",
      "    if [ \"${2:-}\" = 'invoke-admin' ]; then",
      '      return "$GLOBAL_EXIT"',
      '    fi',
      "    if [ \"${2:-}\" = 'disable-access' ]; then",
      "      command printf '%s\\n' 'ACCESS_ATTEMPTED' >&2",
      '      return "$ACCESS_EXIT"',
      '    fi',
      '    return 99',
      '  fi',
      '  command node "$@"',
      '}',
      'deploy_worker_disabled() {',
      '  return "$WORKER_EXIT"',
      '}',
      'trap cleanup_preview_temp_files EXIT',
      '',
    ].join('\n'),
  );

  let scenario = 0;
  for (const globalFailed of [false, true]) {
    for (const workerFailed of [false, true]) {
      for (const accessFailed of [false, true]) {
        const accessAttempted = !globalFailed && !workerFailed;
        const expectedMask = (globalFailed ? 1 : 0)
          | (workerFailed ? 2 : 0)
          | ((!accessAttempted || accessFailed) ? 4 : 0);
        const prefix = `/private/tmp/text-ai-preview-workflow-test-${process.pid}-${scenario}`;
        scenario += 1;
        const result = spawnSync('bash', ['-s'], {
          input: stubbedDispatch,
          encoding: 'utf8',
          env: {
            ...process.env,
            TEXT_AI_OPERATION: 'disable-all',
            TEXT_AI_TARGET: 'user-1',
            TEXT_AI_CONFIRMATION: '',
            TEXT_AI_SECRET_FILE: `${prefix}-secret.json`,
            TEXT_AI_PREFLIGHT_FILE: `${prefix}-preflight.json`,
            TEXT_AI_USER_1_STATUS_FILE: `${prefix}-user-1.json`,
            TEXT_AI_USER_2_STATUS_FILE: `${prefix}-user-2.json`,
            GLOBAL_EXIT: globalFailed ? '1' : '0',
            WORKER_EXIT: workerFailed ? '1' : '0',
            ACCESS_EXIT: accessFailed ? '1' : '0',
          },
        });
        assert.equal(result.stderr.includes('ACCESS_ATTEMPTED'), accessAttempted);
        assert.equal(result.status, expectedMask === 0 ? 0 : 1);
        const summary = JSON.parse(result.stdout.trim());
        assert.deepEqual(summary, {
          failureMask: expectedMask,
          steps: [
            { name: 'disable-text-global', attempted: true, failed: globalFailed },
            { name: 'deploy-worker-disabled', attempted: true, failed: workerFailed },
            {
              name: 'disable-access',
              attempted: accessAttempted,
              failed: !accessAttempted || accessFailed,
            },
          ],
        });
      }
    }
  }
});

test('disable-all access guard and guarded failure are exact mutation-locked policy', () => {
  const guard = [
    'if [ "$disable_failure_mask" -eq 0 ]; then',
    "                TEXT_AI_DISABLE_ACCESS_ATTEMPTED='true'",
    '                if node scripts/text-ai-preview-control.mjs disable-access > /dev/null; then',
  ].join('\n');
  assert.ok(source.includes(guard));
  for (const [before, after] of [
    ['[ "$disable_failure_mask" -eq 0 ]', '[ "$disable_failure_mask" -ne 3 ]'],
    ["TEXT_AI_DISABLE_ACCESS_ATTEMPTED='false'", "TEXT_AI_DISABLE_ACCESS_ATTEMPTED='true'"],
    ['disable_failure_mask=$((disable_failure_mask | 4))\n              fi', 'disable_failure_mask=$((disable_failure_mask | 0))\n              fi'],
  ]) {
    expectPolicyFailure(replaceOnce(source, before, after));
  }
});

test('requires exactly two bounded Worker deploy templates plus one dry-run', () => {
  const disabledDeploy = source.split('\n').find((line) => (
    line.includes('wrangler deploy --config')
    && line.includes('TEXT_AI_GATEWAY_ENABLED:false')
  ));
  assert.equal(typeof disabledDeploy, 'string');
  expectPolicyFailure(`${source}\n${disabledDeploy}\n`);
  expectPolicyFailure(replaceFirst(source, '--secrets-file "$TEXT_AI_SECRET_FILE"', '--secrets-file ./checked-in.json'));
  expectPolicyFailure(replaceOnce(source, '--var "TEXT_AI_GATEWAY_ENABLED:true"', '--var "TEXT_AI_GATEWAY_ENABLED:false"'));
});

test('allows one browser acceptance budget marker but never sends a meal request in workflow', () => {
  expectPolicyFailure(replaceOnce(source, '# REAL_TEXT_AI_REQUEST_BUDGET: 1', '# REAL_TEXT_AI_REQUEST_BUDGET: 2'));
  expectPolicyFailure(replaceOnce(
    source,
    '# REAL_TEXT_AI_REQUEST_BUDGET: 1',
    '# REAL_TEXT_AI_REQUEST_BUDGET: 1\n          # REAL_TEXT_AI_REQUEST_BUDGET: 1',
  ));
  expectPolicyFailure(replaceOnce(
    source,
    '# NO_REAL_MEAL_REQUEST_IN_WORKFLOW',
    'curl https://text-ai-preview.tiezheng.pages.dev/api/nutrition/text/estimate',
  ));
});

test('rejects shell tracing, environment dumps, secret printing and unsafe secret arguments', () => {
  for (const command of [
    'set -x',
    'echo "$ARK_API_KEY"',
    'printf "%s" "$PHOTO_AI_CACHE_AES_KEY"',
    'printenv',
    'env',
    'echo "${{ secrets.ARK_API_KEY }}"',
    'node unsafe.mjs "${{ secrets.ARK_API_KEY }}"',
    'echo "${{ toJson(secrets) }}"',
  ]) {
    expectPolicyFailure(replaceOnce(
      source,
      '          # NO_REAL_MEAL_REQUEST_IN_WORKFLOW\n',
      `          # NO_REAL_MEAL_REQUEST_IN_WORKFLOW\n          ${command}\n`,
    ));
  }
});

test('rejects an arbitrary Node secret exfiltration command inserted into dispatch', () => {
  expectPolicyFailure(replaceOnce(
    source,
    '          # NO_REAL_MEAL_REQUEST_IN_WORKFLOW\n',
    '          # NO_REAL_MEAL_REQUEST_IN_WORKFLOW\n          node --input-type=module -e "process.stdout.write(process.env.ARK_API_KEY)"\n',
  ));
});

test('requires the exact strict-mode prelude', () => {
  expectPolicyFailure(replaceOnce(source, '          set -euo pipefail\n', ''));
});

test('rejects strict-mode weakening after the prelude', () => {
  expectPolicyFailure(replaceOnce(
    source,
    '          set -euo pipefail\n',
    '          set -euo pipefail\n          set +e\n',
  ));
});

test('rejects arbitrary executable families even when inserted outside known command shapes', () => {
  for (const command of [
    'curl https://example.invalid',
    'python3 -c "import os; print(os.environ.get(\'ARK_API_KEY\'))"',
    'ruby -e "puts ENV[\'ARK_API_KEY\']"',
    'npm exec --yes arbitrary-package',
  ]) {
    expectPolicyFailure(replaceOnce(
      source,
      '          # NO_REAL_MEAL_REQUEST_IN_WORKFLOW\n',
      `          # NO_REAL_MEAL_REQUEST_IN_WORKFLOW\n          ${command}\n`,
    ));
  }
});

test('rejects executable insertion inside a fixed operation branch', () => {
  expectPolicyFailure(replaceOnce(
    source,
    '              node scripts/text-ai-preview-control.mjs configure > /dev/null\n              node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-1 > /dev/null\n',
    '              node scripts/text-ai-preview-control.mjs configure > /dev/null\n              node --input-type=module -e "process.exit(0)"\n              node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-1 > /dev/null\n',
  ));
});

test('requires the exact EXIT trap and cleanup placement', () => {
  expectPolicyFailure(replaceOnce(source, '          trap cleanup_preview_temp_files EXIT\n', ''));
});

test('rejects artifact exfiltration, eval and direct workflow-input interpolation in run blocks', () => {
  expectPolicyFailure(replaceOnce(
    source,
    '      - name: Dispatch fixed operation\n',
    '      - name: Upload workspace\n        uses: actions/upload-artifact@v4\n        with:\n          path: .\n      - name: Dispatch fixed operation\n',
  ));
  for (const command of ['eval "$TEXT_AI_OPERATION"', 'bash -c "$TEXT_AI_OPERATION"', 'echo "${{ inputs.operation }}"']) {
    expectPolicyFailure(replaceOnce(
      source,
      '          # NO_REAL_MEAL_REQUEST_IN_WORKFLOW\n',
      `          # NO_REAL_MEAL_REQUEST_IN_WORKFLOW\n          ${command}\n`,
    ));
  }
});

test('writes only the two Worker runtime secrets through Node stdin into a 0600 temp file', () => {
  expectPolicyFailure(replaceOnce(
    source,
    "const secretNames = Object.freeze(['ARK_API_KEY', 'PHOTO_AI_CACHE_AES_KEY']);",
    "const secretNames = Object.freeze(['ARK_API_KEY', 'PHOTO_AI_CACHE_AES_KEY', 'PHOTO_AI_ACCOUNT_HMAC_KEY']);",
  ));
  expectPolicyFailure(replaceOnce(source, 'mode: 0o600', 'mode: 0o644'));
  expectPolicyFailure(replaceOnce(source, "flag: 'wx'", "flag: 'w'"));
  expectPolicyFailure(replaceFirst(source, "node --input-type=module <<'NODE'", 'node --input-type=module "$ARK_API_KEY" <<\'NODE\''));
});

test('pins every control-plane operation to literal operation and target arguments', () => {
  expectPolicyFailure(replaceOnce(
    source,
    'node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-2',
    'node scripts/text-ai-preview-control.mjs invoke-admin --operation="$TEXT_AI_OPERATION" --target=user-2',
  ));
  expectPolicyFailure(replaceOnce(
    source,
    'node scripts/text-ai-preview-control.mjs invoke-admin --operation=delete-account --target=user-1',
    'node scripts/text-ai-preview-control.mjs invoke-admin --operation=delete-account --target="$TEXT_AI_TARGET"',
  ));
  expectPolicyFailure(replaceOnce(source, '            status)\n', '            arbitrary-operation)\n'));
  expectPolicyFailure(replaceOnce(source, '            preflight)\n', '            unknown)\n'));
});
