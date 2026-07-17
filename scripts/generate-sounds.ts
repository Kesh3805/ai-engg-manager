/**
 * Sound generation script — run once with: npx tsx scripts/generate-sounds.ts
 * Generates all 9 UI sounds using the Web Audio API offline renderer.
 * Output: apps/web/public/sounds/*.wav
 * Requires: npm i -D @types/node (already present)
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// We use a minimal WAV encoder — no external deps
function encodeWAV(samples: Float32Array, sampleRate: number): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, 44 + i * 2);
  }
  return buf;
}

const SR = 44100;

function silence(dur: number): Float32Array {
  return new Float32Array(Math.floor(SR * dur));
}

function sine(freq: number, dur: number, vol = 0.4, fadeIn = 0.01, fadeOut = 0.1): Float32Array {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 1;
    if (t < fadeIn) env = t / fadeIn;
    else if (t > dur - fadeOut) env = (dur - t) / fadeOut;
    out[i] = Math.sin(2 * Math.PI * freq * t) * vol * env;
  }
  return out;
}

function noise(dur: number, vol = 0.15, fadeIn = 0.005, fadeOut = 0.05): Float32Array {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 1;
    if (t < fadeIn) env = t / fadeIn;
    else if (t > dur - fadeOut) env = (dur - t) / fadeOut;
    out[i] = (Math.random() * 2 - 1) * vol * env;
  }
  return out;
}

function mix(...arrays: Float32Array[]): Float32Array {
  const maxLen = Math.max(...arrays.map(a => a.length));
  const out = new Float32Array(maxLen);
  for (const a of arrays) for (let i = 0; i < a.length; i++) out[i] += a[i];
  return out;
}

function freqSweep(f0: number, f1: number, dur: number, vol = 0.3, fadeOut = 0.05): Float32Array {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const freq = f0 + (f1 - f0) * (t / dur);
    const env = t > dur - fadeOut ? (dur - t) / fadeOut : 1;
    out[i] = Math.sin(2 * Math.PI * freq * t) * vol * env;
  }
  return out;
}

function reverb(input: Float32Array, wet = 0.3): Float32Array {
  const out = new Float32Array(input.length);
  const delays = [1470, 2197, 3083, 4597];
  const gains  = [0.20, 0.15, 0.12, 0.09];
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i];
    for (let d = 0; d < delays.length; d++) {
      if (i >= delays[d]) out[i] += input[i - delays[d]] * gains[d] * wet;
    }
  }
  return out;
}

function concat(...arrays: Float32Array[]): Float32Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

// ── Sound definitions ────────────────────────────────────────────────────────

const sounds: Record<string, Float32Array> = {

  // hover: 80ms soft tick — 440Hz → 480Hz sweep
  'hover': freqSweep(440, 480, 0.08, 0.06, 0.02),

  // click: snappy 120ms — noise burst + 800Hz blip
  'click': mix(
    noise(0.03, 0.25, 0.001, 0.025),
    freqSweep(800, 600, 0.12, 0.12, 0.05)
  ),

  // node-select: 200ms sci-fi "lock-on" — rising tri-tone
  'node-select': reverb(mix(
    sine(880, 0.07, 0.20),
    concat(silence(0.07), sine(1100, 0.07, 0.18)),
    concat(silence(0.14), sine(1320, 0.10, 0.20))
  ), 0.25),

  // ai-chime: 400ms soft bell — D major chord with reverb
  'ai-chime': reverb(mix(
    sine(587.33, 0.40, 0.20, 0.005, 0.20), // D5
    sine(739.99, 0.40, 0.16, 0.005, 0.20), // F#5
    sine(880.00, 0.40, 0.12, 0.005, 0.20), // A5
  ), 0.45),

  // expand: 300ms whoosh with harmonic
  'expand': mix(
    freqSweep(200, 1200, 0.30, 0.08, 0.08),
    noise(0.15, 0.04, 0.01, 0.10)
  ),

  // impact: 500ms — low thud + high shimmer (blast radius)
  'impact': mix(
    sine(60, 0.50, 0.35, 0.001, 0.40),
    freqSweep(2000, 400, 0.25, 0.12, 0.10),
    noise(0.08, 0.18, 0.001, 0.07)
  ),

  // success: 350ms ascending 3-note arpeggio
  'success': reverb(concat(
    sine(523.25, 0.12, 0.22, 0.005, 0.04), // C5
    sine(659.25, 0.12, 0.22, 0.005, 0.04), // E5
    sine(783.99, 0.16, 0.22, 0.005, 0.10), // G5
  ), 0.30),

  // error: 200ms descending minor 2nd
  'error': mix(
    sine(400, 0.10, 0.25, 0.005, 0.04),
    concat(silence(0.10), sine(350, 0.12, 0.20, 0.005, 0.06)),
  ),

  // notification: 250ms glass ping
  'notification': reverb(mix(
    sine(1046.5, 0.25, 0.25, 0.003, 0.15), // C6
    sine(1318.5, 0.20, 0.15, 0.003, 0.15), // E6
  ), 0.40),
};

// ── Write to disk ────────────────────────────────────────────────────────────

const outDir = join(process.cwd(), 'apps', 'web', 'public', 'sounds');
mkdirSync(outDir, { recursive: true });

for (const [name, samples] of Object.entries(sounds)) {
  const wav = encodeWAV(samples, SR);
  const path = join(outDir, `${name}.wav`);
  writeFileSync(path, wav);
  console.log(`✓  ${name}.wav  (${(wav.length / 1024).toFixed(1)} KB)`);
}

console.log(`\n✅ All sounds written to ${outDir}`);
