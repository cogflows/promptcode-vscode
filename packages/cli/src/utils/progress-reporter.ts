/**
 * Progress Reporter
 *
 * Provides user feedback for long-running background tasks.
 * Uses the existing spinner utility which respects environment settings.
 */

import { spinner } from './spinner.js';

export class ProgressReporter {
  private spinnerInstance: ReturnType<typeof spinner> | null = null;
  private readonly silent: boolean;

  constructor(options?: { silent?: boolean }) {
    this.silent = options?.silent ?? false;
  }

  start(message: string): void {
    if (this.silent) {return;}
    this.spinnerInstance = spinner();
    this.spinnerInstance.start(message);
  }

  update(message: string): void {
    if (this.silent) {return;}
    if (this.spinnerInstance) {
      this.spinnerInstance.text = message;
    } else {
      // Fallback if spinner wasn't started
      console.error(message);
    }
  }

  complete(message: string): void {
    if (this.silent) {return;}
    if (this.spinnerInstance) {
      this.spinnerInstance.succeed(message);
      this.spinnerInstance = null;
    } else {
      console.error(`✓ ${message}`);
    }
  }

  error(message: string): void {
    if (this.silent) {return;}
    if (this.spinnerInstance) {
      this.spinnerInstance.fail(message);
      this.spinnerInstance = null;
    } else {
      console.error(`✗ ${message}`);
    }
  }
}
