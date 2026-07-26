import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const command = process.argv[2];
if (!command || !/^[a-z0-9-]+$/.test(command)) {
  console.error('Missing or invalid CLI command.');
  process.exit(1);
}

const forwardedArgs = process.argv.slice(3);
const compiledEntry = `dist-server/scripts/${command}.js`;
const sourceEntry = `scripts/${command}.ts`;
const useCompiledEntry = existsSync(compiledEntry);
const args = useCompiledEntry
  ? [compiledEntry, ...forwardedArgs]
  : ['--import', 'tsx', sourceEntry, ...forwardedArgs];

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
