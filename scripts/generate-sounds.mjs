/**
 * Generates the 9 UI sounds as small WAV files (plan §18 allows
 * self-generated audio). Pure Node — writes 44.1kHz 16-bit mono PCM.
 *
 *   node scripts/generate-sounds.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'apps', 'web', 'public', 'sounds');
mkdirSync(OUT, { recursive: true });

const RATE = 44100;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** tone segments: [{freq | [from,to], ms, gain, type}] with exponential decay envelope */
function synth(segments, { attack = 0.005, release = 0.4 } = {}) {
  const out = [];
  for (const seg of segments) {
    const n = Math.floor((seg.ms / 1000) * RATE);
    const [f0, f1] = Array.isArray(seg.freq) ? seg.freq : [seg.freq, seg.freq];
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const freq = f0 + (f1 - f0) * t;
      phase += (2 * Math.PI * freq) / RATE;
      let v;
      if (seg.type === 'noise') v = Math.random() * 2 - 1;
      else if (seg.type === 'triangle') v = (2 / Math.PI) * Math.asin(Math.sin(phase));
      else v = Math.sin(phase);
      const env = Math.min(1, i / (attack * RATE)) * Math.exp((-t * seg.ms) / (release * 1000));
      out.push(v * env * (seg.gain ?? 0.6));
    }
  }
  return out;
}

function mix(...tracks) {
  const len = Math.max(...tracks.map((t) => t.length));
  const out = new Array(len).fill(0);
  for (const t of tracks) for (let i = 0; i < t.length; i++) out[i] += t[i];
  return out;
}

const files = {
  // 80ms soft sine tick, 440→480Hz
  'hover.wav': synth([{ freq: [440, 480], ms: 80, gain: 0.5 }], { release: 0.06 }),
  // 120ms snappy click — short noise burst + low sine
  'click.wav': mix(
    synth([{ freq: 2000, ms: 25, gain: 0.25, type: 'noise' }], { release: 0.015 }),
    synth([{ freq: [900, 300], ms: 120, gain: 0.4 }], { release: 0.05 }),
  ),
  // 200ms rising sci-fi lock-on
  'node-select.wav': synth([{ freq: [520, 1040], ms: 200, gain: 0.45 }], { release: 0.12 }),
  // 400ms D-major bell (D5, F#5, A5)
  'ai-chime.wav': mix(
    synth([{ freq: 587.33, ms: 400, gain: 0.3 }], { release: 0.35 }),
    synth([{ freq: 739.99, ms: 400, gain: 0.22 }], { release: 0.3 }),
    synth([{ freq: 880.0, ms: 400, gain: 0.18 }], { release: 0.28 }),
  ),
  // 300ms whoosh with harmonic
  'expand.wav': mix(
    synth([{ freq: [200, 800], ms: 300, gain: 0.3 }], { release: 0.2 }),
    synth([{ freq: [400, 1600], ms: 300, gain: 0.12 }], { release: 0.15 }),
  ),
  // 500ms low thud + high shimmer
  'impact.wav': mix(
    synth([{ freq: [120, 45], ms: 500, gain: 0.6 }], { release: 0.25 }),
    synth([{ freq: [3000, 5000], ms: 350, gain: 0.06, type: 'noise' }], { release: 0.2 }),
  ),
  // 350ms ascending 3-note arpeggio (C5 E5 G5)
  'success.wav': synth(
    [
      { freq: 523.25, ms: 110, gain: 0.4 },
      { freq: 659.25, ms: 110, gain: 0.4 },
      { freq: 783.99, ms: 140, gain: 0.45 },
    ],
    { release: 0.12 },
  ),
  // 200ms descending minor 2-note
  'error.wav': synth(
    [
      { freq: 440, ms: 90, gain: 0.4, type: 'triangle' },
      { freq: 349.23, ms: 120, gain: 0.4, type: 'triangle' },
    ],
    { release: 0.1 },
  ),
  // 250ms glass ping
  'notification.wav': mix(
    synth([{ freq: 1318.5, ms: 250, gain: 0.3 }], { release: 0.2 }),
    synth([{ freq: 2637, ms: 180, gain: 0.12 }], { release: 0.12 }),
  ),
};

let total = 0;
for (const [name, samples] of Object.entries(files)) {
  const buf = wav(samples);
  writeFileSync(join(OUT, name), buf);
  total += buf.length;
  console.log(`${name.padEnd(18)} ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log(`total: ${(total / 1024).toFixed(1)} KB → ${OUT}`);
