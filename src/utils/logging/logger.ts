import chalk from 'chalk';

let debugEnabled = false;

export interface Logger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export function setDebugMode(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebugMode(): boolean {
  return debugEnabled;
}

export const logger: Logger = {
  info(message: string): void {
    console.log(`${chalk.blue('ℹ')} ${message}`);
  },

  success(message: string): void {
    console.log(`${chalk.green('✓')} ${chalk.green(message)}`);
  },

  warn(message: string): void {
    console.log(`${chalk.yellow('⚠')} ${chalk.yellow(message)}`);
  },

  error(message: string): void {
    console.error(`${chalk.red('✗')} ${chalk.red(message)}`);
  },

  debug(message: string): void {
    if (!debugEnabled) {
      return;
    }

    console.log(chalk.gray(`[debug] ${message}`));
  },
};
