---
workflow: general-video
flow: automation
message: "การสนับสนุนทำให้ภาวะผู้นำสร้างบรรยากาศองค์กรได้แรงขึ้น (Enhancing) แต่ผลยังไม่ส่งต่อถึง RU"
destination: youtube
aspect: 1920x1080
language: th
audience: "ผู้เรียนวิชาโมเดลสมการโครงสร้าง / ผู้สนใจ ADANCO"
length: "~15 min including the 8:25 demo clip"
angle: "สไลด์บรรยายเสียงพากย์ (EP3 ตอนสุดท้ายของซีรีส์) ตาม videos/STYLE-GUIDE.md"
---

## Intent

EP 3 ของซีรีส์ "Phuchit × ADANCO": ผลแรงขึ้นเมื่อไร — Moderation LEAD × SUPP → ORGA, simple slope, สรุปทั้งซีรีส์และปิดท้าย.
หน้า 36–49 ของเด็ค (หน้า 36 = หน้าแรกของตอน). Built from `videos/ep2-sem/` (same scripts, fonts, GSAP, SFX palette).

## Assets

- Slide deck — https://claude.ai/artifact/K8CmGMY9XoxP4J8HcDecxA, slides `ep3` … `finale` → `source/slides/`
- Narration — Drive folder 1d0VpsRw3-i6pj3N3iyO9-_spO9zyiO1R, `EP3:MOD-01..11.mp3` → `source/audio-raw/EP3-MOD-NN.mp3`.
  Files are not one per page: see the table in SCRIPT.md (05 ↔ 06 swapped, 07 covers 42–43, 09 unused, 45–47 not recorded).
- Demo clip — `EP3-MOD.mp4` (79.9 MB, Drive) → `assets/video/EP3-MOD.mp4`; too large for the Drive connector, push it via GitHub Desktop
- ADANCO screenshots — 4 deck assets (page 42) → `assets/img/`

## Pipeline

1. `python3 scripts/edit_clip.py` — clip 13:49 → 8:25: speech 1.08×, silent stretches ≥ 0.8 s squeezed to ~0.6 s (≤ 12×)
2. `python3 scripts/make_preview.py` — 12 s montage of the clip for the clip box on page 40
3. `python3 scripts/process_voice.py` — page-keyed voice files `assets/audio/voice/pNN.m4a` (VOICE table: recording, cut points);
   pauses > 0.38 s cut to 0.30 s, 1.07× (pitch kept), shared EQ/compression, two-pass loudness −16 LUFS;
   clip voice levelled harder and EQ-matched to the narration's spectrum
4. word times: `node /tmp/asr/words.mjs scripts/words assets/audio/voice/p*.m4a` (see `scripts/transcribe.mjs` for the model setup) — rerun after step 3
5. `python3 scripts/make_sfx.py` (palette already built; only needed if the SFX change)
6. `python3 scripts/build_frames.py` — scene schedule, reveals, cues (`CUES`), SFX, `index.html`
7. `npx hyperframes@0.8.185 check` → snapshot → render

## Timing to the words

`scripts/words/pNN.json` holds whisper-small timestamps of the processed narration (Thai comes out with a time per
character). `when()` aligns the SCRIPT.md text to that transcript character by character; every matched run of 4+
characters is a time anchor, and a cue word between anchors is placed by speaking weight. So every reveal, drag,
punch-in, ring and line draw lands on the spoken word, not on an estimate. Pages without a transcript fall back to
the EP2 estimator. A page with no recording yet gets a short silent reading hold (7–16 s); drop the file in and rerun 3, 4, 6.

Arrows grow from their start point with the arrowhead riding the tip (SVG `<line>` x2/y2 tween), so no head waits at the end.
