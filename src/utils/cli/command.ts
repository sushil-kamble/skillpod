import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutable(command: string): Promise<string | null> {
  if (command.includes(path.sep)) {
    return (await isExecutable(command)) ? command : null;
  }

  const pathValue = process.env.PATH ?? '';
  const candidates = pathValue.split(path.delimiter).filter(Boolean);

  for (const directory of candidates) {
    const absolutePath = path.join(directory, command);

    if (await isExecutable(absolutePath)) {
      return absolutePath;
    }
  }

  return null;
}
