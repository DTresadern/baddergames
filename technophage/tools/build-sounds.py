#!/usr/bin/env python3
"""Cut, normalise and encode chosen sound effects into assets/sfx/.

Run from technophage/:  python3 tools/build-sounds.py [--src /path/to/soundpacks]
Needs ffmpeg with libmp3lame. Writes assets/sfx/<slot>_<n>.mp3 and assets/sfx/sfx.json.

Each game sound slot (names used by src/audio.js) lists one or more variants; the game
picks a variant at random per play. A slot that is not listed here keeps its
synthesised sound. See ../soundpacks/INDEX.md for the catalogue the picks came from.
"""
import argparse
import json
import os
import re
import subprocess
import tempfile

DEFAULT_SRC = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'soundpacks'))
OUT = 'assets/sfx'
PEAK_DB = -1.0  # normalise every variant to this peak, then apply the slot gain in-game

# slot: { files: [(path, start_s, duration_s or None), ...], gain: 0..1, pitch: random +/- rate }
YT = 'YT Mailing List Bonus Pack (50$ value)/'
SELECTION = {
    # weapons
    'pulse': {'files': [('gen/blat_12.wav', 0, 0.22)], 'gain': 0.45, 'pitch': 0.07},
    'coil': {'files': [('gen/blatmod1.wav', 0, 0.8), ('gen/blat_13.wav', 0, 0.7)], 'gain': 0.9, 'pitch': 0.03},
    'eshot': {'files': [('gen/Shot1/metal_debris_08.wav', 0, 0.35), ('gen/Shot3/metal_debris_23.wav', 0, 0.35)], 'gain': 0.3, 'pitch': 0.08},
    'throw': {'files': [(YT + 'WeaponSwings/SFX_Weapon_Swing31.wav', 0, None)], 'gain': 0.5},
    'empty': {'files': [(YT + 'SingleClicks/SingleClicks01.wav', 0, 0.2)], 'gain': 0.5},
    # impacts and destruction
    'explode': {'files': [('gen/Rocket1/metal_debris_08.wav', 0, 1.8), ('gen/debris-20261006-184027.wav', 0, 2.2), ('gen/debris-20261006-202220.wav', 35.55, 1.27)], 'gain': 0.8, 'pitch': 0.05},
    'mechdie': {'files': [('gen/debris-20261006-204610.wav', 116.16, 2.06), ('gen/Impact2/metal_debris_03.wav', 0, 1.5)], 'gain': 0.7},
    'crate': {'files': [('gen/Impact1/metal_debris_03.wav', 0, 0.9), ('gen/variants6/metal_debris_01.wav', 0, 0.9)], 'gain': 0.55},
    'debris': {'files': [('gen/debris-20261006-215720.wav', 8.10, 2.0), ('gen/variants6/metal_debris_01.wav', 0, 1.2)], 'gain': 0.55},
    'ricochet': {'files': [('gen/debris-20261006-210231.wav', 0, 1.1), ('gen/debris-20261006-205836.wav', 14.35, 1.34)], 'gain': 0.25, 'pitch': 0.1},
    'rumble': {'files': [('gen/debris-20261006-202220.wav', 9.66, 1.28)], 'gain': 0.55},
    'mortar': {'files': [('gen/variants6/metal_debris_03.wav', 0, 0.8)], 'gain': 0.5},
    'land': {'files': [('gen/Impact3/metal_debris_08.wav', 0, 0.35), ('gen/Shot7/metal_debris_14.wav', 0, 0.35)], 'gain': 0.2, 'pitch': 0.08},
    'hurt': {'files': [('gen/Impact1/metal_debris_13.wav', 0, 0.5)], 'gain': 0.45, 'pitch': 0.06},
    # creatures
    'die': {'files': [(YT + 'Monster 10/Death/Monster10_Death3.wav', 0, None), (YT + 'Monster 10/Death/Monster10_Death2.wav', 0, None)], 'gain': 0.5, 'pitch': 0.12},
    'screech': {'files': [(YT + 'Monster 10/Calls/Monster10_Call4.wav', 0, None), (YT + 'Monster 10/Attack/Monster10_Attack5.wav', 0, None)], 'gain': 0.45, 'pitch': 0.1},
    'hiss': {'files': [(YT + 'Monster 10/Breathing/Monster10_Breathing4.wav', 0, 1.0)], 'gain': 0.4, 'pitch': 0.1},
    'roar': {'files': [(YT + 'Monster 10/Roars/Monster10_Roar1.wav', 0, None), (YT + 'Monster 10/Roars/Monster10_Roar2.wav', 0, None)], 'gain': 0.75},
    'burst': {'files': [(YT + 'Monster 10/Attack/Monster10_Attack4.wav', 0, None)], 'gain': 0.6},
    'spit': {'files': [(YT + 'WaterMagicSpells/CastShort/Water/High/Magic_Spells_CastShort_Water_High01.wav', 0, 0.45)], 'gain': 0.35, 'pitch': 0.1},
    'dash': {'files': [(YT + 'WeaponSwings/SFX_Weapon_Swing20.wav', 0, None), (YT + 'WeaponSwings/SFX_Weapon_Swing01.wav', 0, 0.6)], 'gain': 0.45},
    # interface and events
    'pickup': {'files': [(YT + 'UI Menu Sound FX Pack/Command Accepted/Command_Accepted_DDM4.wav', 0, None)], 'gain': 0.45},
    'weapon': {'files': [(YT + 'UI Menu Sound FX Pack/Command Accepted/Command_Accepted_DDM5.wav', 0, None)], 'gain': 0.55},
    'checkpoint': {'files': [(YT + 'UI Menu Sound FX Pack/Menu Sounds/MenuSound_1_DDM1.wav', 0, None)], 'gain': 0.5},
    'revive': {'files': [(YT + 'UI Menu Sound FX Pack/Transitions/High/Transitions_DDM21.wav', 0, 1.2)], 'gain': 0.45},
    'down': {'files': [(YT + 'UI Menu Sound FX Pack/Access Denied/Low and bassy/Access_Denied_Low_DDM1.wav', 0, None)], 'gain': 0.55},
    'alarm': {'files': [(YT + 'Small Alarms - Loopable/SmlAlarm_7_Single_DDM.wav', 0, None)], 'gain': 0.5},
    'ui': {'files': [(YT + 'SingleClicks/SingleClicks18.wav', 0, None)], 'gain': 0.5},
}
# Kept synthesised (no good match in the packs): flame, beam, jump, gate, clink, heartbeat, ambience.


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=True)


