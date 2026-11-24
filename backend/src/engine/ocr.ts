// Local OCR (tesseract.js, English data bundled in node_modules): the image never leaves our server for this step.
// Telegraph has no miner that can read text in an image, so this is the one non-Telegraph step of the image check.
// Memory: the worker is created on first use, handles one image at a time, and is shut down after 60 s idle.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
let workerPromise: Promise<import('tesseract.js').Worker> | null = null;
let idle: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0');
      return createWorker('eng', 1, { langPath, gzip: true, cachePath: join(tmpdir(), 'verita-tess') });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

async function shutdown() {
  const p = workerPromise; workerPromise = null;
  if (p) { try { await (await p).terminate(); } catch { /* already gone */ } }
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('OCR timed out')), ms))]);

/**
 * Small or compressed screenshot text is misread badly as it is (tested: 0 of 6 links right raw, 4-5 of 6 after this).
 * Enlarge, grayscale, stretch contrast, sharpen. If anything fails we read the original.
 */
export async function preprocess(image: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(image, { limitInputPixels: 50_000_000 }).metadata();
    const width = Math.min(2400, Math.max(1600, Math.round((meta.width ?? 400) * 3)));
    return await sharp(image, { limitInputPixels: 50_000_000 }).flatten({ background: '#ffffff' }).resize({ width, kernel: 'lanczos3' }).grayscale().normalise().sharpen().png().toBuffer();
  } catch { return image; }
}

/** Read the text in an image. Jobs run one after another (a free server cannot afford two at once). */
export function ocr(image: Buffer): Promise<{ text: string; confidence: number }> {
  const job = queue.then(async () => {
    if (idle) clearTimeout(idle);
    try {
      const worker = await getWorker();
      const { data } = await withTimeout(worker.recognize(await preprocess(image)), 25_000);
      return { text: data.text ?? '', confidence: Number(data.confidence) || 0 };
    } catch (e) {
      await shutdown(); // a stuck or broken worker is replaced on the next image
      throw e;
    } finally {
      idle = setTimeout(() => { void shutdown(); }, 60_000);
      idle.unref?.();
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
