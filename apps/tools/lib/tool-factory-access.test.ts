import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateKeyPair, jwtVerify, SignJWT } from 'jose';

import {
  authorizeToolFactoryRequest,
  getToolFactoryDeployment,
} from './tool-factory-access.ts';

const revision = '3931aa0f4ff2e55e8a74c7cd1cbb2dd779c182e1';

test('production Tool Factory fails closed without exact DEV/STAGING configuration', () => {
  assert.equal(getToolFactoryDeployment({ NODE_ENV: 'production' }), null);
  assert.equal(
    getToolFactoryDeployment({
      NODE_ENV: 'production',
      TOOLS_SERP_TOOL_FACTORY_ENVIRONMENT: 'DEV/STAGING',
      TOOLS_SERP_DEPLOYED_REVISION: revision,
    }),
    null,
  );
  assert.equal(
    getToolFactoryDeployment({
      NODE_ENV: 'production',
      TOOLS_SERP_TOOL_FACTORY_ACCESS: 'cloudflare-access',
      TOOLS_SERP_TOOL_FACTORY_ENVIRONMENT: 'PRODUCTION',
      TOOLS_SERP_DEPLOYED_REVISION: revision,
    }),
    null,
  );
});

test('production Tool Factory exposes exact environment and revision only for its named access boundary', () => {
  assert.deepEqual(
    getToolFactoryDeployment({
      NODE_ENV: 'production',
      TOOLS_SERP_TOOL_FACTORY_ACCESS: 'cloudflare-access',
      TOOLS_SERP_TOOL_FACTORY_ENVIRONMENT: 'DEV/STAGING',
      TOOLS_SERP_DEPLOYED_REVISION: revision,
    }),
    { environment: 'DEV/STAGING', revision, requiresAccess: true },
  );
});

test('local Tool Factory remains usable without remote identity configuration', () => {
  assert.deepEqual(getToolFactoryDeployment({ NODE_ENV: 'development' }), {
    environment: 'LOCAL',
    revision: 'working-copy',
    requiresAccess: false,
  });
});

test('Cloudflare Access authorization requires a signed token for the exact approved email', async () => {
  const config = {
    teamDomain: 'example.cloudflareaccess.com',
    audience: 'tool-factory-audience',
    allowedEmail: 'owner@example.com',
  };
  const calls: unknown[] = [];
  const verify = async (...args: unknown[]) => {
    calls.push(args);
    return { email: 'owner@example.com' };
  };

  assert.equal(
    await authorizeToolFactoryRequest('signed.jwt', config, verify),
    true,
  );
  assert.deepEqual(calls, [
    [
      'signed.jwt',
      {
        issuer: 'https://example.cloudflareaccess.com',
        audience: 'tool-factory-audience',
      },
    ],
  ]);

  assert.equal(
    await authorizeToolFactoryRequest(
      'signed.jwt',
      config,
      async () => ({ email: 'someone-else@example.com' }),
    ),
    false,
  );
  assert.equal(await authorizeToolFactoryRequest('', config, verify), false);
  assert.equal(
    await authorizeToolFactoryRequest('bad.jwt', config, async () => {
      throw new Error('invalid signature');
    }),
    false,
  );
});

test('Cloudflare Access authorization verifies signature, issuer, audience, and email together', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://example.cloudflareaccess.com';
  const audience = 'tool-factory-audience';
  const token = await new SignJWT({ email: 'owner@example.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

  assert.equal(
    await authorizeToolFactoryRequest(
      token,
      {
        teamDomain: 'example.cloudflareaccess.com',
        audience,
        allowedEmail: 'owner@example.com',
      },
      async (value, expected) => {
        const { payload } = await jwtVerify(value, publicKey, expected);
        return { email: payload.email };
      },
    ),
    true,
  );
});

test('only the named Wayfinder environment enables the deployed Tool Factory', () => {
  const wrangler = JSON.parse(readFileSync('apps/tools/wrangler.jsonc', 'utf8'));
  assert.equal(wrangler.vars.TOOLS_SERP_TOOL_FACTORY_ACCESS, undefined);
  assert.equal(wrangler.vars.TOOLS_SERP_TOOL_FACTORY_ENVIRONMENT, undefined);
  assert.deepEqual(
    {
      access:
        wrangler.env['wayfinder-preview'].vars.TOOLS_SERP_TOOL_FACTORY_ACCESS,
      environment:
        wrangler.env['wayfinder-preview'].vars
          .TOOLS_SERP_TOOL_FACTORY_ENVIRONMENT,
    },
    { access: 'cloudflare-access', environment: 'DEV/STAGING' },
  );
});
