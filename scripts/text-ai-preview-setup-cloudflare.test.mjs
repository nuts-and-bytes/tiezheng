import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { inspectCloudflareSetup } from './text-ai-preview-setup-cloudflare.mjs';

const ACCOUNT_ID = 'a'.repeat(32);
const TOKEN_ID = 'token-id';
const PERMISSIONS = Object.freeze([
  'Account API Tokens Read',
  'Workers Scripts Edit',
  'Cloudflare Pages Edit',
]);
const FAILURE = 'Text preview setup failed';

function tokenFixtures(permissionNames = PERMISSIONS) {
  const permissionGroups = permissionNames.map((name, index) => ({
    id: `permission-${index + 1}`,
    name,
    scopes: ['com.cloudflare.api.account'],
  }));
  return {
    verification: { id: TOKEN_ID, status: 'active' },
    details: {
      id: TOKEN_ID,
      status: 'active',
      policies: [{
        effect: 'allow',
        resources: { [`com.cloudflare.api.account.${ACCOUNT_ID}`]: '*' },
        permission_groups: permissionGroups.map(({ id, name }) => ({ id, name })),
      }],
    },
    permissionGroups,
  };
}

function fakeClient({ permissions = PERMISSIONS, project = true, worker = true } = {}) {
  const token = tokenFixtures(permissions);
  const routes = new Map([
    ['/tokens/verify', token.verification],
    [`/tokens/${TOKEN_ID}`, token.details],
    ['/tokens/permission_groups', token.permissionGroups],
    ['/pages/projects/tiezheng', project ? {
      id: 'pages-project-id',
      name: 'tiezheng',
      production_branch: 'main',
      deployment_configs: { production: {}, preview: {} },
    } : null],
    ['/workers/scripts', worker ? [{ id: 'tiezheng-photo-ai-gateway' }] : []],
  ]);
  const calls = [];
  return {
    calls,
    client: Object.freeze({
      async get(path) {
        calls.push(path);
        if (!routes.has(path)) throw new Error(`unexpected secret-sentinel ${path}`);
        return structuredClone(routes.get(path));
      },
    }),
  };
}

test('checks only the token, Pages project, and Worker inventory', async () => {
  const fixture = fakeClient();
  assert.deepEqual(await inspectCloudflareSetup(ACCOUNT_ID, fixture.client), { status: 'ready' });
  assert.deepEqual(fixture.calls, [
    '/tokens/verify',
    `/tokens/${TOKEN_ID}`,
    '/tokens/permission_groups',
    '/pages/projects/tiezheng',
    '/workers/scripts',
  ]);
});

test('returns the exact missing narrow permission list without reading resources', async () => {
  const fixture = fakeClient({ permissions: PERMISSIONS.slice(0, 2) });
  assert.deepEqual(await inspectCloudflareSetup(ACCOUNT_ID, fixture.client), {
    status: 'missing-permissions',
    missingPermissions: Object.freeze(['Cloudflare Pages Edit']),
  });
  assert.deepEqual(fixture.calls, [
    '/tokens/verify',
    `/tokens/${TOKEN_ID}`,
    '/tokens/permission_groups',
  ]);
});

test('fails closed for missing or malformed Pages and Worker resources', async () => {
  for (const options of [{ project: false }, { worker: false }]) {
    const fixture = fakeClient(options);
    await assert.rejects(
      inspectCloudflareSetup(ACCOUNT_ID, fixture.client),
      (error) => error.message === FAILURE && !error.stack.includes('secret-sentinel'),
    );
  }
});

test('runtime Cloudflare setup source has no Access API or resource creation capability', async () => {
  const source = await readFile(new URL('./text-ai-preview-setup-cloudflare.mjs', import.meta.url), 'utf8');
  for (const forbidden of [
    '/access/',
    'service_token',
    'serviceToken',
    'auth_domain',
    '.post(',
    '.delete(',
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
