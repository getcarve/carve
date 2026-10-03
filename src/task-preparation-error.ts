/** An explicitly authored user-facing failure, never raw provider or native diagnostics. */
export class TaskPreparationError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly code = 'task_preparation_failed',
    readonly phase = 'preparation',
    readonly retryable = true,
  ) {
    super(message)
    this.name = 'TaskPreparationError'
  }
}
