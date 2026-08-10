export function parseCatalogSyncMode(arguments_) {
  for (const argument of arguments_) {
    if (!new Set(['--check', '--write']).has(argument)) {
      throw new Error(`Unknown catalog sync argument: ${argument}`);
    }
  }
  const write = arguments_.includes('--write');
  if (write && arguments_.includes('--check')) {
    throw new Error('Choose only one of --check or --write');
  }
  return { write };
}
