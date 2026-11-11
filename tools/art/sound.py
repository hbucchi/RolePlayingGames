"""Turn generated sound effects into game sounds.

  python3 tools/art/sound.py KEY SECONDS take1.mp3 take2.mp3 take3.mp3 take4.mp3

Writes assets/sounds/KEY-1..4.mp3: leading silence removed, cut to SECONDS with a short fade-out,
loudness evened out (EBU R128, -16 LUFS, so no sound is much louder than another), mono 64 kbps.
Every sound has 4 takes; the game plays a random one so repeated hits don't sound mechanical.
Needs ffmpeg. Then add KEY to SOUND_KEYS in src/ui/audio.js.
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if len(sys.argv) != 7: sys.exit(__doc__)
key, dur, takes = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
for i, src in enumerate(takes, 1):
    out = os.path.join(ROOT, f'assets/sounds/{key}-{i}.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af',
                    f'silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:{dur},'
                    f'afade=t=out:st={max(0, dur - 0.25)}:d=0.25,loudnorm=I=-16:TP=-1.5',
                    '-ac', '1', '-b:a', '64k', out], check=True)
    print('wrote', out)
