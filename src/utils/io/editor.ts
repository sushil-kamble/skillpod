import path from 'node:path';
import { spawn } from 'node:child_process';

import { resolveExecutable } from '#utils/cli/command.js';

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
const PREFERRED_GUI_EDITORS = ['code', 'code-insiders'] as const;
const TERMINAL_EDITORS = new Set(['nano', 'vi', 'vim']);

interface EditorDependencies {
  env?: NodeJS.ProcessEnv;
  launchEditor?: (command: string, filePath: string) => Promise<void>;
  resolveExecutable?: (command: string) => Promise<string | null>;
}

async function resolveEditorCommand(dependencies: EditorDependencies = {}): Promise<string | null> {
  const env = dependencies.env ?? process.env;
  const resolve = dependencies.resolveExecutable ?? resolveExecutable;

  for (const guiEditor of PREFERRED_GUI_EDITORS) {
    const executable = await resolve(guiEditor);

    if (executable) {
      return executable;
    }
  }

  const preferredEditor = env.EDITOR?.trim();

  if (preferredEditor) {
    const [binary] = preferredEditor.split(/\s+/);

    if (binary) {
      const executable = await resolve(binary);

      if (executable) {
        return preferredEditor;
      }
    }
  }

  for (const fallbackEditor of FALLBACK_EDITORS) {
    const executable = await resolve(fallbackEditor);

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

export function createEditorService(dependencies: EditorDependencies = {}): EditorService {
  const launch = dependencies.launchEditor ?? launchEditor;

  return {
    async open(
      targetPath: string,
      options?: {
        fallbackFilePath?: string;
        preferDirectory?: boolean;
      },
    ): Promise<{ opened: boolean; targetPath: string }> {
      const editorCommand = await resolveEditorCommand(dependencies);

      if (!editorCommand) {
        return { opened: false, targetPath };
      }

      const resolvedTargetPath =
        options?.preferDirectory && options.fallbackFilePath && isTerminalEditor(editorCommand)
          ? options.fallbackFilePath
          : targetPath;

      await launch(editorCommand, resolvedTargetPath);
      return { opened: true, targetPath: resolvedTargetPath };
    },
  };
}

export const editorService: EditorService = createEditorService();
