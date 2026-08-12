import { createRemoteJWKSet, jwtVerify } from 'jose';

type Environment = Record<string, string | undefined>;

export interface ToolFactoryDeployment {
  environment: 'DEV/STAGING' | 'LOCAL';
  revision: string;
  requiresAccess: boolean;
}

export interface ToolFactoryAccessConfig {
  teamDomain: string;
  audience: string;
  allowedEmail: string;
}

type VerifyAccessToken = (
  token: string,
  expected: { issuer: string; audience: string },
) => Promise<{ email?: unknown }>;

const remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizedTeamDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '');
}

export function getToolFactoryDeployment(
  environment: Environment,
): ToolFactoryDeployment | null {
  if (environment.NODE_ENV !== 'production') {
    return {
      environment: 'LOCAL',
      revision: environment.TOOLS_SERP_DEPLOYED_REVISION ?? 'working-copy',
      requiresAccess: false,
    };
  }

  if (
    environment.TOOLS_SERP_TOOL_FACTORY_ACCESS !== 'cloudflare-access' ||
    environment.TOOLS_SERP_TOOL_FACTORY_ENVIRONMENT !== 'DEV/STAGING' ||
    !/^[a-f0-9]{40}$/.test(environment.TOOLS_SERP_DEPLOYED_REVISION ?? '')
  ) {
    return null;
  }

  return {
    environment: 'DEV/STAGING',
    revision: environment.TOOLS_SERP_DEPLOYED_REVISION!,
    requiresAccess: true,
  };
}

export function getToolFactoryAccessConfig(
  environment: Environment,
): ToolFactoryAccessConfig | null {
  const teamDomain = normalizedTeamDomain(
    environment.TOOLS_SERP_CLOUDFLARE_ACCESS_TEAM_DOMAIN ?? '',
  );
  const audience = environment.TOOLS_SERP_CLOUDFLARE_ACCESS_AUD?.trim() ?? '';
  const allowedEmail =
    environment.TOOLS_SERP_TOOL_FACTORY_ALLOWED_EMAIL?.trim().toLowerCase() ?? '';

  if (
    !/^[a-z0-9.-]+\.cloudflareaccess\.com$/.test(teamDomain) ||
    !audience ||
    !/^\S+@\S+\.\S+$/.test(allowedEmail)
  ) {
    return null;
  }
  return { teamDomain, audience, allowedEmail };
}

async function verifyCloudflareAccessToken(
  token: string,
  expected: { issuer: string; audience: string },
) {
  let keySet = remoteKeySets.get(expected.issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${expected.issuer}/cdn-cgi/access/certs`));
    remoteKeySets.set(expected.issuer, keySet);
  }
  const { payload } = await jwtVerify(token, keySet, expected);
  return { email: payload.email };
}

export async function authorizeToolFactoryRequest(
  token: string,
  config: ToolFactoryAccessConfig,
  verify: VerifyAccessToken = verifyCloudflareAccessToken,
) {
  if (!token) return false;
  try {
    const issuer = `https://${normalizedTeamDomain(config.teamDomain)}`;
    const claims = await verify(token, { issuer, audience: config.audience });
    return (
      typeof claims.email === 'string' &&
      claims.email.trim().toLowerCase() === config.allowedEmail.toLowerCase()
    );
  } catch {
    return false;
  }
}
