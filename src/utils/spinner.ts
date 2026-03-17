import ora from 'ora';

export interface Spinner {
  start(text?: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

export interface SpinnerFactory {
  create(initialText?: string): Spinner;
}

export const spinnerFactory: SpinnerFactory = {
  create(initialText?: string): Spinner {
    const instance = ora(initialText);

    return {
      start(text?: string): void {
        instance.start(text);
      },
      succeed(text?: string): void {
        instance.succeed(text);
      },
      fail(text?: string): void {
        instance.fail(text);
      },
      stop(): void {
        instance.stop();
      },
    };
  },
};

export function createSilentSpinnerFactory(): SpinnerFactory {
  return {
    create(): Spinner {
      return {
        start(): void {},
        succeed(): void {},
        fail(): void {},
        stop(): void {},
      };
    },
  };
}
