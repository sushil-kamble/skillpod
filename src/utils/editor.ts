import path from 'node:path';
import { spawn } from 'node:child_process';

import { resolveExecutable } from './command.js';

export interface EditorService {
  open(
    targetPath: string,
    options?: {
      fallbackFilePath?: string;
      preferDirectory?: boolean;
    },
  ): Promise<{ opened: boolean; targetPath: string }>;
}

const FALLBACK_EDITORS = ['nano', 'vi'] as const;
const TERMINAL_EDITORS = new Set(['nano', 'vi', 'vim']);

async function resolveEditorCommand(): Promise<string | null> {
  const preferredEditor = process.env.EDITOR?.trim();

  if (preferredEditor) {
    const [binary] = preferredEditor.split(/\s+/);

    if (binary) {
      const executable = await resolveExecutable(binary);

      if (executable) {
        return preferredEditor;
      }
    }
  }

  for (const fallbackEditor of FALLBACK_EDITORS) {
    const executable = await resolveExecutable(fallbackEditor);

    if (executable) {
      return executable;
    }
  }

  return null;
}

function isTerminalEditor(command: string): boolean {
  const binaryName = path.basename(command.trim().split(/\s+/)[0] ?? '');
  return TERMINAL_EDITORS.has(binaryName);
}

function splitCommand(command: string): { file: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    throw new Error('Editor command cannot be empty.');
  }

  const [file, ...args] = parts;
  return { file: file ?? '', args };
}

async function launchEditor(command: string, filePath: string): Promise<void> {
  const { file, args } = splitCommand(command);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, [...args, filePath], {
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Editor exited with code ${code ?? 'unknown'}.`));
    });
  });
}

export const editorService: EditorService = {
  async open(
    targetPath: string,
    options?: {
      fallbackFilePath?: string;
      preferDirectory?: boolean;
    },
  ): Promise<{ opened: boolean; targetPath: string }> {
    const editorCommand = await resolveEditorCommand();

    if (!editorCommand) {
      return { opened: false, targetPath };
    }

    const resolvedTargetPath =
      options?.preferDirectory && options.fallbackFilePath && isTerminalEditor(editorCommand)
        ? options.fallbackFilePath
        : targetPath;

    await launchEditor(editorCommand, resolvedTargetPath);
    return { opened: true, targetPath: resolvedTargetPath };
  },
};
