import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export interface DemoFixture {
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
  expected: { status: number; code?: string; layer: string; reason: string };
  cases: string[];
}
export const longFilename = `长文件名布局验证_${'review-layout-'.repeat(7)}审阅图片.png`;

function grid(width: number, height: number) {
  const lines: string[] = [];
  for (let x = 0; x <= width; x += 100) lines.push(`<path d="M${x},0V${height}"/>`);
  for (let y = 0; y <= height; y += 100) lines.push(`<path d="M0,${y}H${width}"/>`);
  const targets = [[0.5, 0.5], [0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95], [0.5, 0.02]];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#eef5f1"/>
    <g fill="none" stroke="#91afa1" stroke-width="1">${lines.join('')}</g>
    <text x="30" y="130" font-family="Arial" font-size="30" fill="#163e30">IMAGE REVIEW DEMO ${width} x ${height} / 100px grid</text>
    ${targets.map(([x, y], index) => `<g transform="translate(${x * width},${y * height})" fill="none" stroke="#bd3434" stroke-width="3"><circle r="15"/><path d="M-24,0H24M0,-24V24"/><text x="${x > 0.8 ? -22 : 22}" y="28" text-anchor="${x > 0.8 ? 'end' : 'start'}" stroke="none" fill="#163e30" font-family="Arial" font-size="20">${index + 1}: ${x},${y}</text></g>`).join('')}
  </svg>`);
}

function pngChunk(type: string, data: Buffer) {
  const chunk = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const value of chunk) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, chunk, checksum]);
}
function pngChunks(bytes: Buffer) {
  const result: { type: string; data: Buffer }[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    result.push({ type: bytes.toString('ascii', offset + 4, offset + 8), data: bytes.subarray(offset + 8, offset + 8 + size) });
    offset += size + 12;
  }
  return result;
}
function animatedPng(first: Buffer, second: Buffer) {
  const chunks = pngChunks(first);
  const header = chunks.find(chunk => chunk.type === 'IHDR')!.data;
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2);
  function control(sequence: number) {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence); header.copy(data, 4, 0, 8);
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22);
    return pngChunk('fcTL', data);
  }
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  const frame = Buffer.concat(pngChunks(second).filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data));
  return Buffer.concat([first.subarray(0, 8), pngChunk('IHDR', header), pngChunk('acTL', animation), control(0),
    ...chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => pngChunk('IDAT', chunk.data)), control(1), pngChunk('fdAT', Buffer.concat([sequence, frame])), pngChunk('IEND', Buffer.alloc(0))]);
}

export async function generateDemoFixtures(directory: string, boundaries = false): Promise<DemoFixture[]> {
  fs.mkdirSync(directory, { recursive: true });
  const fixtures: DemoFixture[] = [];
  async function write(name: string, mime: string, bytes: Buffer, status: number, reason: string, code?: string, dimensions?: { width: number; height: number }, layer = 'server', cases = ['P4-M2']) {
    fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' });
    fixtures.push({ name, mime, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...dimensions, expected: { status, code, layer, reason }, cases });
  }
  const landscape = await sharp(grid(2000, 1500)).png().toBuffer();
  const jpeg = await sharp(landscape).jpeg({ quality: 90 }).toBuffer();
  await write('grid-landscape.png', 'image/png', landscape, 201, '静态网格横图', undefined, { width: 2000, height: 1500 }, 'browser-and-server', ['P3-M1', 'P3-M2', 'P4-M1', 'P4-M4']);
  await write('grid-landscape.jpg', 'image/jpeg', jpeg, 201, '静态 JPEG', undefined, { width: 2000, height: 1500 }, 'browser-and-server', ['P2-M2', 'P4-M1']);
  await write('grid-landscape.webp', 'image/webp', await sharp(landscape).webp({ quality: 90 }).toBuffer(), 201, '静态 WebP', undefined, { width: 2000, height: 1500 }, 'browser-and-server', ['P2-M2', 'P4-M1']);
  await write('grid-portrait.png', 'image/png', await sharp(grid(1200, 2000)).png().toBuffer(), 201, '竖图适应与滚动', undefined, { width: 1200, height: 2000 }, 'browser-and-server', ['P3-M3']);
  const tiny = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#27a7cc' } }).png().toBuffer();
  const second = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#cf6537' } }).png().toBuffer();
  await write('tiny.png', 'image/png', tiny, 201, '小图不自动放大', undefined, { width: 32, height: 24 }, 'browser-and-server', ['P2-M2', 'P3-M3']);
  await write(longFilename, 'image/png', landscape, 201, '长中文英文文件名换行', undefined, { width: 2000, height: 1500 }, 'browser-and-server', ['P3-M11', 'P4-M11']);
  await write('empty.png', 'image/png', Buffer.alloc(0), 400, '空文件', 'IMAGE_INVALID', undefined, 'browser-and-server');
  await write('broken.png', 'image/png', Buffer.from('not an image'), 400, '损坏文件', 'IMAGE_INVALID', undefined, 'browser-and-server');
  await write('unsupported.txt', 'text/plain', Buffer.from('unsupported text fixture'), 415, '不支持的文件类型', 'IMAGE_TYPE_UNSUPPORTED', undefined, 'browser-and-server');
  await write('jpeg-disguised-as-png.png', 'image/png', jpeg, 415, 'JPEG 字节与 PNG 声明不一致', 'IMAGE_TYPE_UNSUPPORTED');
  await write('oversized.png', 'image/png', Buffer.alloc(20 * 1024 * 1024 + 1), 413, '20 MiB + 1 字节；只证明大小限制', 'IMAGE_TOO_LARGE', undefined, 'browser-and-server');
  await write('too-wide.png', 'image/png', await sharp({ create: { width: 12001, height: 1, channels: 3, background: 'white' } }).png().toBuffer(), 400, '边长超过 12000', 'IMAGE_INVALID', { width: 12001, height: 1 }, 'browser-and-server');
  await write('too-many-pixels.png', 'image/png', await sharp({ create: { width: 8000, height: 5001, channels: 3, background: 'white' } }).png().toBuffer(), 400, '总像素超过 4000 万', 'IMAGE_INVALID', { width: 8000, height: 5001 }, 'browser-and-server');
  await write('animated.png', 'image/png', animatedPng(tiny, second), 415, '两帧 APNG', 'IMAGE_ANIMATION_UNSUPPORTED');
  await write('animated.webp', 'image/webp', await sharp([tiny, second], { join: { animated: true } }).webp({ loop: 0, delay: 100 }).toBuffer(), 415, '两帧 WebP', 'IMAGE_ANIMATION_UNSUPPORTED');
  await write('orientation-6.jpg', 'image/jpeg', await sharp(jpeg).withMetadata({ orientation: 6 }).jpeg().toBuffer(), 415, 'EXIF 方向为 6，须先转正', 'IMAGE_ORIENTATION_UNSUPPORTED');
  if (boundaries) {
    for (const [name, width, height] of [['edge-12000.png', 12000, 1], ['edge-40000000.png', 8000, 5000]] as const) {
      await write(name, 'image/png', await sharp({ create: { width, height, channels: 3, background: 'white' } }).png().toBuffer(), 201, '合法尺寸边界', undefined, { width, height }, 'browser-and-server', ['P4-M2']);
    }
  }
  return fixtures;
}
