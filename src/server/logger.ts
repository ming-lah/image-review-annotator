// 需要补上
// 1. 记录启动的情况
// 2. 运行错误
// 3. ...
import pino from 'pino';
export const logger = pino({ base: undefined, timestamp: () => `,"timestamp":"${new Date().toISOString()}"` });
