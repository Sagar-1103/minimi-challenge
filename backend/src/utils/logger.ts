type LogData = Record<string, any> | Error | unknown;

const formatData = (data?: LogData): string => {
  if (data === undefined) return "";
  if (data instanceof Error) return `\n${data.stack ?? data.message}`;
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ` [Non-serializable data]`;
  }
};

const getTimestamp = (): string => new Date().toISOString();

export const logger = {
  info: (msg: string, data?: LogData): void => {
    console.log(`[${getTimestamp()}] [INFO] ${msg}${formatData(data)}`);
  },

  warn: (msg: string, data?: LogData): void => {
    console.warn(`[${getTimestamp()}] [WARN] ${msg}${formatData(data)}`);
  },

  error: (msg: string, data?: LogData): void => {
    console.error(`[${getTimestamp()}] [ERROR] ${msg}${formatData(data)}`);
  },

  agent: (step: number, action: string, detail?: LogData): void => {
    console.log(
      `[${getTimestamp()}] [AGENT step=${step}] ${action}${formatData(detail)}`
    );
  },
};
