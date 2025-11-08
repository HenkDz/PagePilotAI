type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

type LogMethod = (message: string, context?: LogContext) => void;

const NAMESPACE = 'PagePilot';

const format = (level: LogLevel, message: string) => {
  const prefix = `[${NAMESPACE}]`;
  return `${prefix} ${level.toUpperCase()} ${message}`;
};

const log = (level: LogLevel, message: string, context?: LogContext) => {
  const payload = context ?? {};
  switch (level) {
    case 'debug':
      console.debug(format(level, message), payload);
      break;
    case 'info':
      console.info(format(level, message), payload);
      break;
    case 'warn':
      console.warn(format(level, message), payload);
      break;
    case 'error':
    default:
      console.error(format(level, message), payload);
      break;
  }
};

const createLogger = (scope?: string) => {
  const scoped = scope ? `${scope}` : undefined;
  const buildContext = (context?: LogContext): LogContext | undefined => {
    if (!scoped) {
      return context;
    }

    return {
      scope: scoped,
      ...(context ?? {}),
    };
  };

  const withLevel = (level: LogLevel): LogMethod => {
    return (message, context) => log(level, message, buildContext(context));
  };

  return {
    debug: withLevel('debug'),
    info: withLevel('info'),
    warn: withLevel('warn'),
    error: withLevel('error'),
    child: (childScope: string) => createLogger(scoped ? `${scoped}:${childScope}` : childScope),
  };
};

export const logger = createLogger();

export type Logger = ReturnType<typeof createLogger>;
