// Sobe a API (porta 3333) e a interface web (porta 5173) juntas, em Windows, macOS ou Linux.
import { spawn } from 'node:child_process';

const processos = [
  ['api', 'npm run dev -w apps/api'],
  ['web', 'npm run dev -w apps/web'],
].map(([nome, cmd]) => {
  const p = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefixar = (d) => process.stdout.write(String(d).replace(/^(?=.)/gm, `[${nome}] `));
  p.stdout.on('data', prefixar);
  p.stderr.on('data', prefixar);
  p.on('exit', (cod) => {
    console.log(`[${nome}] encerrado (código ${cod})`);
    encerrar();
  });
  return p;
});

function encerrar() {
  for (const p of processos) if (p.exitCode === null) p.kill();
  process.exit();
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