def peak_db(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    m = re.search(r'max_volume: (-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else 0.0


def build_variant(src, start, dur, out):
    with tempfile.TemporaryDirectory() as tmp:
        cut = os.path.join(tmp, 'cut.wav')
        cmd = ['ffmpeg', '-hide_banner', '-y']
        if start:
            cmd += ['-ss', str(start)]
        if dur:
            cmd += ['-t', str(dur)]
        # mono, trim leading silence, short fade-out so cuts never click
        fade = 0.03 if not dur else min(0.08, dur / 4)
        filters = 'silenceremove=start_periods=1:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_threshold=-60dB,afade=t=in:d=%s,areverse' % fade
        cmd += ['-i', src, '-ac', '1', '-ar', '44100', '-af', filters, cut]
        run(cmd)
        gain = PEAK_DB - peak_db(cut)
        run(['ffmpeg', '-hide_banner', '-y', '-i', cut, '-af', f'volume={gain:.2f}dB', '-c:a', 'libmp3lame', '-b:a', '96k', out])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=DEFAULT_SRC, help='soundpacks folder')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.mp3'):
            os.remove(os.path.join(OUT, f))
    manifest = {'note': 'Generated by tools/build-sounds.py. Do not edit by hand.', 'slots': {}}
    total = 0
    for slot, d in SELECTION.items():
        files = []
        for i, (path, start, dur) in enumerate(d['files']):
            name = f'{slot}_{i + 1}.mp3'
            out = os.path.join(OUT, name)
            build_variant(os.path.join(args.src, path), start, dur, out)
            size = os.path.getsize(out)
            total += size
            files.append(name)
            print(f'{slot:12s} {name:18s} {size / 1024:6.1f} KB  <- {path}' + (f' @{start}s' if start else ''))
        manifest['slots'][slot] = {'files': files, 'gain': d.get('gain', 1), 'pitch': d.get('pitch', 0.04)}
    with open(os.path.join(OUT, 'sfx.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(f'total {total / 1024:.0f} KB in {sum(len(d["files"]) for d in SELECTION.values())} files')


if __name__ == '__main__':
    main()
