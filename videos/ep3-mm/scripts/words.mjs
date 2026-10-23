// Word (Thai: per-character) timestamps of the processed narration -> scripts/words/pNN.json, read by build_frames.py.
// Setup as in transcribe.mjs, then: cp scripts/words.mjs /tmp/asr/ && node /tmp/asr/words.mjs $PWD/scripts/words $PWD/assets/audio/voice/p*.m4a
import { pipeline, env } from '@huggingface/transformers';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
env.allowRemoteModels = false; env.localModelPath = '/tmp/asr/package/models/';
const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
for (const f of process.argv.slice(3)) {
  const raw = execFileSync('ffmpeg', ['-v','error','-i',f,'-ac','1','-ar','16000','-f','f32le','-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  let out;
  try { out = await asr(x, { language: 'thai', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word' }); }
  catch (e) { console.error(f, e.message); continue; }
  const name = f.split('/').pop().replace('.m4a', '');
  writeFileSync(process.argv[2] + '/' + name + '.json', JSON.stringify(out.chunks.map(c => [c.timestamp[0], c.timestamp[1], c.text])));
  console.log(name, out.chunks.length);
}
