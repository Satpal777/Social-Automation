// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code: string;
      statusCode?: number;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.context = options.context;
  }
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class ConfigError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: 'CONFIG_ERROR', statusCode: 500, context });
  }
}

export class LinkedInApiError extends AppError {
  constructor(
    message: string,
    options?: { statusCode?: number; context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, {
      code: 'LINKEDIN_API_ERROR',
      statusCode: options?.statusCode ?? 502,
      context: options?.context,
      cause: options?.cause,
    });
  }
}

export class LLMProviderError extends AppError {
  constructor(
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, {
      code: 'LLM_PROVIDER_ERROR',
      statusCode: 502,
      context: options?.context,
      cause: options?.cause,
    });
  }
}

export class PublishError extends AppError {
  readonly contentItemId: string;

  constructor(
    message: string,
    contentItemId: string,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, {
      code: 'PUBLISH_ERROR',
      statusCode: 500,
      context: { contentItemId, ...options?.context },
      cause: options?.cause,
    });
    this.contentItemId = contentItemId;
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, context });
  }
}
