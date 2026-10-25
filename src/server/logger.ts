import pino from 'pino';
export const logger = pino({ base: undefined, timestamp: () => `,"timestamp":"${new Date().toISOString()}"` });
