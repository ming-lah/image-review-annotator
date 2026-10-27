import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { defaultDataDir, readConfig } from '../../src/server/config.js';

describe('configuration', () => {
  it('defaults to loopback and port 3002', () => {
    expect(readConfig({})).toMatchObject({ host: '127.0.0.1', port: 3002 });
  });
  it.each(['', '0', '-1', '65536', '3.5', '3000abc', ' 3000'])('rejects invalid PORT %s', port => {
    expect(() => readConfig({ PORT: port })).toThrow('PORT');
  });
  it('rejects relative and empty DATA_DIR', () => {
    expect(() => readConfig({ DATA_DIR: 'relative' })).toThrow('DATA_DIR');
    expect(() => readConfig({ DATA_DIR: '' })).toThrow('DATA_DIR');
  });
  it('accepts absolute override and explicit host', () => {
    expect(readConfig({ DATA_DIR: path.resolve('tests/.tmp/config-only'), HOST: '0.0.0.0', PORT: '4000', APP_ORIGIN: 'https://review.example.test' })).toMatchObject({ port: 4000, host: '0.0.0.0' });
  });
  it('rejects an empty HOST', () => expect(() => readConfig({ HOST: '' })).toThrow('HOST'));
  it('uses Windows LOCALAPPDATA and fallback', () => {
    expect(defaultDataDir('win32', { LOCALAPPDATA: 'C:\\Local' }, 'C:\\User')).toBe('C:\\Local\\ImageReviewAnnotator');
    expect(defaultDataDir('win32', {}, 'C:\\User')).toBe('C:\\User\\AppData\\Local\\ImageReviewAnnotator');
  });
  it('uses macOS Application Support', () => {
    expect(defaultDataDir('darwin', {}, '/users/test')).toBe('/users/test/Library/Application Support/ImageReviewAnnotator');
  });
  it('uses Linux XDG directory and fallback', () => {
    expect(defaultDataDir('linux', { XDG_DATA_HOME: '/data' }, '/users/test')).toBe('/data/ImageReviewAnnotator');
    expect(defaultDataDir('linux', {}, '/users/test')).toBe('/users/test/.local/share/ImageReviewAnnotator');
  });
});
