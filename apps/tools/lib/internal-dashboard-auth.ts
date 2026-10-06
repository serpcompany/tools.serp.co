export const INTERNAL_DASHBOARD_REALM = "Tools internal dashboard";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function readBasicPassword(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, encoded] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  return separator === -1 ? null : decoded.slice(separator + 1);
}

// Fails closed: with no configured token, nobody is authorized.
export function isInternalDashboardAuthorized(
  authorization: string | null,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return false;
  const password = readBasicPassword(authorization);
  return password !== null && constantTimeEqual(password, expectedToken);
}
