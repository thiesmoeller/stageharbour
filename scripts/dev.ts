import { spawn } from 'node:child_process';

const children = [
  // Keep local development bound to loopback even when the shell exports a
  // machine-wide HOST variable (node --env-file does not override it).
  spawn(process.execPath, ['--import', 'tsx', '--watch', 'src/server/main.ts'], { stdio: 'inherit', env: { ...process.env, HOST: '127.0.0.1' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const child of children) child.on('exit', code => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
