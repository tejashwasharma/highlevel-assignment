import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const WORKER_ENTRY = path.resolve(__dirname, '../../dist/worker.js');

export function spawnWorker(): ChildProcess {
  return spawn('node', [WORKER_ENTRY], {
    env: { ...process.env },
    stdio: 'ignore',
  });
}

export function killWorker(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
