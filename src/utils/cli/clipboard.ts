import { spawn } from 'node:child_process';

export async function copyToClipboard(text: string): Promise<boolean> {
  const command = process.platform === 'darwin' ? 'pbcopy' : 'xclip';
  const args = process.platform === 'darwin' ? [] : ['-selection', 'clipboard'];

  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });

    child.on('error', () => {
      resolve(false);
    });

    child.on('exit', (code) => {
      resolve(code === 0);
    });

    child.stdin.write(text);
    child.stdin.end();
  });
}
