import * as path from 'path';
import { SelectedFile } from '../types/selectedFile.js';

/**
 * List of supported image file extensions (lowercase, with leading dot).
 * Includes common JPEG variants to maximize compatibility.
 */
export const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.jpe',
  '.jfif',
  '.pjpeg',
  '.pjp',
  '.gif',
  '.bmp',
  '.webp',
  '.tiff',
  '.tif',
  '.avif',
  '.svg',
];

const IMAGE_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.pjpeg': 'image/jpeg',
  '.pjp': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

export const IMAGE_GLOB_PATTERNS = Array.from(
  new Set(IMAGE_EXTENSIONS.map((ext) => `**/*${ext}`))
);

export function normalizeExt(ext: string): string {
  if (!ext) {return '';}
  return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

/**
 * Determines the MIME type for a given file extension.
 * @param ext File extension (with or without leading dot, case-insensitive)
 * @returns MIME string or undefined when unsupported
 */
export function mimeFromExt(ext: string): string | undefined {
  return IMAGE_MIME_MAP[normalizeExt(ext)];
}

/**
 * Checks whether a file should be treated as an image based on extension or isImage flag.
 * @param file File-like object containing path, absolutePath, or isImage boolean
 * @returns true if the file is a supported image format
 */
export function isImageFile(
  file: Pick<SelectedFile, 'path' | 'absolutePath' | 'isImage'> | { path?: string; absolutePath?: string; isImage?: boolean } | null | undefined
): boolean {
  if (!file) {return false;}
  if (file.isImage === true) {return true;}

  const candidate = file.path || file.absolutePath;
  if (typeof candidate !== 'string') {return false;}

  const extname = path.extname(candidate);
  if (!extname) {return false;}
  const ext = normalizeExt(extname);
  return IMAGE_EXTENSIONS.includes(ext);
}
