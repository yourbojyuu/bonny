---
workflow: general-video
flow: automation
message: "การสนับสนุนทำให้ภาวะผู้นำสร้างบรรยากาศองค์กรได้แรงขึ้น (Enhancing) แต่ผลยังไม่ส่งต่อถึง RU"
destination: youtube
aspect: 1920x1080
language: th
audience: "ผู้เรียนวิชาโมเดลสมการโครงสร้าง / ผู้สนใจ ADANCO"
length: "~9 min narration + demo clip"
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

1. `python3 scripts/edit_clip.py` (once `assets/video/EP3-MOD.mp4` is in place)
2. `python3 scripts/process_voice.py` — page-keyed voice files `assets/audio/voice/pNN.m4a` (VOICE table: recording, cut points)
3. `python3 scripts/make_sfx.py` (palette already built; only needed if the SFX change)
4. `python3 scripts/build_frames.py` — scene schedule, reveals, cues (`CUES`), SFX, `index.html`
5. `npx hyperframes@0.8.185 check` → snapshot → render

## Timing to the words

Same estimator as EP2 (`when()` spreads the SCRIPT.md text over the voiced audio). For EP3 the SCRIPT.md text was
corrected to what the recordings actually say, using a rough whisper-small transcript (`scripts/transcribe.mjs`).
A page with no recording yet is held for about as long as its outline text takes to say, silent, with cues on that estimate;
drop the file in and rerun steps 2 and 4.
