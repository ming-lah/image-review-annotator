import sharp from 'sharp';
import request from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';

export const actor = { actorId: randomUUID(), actorName: '测试人员' };
export const annotationInput = (extra: Record<string, unknown> = {}) => ({ id: randomUUID(), x: 0.25, y: 0.75, note: ' 标记说明 ', severity: 'medium', ...actor, ...extra });
export const imageBuffer = (format: 'png' | 'jpeg' | 'webp' = 'png', width = 32, height = 24) => sharp({ create: { width, height, channels: 3, background: '#27a7cc' } }).toFormat(format).toBuffer();
export function uploadImage(app: Express, bytes: Buffer, id: string = randomUUID(), filename = 'sample.png', contentType = 'image/png') {
  return request(app).post('/api/images').field('id', id).attach('file', bytes, { filename, contentType });
}
export function animatedPng(bytes: Buffer) {
  const data = Buffer.alloc(8); data.writeUInt32BE(2); data.writeUInt32BE(0, 4);
  const chunk = Buffer.concat([Buffer.from('acTL'), data]);
  let crc = 0xffffffff;
  for (const value of chunk) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([bytes.subarray(0, 33), length, chunk, checksum, bytes.subarray(33)]);
}
