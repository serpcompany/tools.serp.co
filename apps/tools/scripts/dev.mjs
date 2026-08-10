import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const booleanArguments = new Set([
  '--disable-source-maps',
  '--experimental-https',
]);
const valueArguments = new Map([
  ['--hostname', '--hostname'],
  ['-H', '--hostname'],
  ['--experimental-https-key', '--experimental-https-key'],
  ['--experimental-https-cert', '--experimental-https-cert'],
  ['--experimental-https-ca', '--experimental-https-ca'],
]);
const rejectedArguments = new Set([
  '--turbo',
  '--turbopack',
  '--experimental-upload-trace',
]);

function parseArguments(arguments_) {
  const tokens = [...arguments_];
  if (tokens[0] === '--') {
    tokens.shift();
  }
  const forwarded = [];
  let requestedPort;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (rejectedArguments.has(token)) {
      throw new Error('Unsupported local development argument');
    }
    if (token === '--help' || token === '-h') {
      return { forwarded: ['--help'], requestedPort: undefined, help: true };
    }
    if (token === '--port' || token === '-p') {
      const value = tokens[index + 1];
      if (value === undefined) {
        throw new Error('Local development port requires a value');
      }
      requestedPort = Number(value);
      index += 1;
      continue;
    }
    if (booleanArguments.has(token)) {
      forwarded.push(token);
      continue;
    }
    const canonicalArgument = valueArguments.get(token);
    if (canonicalArgument !== undefined) {
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Local development argument requires a value');
      }
      forwarded.push(canonicalArgument, value);
      index += 1;
      continue;
    }
    throw new Error('Unsupported local development argument');
  }

  if (
    requestedPort !== undefined &&
    (!Number.isInteger(requestedPort) ||
      requestedPort < 1 ||
      requestedPort > 65_535)
  ) {
    throw new Error(
      'Local development port must be an integer from 1 to 65535',
    );
  }
  return { forwarded, requestedPort, help: false };
}

function isAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function selectPort(requestedPort) {
  if (requestedPort !== undefined) {
    if (!(await isAvailable(requestedPort))) {
      throw new Error('Requested local development port is unavailable');
    }
    return requestedPort;
  }

  const environmentPort = Number(process.env.PORT);
  const preferred = Number.isInteger(environmentPort) ? environmentPort : 3000;
  const maxPort = Math.min(preferred + 50, 65_535);
  for (let port = preferred; port <= maxPort; port += 1) {
    if (await isAvailable(port)) {
      return port;
    }
  }
  throw new Error('No local development port is available');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const nextArguments = ['dev', ...options.forwarded];
  let port;
  if (!options.help) {
    port = await selectPort(options.requestedPort);
    nextArguments.push('--port', String(port));
    console.log(`[dev:local] Starting Next.js on port ${port}`);
  }

  const child = spawn('next', nextArguments, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(port === undefined ? {} : { PORT: String(port) }),
    },
  });
  child.on('error', (error) => {
    console.error(`[dev:local] ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Local development failed',
  );
  process.exitCode = 1;
}
