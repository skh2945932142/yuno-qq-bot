import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';

let cachedFfmpegPath;

// Cache the silk-sdk encode function after the first import so that subsequent
// calls to encodeTencentSilk don't pay the dynamic-import overhead each time.
let _silkEncode;
async function getSilkEncode() {
  if (!_silkEncode) {
    _silkEncode = (await import('silk-sdk')).encode;
  }
  return _silkEncode;
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function collectChildProcess(child, inputBuffer = null) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout?.on('data', (chunk) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderrChunks.push(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
        return;
      }

      reject(new Error(
        `ffmpeg exited with code ${code}${stderrChunks.length ? `: ${Buffer.concat(stderrChunks).toString('utf8').trim()}` : ''}`
      ));
    });

    if (inputBuffer && child.stdin) {
      child.stdin.end(inputBuffer);
    }
  });
}

async function locateFfmpegBinary(platform = process.platform) {
  const locator = platform === 'win32' ? 'where.exe' : 'which';
  const child = spawn(locator, ['ffmpeg'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const { stdout } = await collectChildProcess(child);
  const firstMatch = stdout.toString('utf8').split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return firstMatch || null;
}

export async function resolveFfmpegPath(options = {}) {
  if (!options.skipCache && cachedFfmpegPath !== undefined) {
    return cachedFfmpegPath;
  }

  const explicitPath = options.explicitPath ?? config.ffmpegPath;
  const exists = options.fileExists ?? fileExists;
  const locate = options.locateBinary ?? locateFfmpegBinary;

  let resolved = null;
  if (explicitPath && await exists(explicitPath)) {
    resolved = explicitPath;
  } else {
    try {
      resolved = await locate(options.platform);
    } catch {
      resolved = null;
    }
  }

  if (!options.skipCache) {
    cachedFfmpegPath = resolved;
  }

  return resolved;
}

export function resetFfmpegPathCache() {
  cachedFfmpegPath = undefined;
}

async function transcodeWithPipe(ffmpegPath, audioBuffer, options = {}) {
  const sampleRate = options.sampleRate ?? config.voiceSampleRate;
  const child = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    'pipe:0',
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    'pipe:1',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const result = await collectChildProcess(child, audioBuffer);
  return result.stdout;
}

async function transcodeWithTempFiles(ffmpegPath, audioBuffer, options = {}) {
  const sampleRate = options.sampleRate ?? config.voiceSampleRate;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yuno-voice-'));
  const inputPath = path.join(tempDir, 'input.mp3');
  const outputPath = path.join(tempDir, 'output.wav');

  try {
    await writeFile(inputPath, audioBuffer);
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-c:a',
      'pcm_s16le',
      outputPath,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await collectChildProcess(child);
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function transcodeAudioToSpeechPcm(audioBuffer, options = {}) {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Cannot transcode empty audio buffer');
  }

  const ffmpegPath = options.ffmpegPath || await resolveFfmpegPath(options);
  if (!ffmpegPath) {
    throw new Error('ffmpeg is not available');
  }

  try {
    return await (options.transcodeWithPipe ?? transcodeWithPipe)(ffmpegPath, audioBuffer, options);
  } catch (error) {
    if (options.disableTempFallback) {
      throw error;
    }

    return (options.transcodeWithTempFiles ?? transcodeWithTempFiles)(ffmpegPath, audioBuffer, options);
  }
}

export async function transcodeMp3ToSpeechPcm(mp3Buffer, options = {}) {
  return transcodeAudioToSpeechPcm(mp3Buffer, options);
}

export async function encodeTencentSilk(pcmOrWavBuffer, options = {}) {
  if (!pcmOrWavBuffer || pcmOrWavBuffer.length === 0) {
    throw new Error('Cannot encode empty pcm buffer');
  }

  const encodeImpl = options.encodeImpl || await getSilkEncode();
  return encodeImpl(pcmOrWavBuffer, {
    fsHz: options.sampleRate ?? config.voiceSampleRate,
    packetLength: 20,
    rate: options.rate ?? config.voiceBitrate,
    tencent: true,
    quiet: true,
  });
}
