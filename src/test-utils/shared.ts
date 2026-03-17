import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Logger } from '../utils/logger.js';

export { createSilentSpinnerFactory } from '../utils/spinner.js';

export function createTempDirTracker(): {
  cleanup: () => Promise<void>;
  makeTempDir: (prefix: string) => Promise<string>;
} {
  const tempDirectories = new Set<string>();

  return {
    async cleanup(): Promise<void> {
      await Promise.all(
        Array.from(tempDirectories, async (directory) => {
          await fs.rm(directory, { recursive: true, force: true });
          tempDirectories.delete(directory);
        }),
      );
    },

    async makeTempDir(prefix: string): Promise<string> {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
      tempDirectories.add(directory);
      return directory;
    },
  };
}

export function createSilentLogger(): Logger {
  return {
    info(): void {},
    success(): void {},
    warn(): void {},
    error(): void {},
    debug(): void {},
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

export function createRecordingLogger(messages: string[] = []): Logger {
  return {
    info(message: string): void {
      messages.push(stripAnsi(message));
    },
    success(message: string): void {
      messages.push(stripAnsi(message));
    },
    warn(message: string): void {
      messages.push(stripAnsi(message));
    },
    error(message: string): void {
      messages.push(stripAnsi(message));
    },
    debug(message: string): void {
      messages.push(stripAnsi(message));
    },
  };
}
