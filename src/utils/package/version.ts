import { promises as fs } from 'node:fs';

export async function getPackageVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL('../../package.json', import.meta.url);
    const packageJson = await fs.readFile(packageJsonPath, 'utf8');
    const parsedPackage = JSON.parse(packageJson) as { version?: unknown };

    return typeof parsedPackage.version === 'string' ? parsedPackage.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
