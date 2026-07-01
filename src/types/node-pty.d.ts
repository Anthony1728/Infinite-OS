/**
 * Type declarations for node-pty
 * This is a fallback declaration when @types/node-pty is not installed
 */

declare module 'node-pty' {
  export interface IPty {
    pid: number;
    cols: number;
    rows: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    onData(callback: (data: string) => void): void;
    onExit(callback: (exit: { exitCode: number; signal: string }) => void): void;
  }

  export function spawn(
    shell: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): IPty;
}