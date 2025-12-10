import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isImageFile, mimeFromExt } from '../../../core/src/utils/images';
import { __expertTestHooks, expertCommand } from '../../src/commands/expert';
import { EXIT_CODES } from '../../src/utils/exit-codes';

const { toImageAttachments } = __expertTestHooks;

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOb7hL8AAAAASUVORK5CYII=',
  'base64'
);

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptcode-images-'));
}

function writePng(dir: string, filename: string, extraBytes = 0) {
  const target = path.join(dir, filename);
  const buffer = extraBytes > 0 ? Buffer.concat([ONE_BY_ONE_PNG, Buffer.alloc(extraBytes)]) : ONE_BY_ONE_PNG;
  fs.writeFileSync(target, buffer);
  return target;
}

describe('image helper utilities', () => {
  it('detects images regardless of extension casing and uncommon JPEG suffixes', () => {
    expect(isImageFile({ path: 'PHOTO.JPE' })).toBe(true);
    expect(isImageFile({ path: '/tmp/screenshot.JPEG' })).toBe(true);
    expect(isImageFile({ path: '/tmp/readme.txt' })).toBe(false);

    expect(mimeFromExt('.JPE')).toBe('image/jpeg');
    expect(mimeFromExt('.jpeg')).toBe('image/jpeg');
    expect(mimeFromExt('.unknown')).toBeUndefined();
  });

  it('handles null, undefined, and missing extensions gracefully', () => {
    expect(isImageFile(null)).toBe(false);
    expect(isImageFile(undefined)).toBe(false);
    expect(isImageFile({})).toBe(false);
    expect(isImageFile({ path: '' })).toBe(false);
    expect(isImageFile({ path: 'README' })).toBe(false);
    expect(isImageFile({ path: '/tmp/Makefile' })).toBe(false);
  });

  it('enforces max image count after deduplication', async () => {
    const dir = createTempDir();
    const first = writePng(dir, 'a.png');
    const second = writePng(dir, 'b.png');

    const attachments = await toImageAttachments(
      [
        { path: 'a.png', absolutePath: first },
        { path: 'b.png', absolutePath: second },
        { path: 'b.png', absolutePath: second } // duplicate should be ignored
      ],
      1,
      5 * 1024 * 1024
    );

    expect(attachments.length).toBe(1);
    expect(attachments[0].path).toBe('a.png');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('aggregates validation errors for oversized or unsupported images', async () => {
    const dir = createTempDir();
    try {
      const ok = writePng(dir, 'ok.png');
      const large = writePng(dir, 'too-big.png', 50_000); // force size over small limit
      const txt = path.join(dir, 'note.txt');
      fs.writeFileSync(txt, 'not an image');

      await expect(
        toImageAttachments(
          [
            { path: 'ok.png', absolutePath: ok },
            { path: 'too-big.png', absolutePath: large },
            { path: 'note.txt', absolutePath: txt }
          ],
          5,
          ONE_BY_ONE_PNG.length + 10 // make large file fail
        )
      ).rejects.toThrow(/Image validation failed/);

      try {
        await toImageAttachments(
          [
            { path: 'ok.png', absolutePath: ok },
            { path: 'too-big.png', absolutePath: large },
            { path: 'note.txt', absolutePath: txt }
          ],
          5,
          ONE_BY_ONE_PNG.length + 10
        );
      } catch (err) {
        const message = String((err as Error).message);
        expect(message).toContain('too-big.png');
        expect(message).toContain('note.txt');
      }

      await toImageAttachments([{ path: 'ok.png', absolutePath: ok }], 2, 100_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('expertCommand vision safeguards', () => {
  const originalExit = process.exit;
  const originalEnv = {
    PROMPTCODE_MOCK_LLM: process.env.PROMPTCODE_MOCK_LLM,
    PROMPTCODE_TEST: process.env.PROMPTCODE_TEST,
  };
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    process.env.PROMPTCODE_MOCK_LLM = '1';
    process.env.PROMPTCODE_TEST = '1';
  });

  afterEach(() => {
    process.exit = originalExit;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalEnv.PROMPTCODE_MOCK_LLM === undefined) {
      delete process.env.PROMPTCODE_MOCK_LLM;
    } else {
      process.env.PROMPTCODE_MOCK_LLM = originalEnv.PROMPTCODE_MOCK_LLM;
    }
    if (originalEnv.PROMPTCODE_TEST === undefined) {
      delete process.env.PROMPTCODE_TEST;
    } else {
      process.env.PROMPTCODE_TEST = originalEnv.PROMPTCODE_TEST;
    }
  });

  it('rejects image attachments for non-vision models', async () => {
    const img = writePng(tmpDir, 'vision.png');
    const exits: number[] = [];

    process.exit = ((code?: number): never => {
      exits.push(code ?? 0);
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;

    await expect(
      expertCommand('test vision', {
        images: [img],
        model: 'o3',
        yes: true,
        json: true,
        path: tmpDir,
      })
    ).rejects.toThrow(/exit/);

    expect(exits[0]).toBe(EXIT_CODES.INVALID_INPUT);
  });
});
