// Word (Thai: per-character) timestamps of the processed narration -> scripts/words/pNN.json, read by build_frames.py.
// Setup as in transcribe.mjs (model under /tmp/asr), then:
//   python3 scripts/words_prep.py /tmp/asr/win && cp scripts/words.mjs /tmp/asr/ && node /tmp/asr/words.mjs /tmp/asr/win/manifest.json $PWD/scripts/words
import { pipeline, env } from '@huggingface/transformers';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
env.allowRemoteModels = false; env.localModelPath = '/tmp/asr/package/models/';
const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
const man = JSON.parse(readFileSync(process.argv[2], 'utf8')), pages = {};
for (const w of man) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', w.wav, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  let chunks = [];
  try { chunks = (await asr(x, { language: 'thai', task: 'transcribe', return_timestamps: 'word', no_repeat_ngram_size: 6 })).chunks; }
  catch (e) { console.error(w.wav, e.message); }
  const out = (pages[w.page] ??= []);
  let prev = '', rep = 0;
  for (const c of chunks) {
    const [a, b] = c.timestamp;
    if (a == null || a > w.len + 0.2) continue;                 // times past the window are hallucinated
    rep = c.text === prev ? rep + 1 : 0; prev = c.text;
    if (rep >= 3) continue;                                     // drop repetition loops
    out.push([+(w.offset + a).toFixed(2), +(w.offset + Math.min(b ?? a, w.len)).toFixed(2), c.text]);
  }
  console.log(w.page, w.offset, chunks.length);
}
for (const [p, ws] of Object.entries(pages)) writeFileSync(`${process.argv[3]}/${p}.json`, JSON.stringify(ws));
