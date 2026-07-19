# Creature packs

A **creature pack** is a small JSON file that describes an animal PixelPet can be —
cat, dog, rabbit, fox…. It's pure, validated data (no code), so packs are safe to
share and install. In the app: **Settings → Build a creature → Import…** to load one,
or **Export** to save the creature you're editing.

Two example packs live here: [`dog-rex.pixelpet.json`](dog-rex.pixelpet.json) and
[`rabbit-clover.pixelpet.json`](rabbit-clover.pixelpet.json).

## Format

```jsonc
{
  "pixelpet": 1,               // format marker
  "kind": "creature",
  "creature": {
    "name": "Rex",             // shown in the app (≤ 24 chars)
    "species": "Dog",          // free-text label
    "author": "you",
    "style": {                 // the SILHOUETTE — what makes the species
      "build": "normal",       // proportion archetype: normal | chonky | slim | kitten | fluffy | bigears
      "earStyle": "floppy",    // pointy | tufted | floppy
      "eyeStyle": "round",     // round | almond | sleepy
      "snout": 3.4,            // 0 = flat cat face; >0 = a muzzle (dog). ~0–6
      "headRx": 10, "headRy": 9.5,   // head size (6–14)
      "bodyRx": 13, "bodyRy": 9.5,   // body size (8–16 / 8–14)
      "earW": 6.5, "earH": 8.5, "earSpread": 7.5   // ear size/spacing
    },
    "coat": {                  // colors (hex)
      "primary": "#a6743f",
      "secondary": "#7d5330",  // stripes / points / patches, depending on marking
      "white": "#f4f4f7",      // belly/bib for tuxedo/bicolor/calico
      "tertiary": "#3a3038",   // second calico patch color
      "iris": "#5a3a22",
      "nose": "#3a2a20"
    },
    "marking": "solid",        // solid | tabby | tuxedo | calico | points | bicolor
    "personality": {           // each 0..1 — how it behaves
      "energy": 0.78, "sleepiness": 0.35, "affection": 0.9,
      "mischief": 0.5, "curiosity": 0.7, "independence": 0.3
    }
  }
}
```

Everything is **clamped and validated on import** — unknown values fall back to safe
defaults, so a malformed pack can never break the app. A bare `creature` object (without
the `pixelpet`/`kind` wrapper) is also accepted.

## Notes & limits

- **Shared skeleton (for now).** Every creature reuses PixelPet's pose set and animation
  graph, so it sits / walks / sleeps / grooms out of the box. Pack-defined *custom* poses
  and animations are on the roadmap.
- **Four-legged mammals.** The rig is a cat/dog/rabbit/fox body plan; birds and snakes
  aren't expressible yet.
- Tune the numbers and reload with **Import…** to iterate on a look.
