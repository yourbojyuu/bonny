// Rough Thai transcript of narration files, to check which recording belongs to which page and find cut points.
// No model download host is reachable from the sandbox; the npm package sts-whisper-small ships whisper-small (ONNX q8):
//   mkdir -p /tmp/asr && cd /tmp/asr && npm pack sts-whisper-small && tar xzf sts-whisper-small-*.tgz && npm i @huggingface/transformers@3
//   cp scripts/transcribe.mjs /tmp/asr/ && node /tmp/asr/transcribe.mjs seg|plain|word $PWD/source/audio-raw/*.mp3   (ESM resolves imports next to the script)
import { pipeline, env } from '@huggingface/transformers';
import { execFileSync } from 'child_process';
env.allowRemoteModels = false; env.localModelPath = '/tmp/asr/package/models/';
const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
const mode = process.argv[2];
for (const f of process.argv.slice(3)) {
  const raw = execFileSync('ffmpeg', ['-v','error','-i',f,'-ac','1','-ar','16000','-f','f32le','-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const out = await asr(x, { language: 'thai', task: 'transcribe', ...(x.length > 16000*30 ? {chunk_length_s: 30, stride_length_s: 5} : {}), ...(mode === 'plain' ? {} : {return_timestamps: mode === 'word' ? 'word' : true}) });
  console.log(JSON.stringify({ file: f, text: out.text, chunks: out.chunks }));
}
