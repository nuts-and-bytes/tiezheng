import assert from 'node:assert/strict';
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

test('scopes every environment secret to the final dispatcher after all validation steps', () => {
  const dispatchIndex = source.indexOf('      - name: Dispatch fixed operation\n');
  assert.notEqual(dispatchIndex, -1);
  assert.equal(source.includes('\n    env:\n'), false);
  for (const name of [
    'CLOUDFLARE_API_TOKEN',
    'TEXT_AI_USER_1_EMAIL',
    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
    'ARK_API_KEY',
    'PHOTO_AI_CACHE_AES_KEY',
  ]) {
    const expression = '${{ secrets.' + name + ' }}';
    assert.ok(source.indexOf(`          ${name}: ${expression}\n`) > dispatchIndex);
  }
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
    '              node scripts/text-ai-preview-control.mjs configure\n              write_worker_secret_file\n',
    '              node scripts/text-ai-preview-control.mjs configure\n              node --input-type=module -e "process.exit(0)"\n              write_worker_secret_file\n',
  ));
});

test('requires the exact EXIT trap and cleanup placement', () => {
  expectPolicyFailure(replaceOnce(source, '          trap cleanup_worker_secret_file EXIT\n', ''));
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
