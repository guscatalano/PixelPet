# Changelog

All notable changes to PixelPet are documented here. This project follows
[Semantic Versioning](https://semver.org/) (staying in `0.x` while pre-1.0).

## v0.2.0 — build your own cat

### New
- **Build a cat — no AI needed.** A new *Build a cat* panel in Settings lets you make a
  cat by hand: choose its build (normal, chonky, slim, kitten, fluffy, big-ears), coat
  pattern (solid, tabby, tuxedo, calico, color-points, bicolor), eye style, and colors —
  with a **live preview** that updates as you go. Prefer a surprise? Hit **🎲 Randomize**
  for a curated-random cat you can then tweak, and **Create** to add it to your pets. No
  API key required (the photo-based generator is still there as an optional third path).

## v0.1.0 — first public release

The first release of PixelPet: a procedural 8-bit pixel-art cat that lives on your
Windows desktop, sits on top of your windows, and gets on with its own little life.

### The pet
- **Transparent, always-on-top** cat with **per-pixel interaction** — only the cat's
  pixels catch the mouse; empty space stays click-through.
- **Drag it** anywhere, **click** it for a reaction, **hover** to greet it.
- **Lives on its own** — a personality-weighted ambient loop makes it wander, nap, loaf,
  sit in a sphinx, groom, and idle. Sleepy cats nap more; energetic cats roam and pounce more.
- **Real physics** — it walks along the tops of your windows, teeters at edges, and takes a
  tumble (legs scrabbling) if it drops.
- A whole roster of **built-in cats** — different builds, coats, and eye styles.

### Animations
- Idle, walk, **prance** (an excited, bouncier walk), sit, stand, loaf, sphinx, sleep
  (several curl-up positions), groom, teeter, crouch, pounce, fall, and a spooked "poof."
- One-shots: yawn, stretch, react, and pawing at you.
- A ¾ head-turn so the cat looks toward you.
- **Coat markings carry through every pose** — tabby stripes, tuxedo, calico, color-points,
  bicolor, and socks all stay on-model whether the cat is sitting, loafing, or walking.

### Care Mode (optional)
- A Tamagotchi-style layer with decaying needs (hunger, energy, fun, hygiene, health).
- Feed / play / heal by **dragging items** onto the cat; a sick cat wears a cone; a bored
  cat sulks. Difficulty setting tunes how fast needs decay.

### Dream Mode (optional)
- A sleeping cat shows floating **photo-bubble dreams**. Adjustable dream chance and
  **bubble size**; **double-click a dream to open the photo full-size**.
- Optional **Immich album** as a dream photo source.

### Create a pet from your photos (experimental)
- Point it at photos of your real pet to generate a matching pixel cat. Bring your own
  OpenAI or Anthropic key, or a local Ollama endpoint.

### App & settings
- **System tray** controls: show/hide, reset position, settings, check for updates.
- **Auto-update** — installed copies update themselves from GitHub Releases.
- Tabbed **settings window** (Pet / Animations / Care / Dreams) with search, a pet manager,
  size and personality controls, per-animation toggles, and a gallery to trigger any animation.

### Known limitations
- **Windows only** for now.
- Builds are **not code-signed yet**, so Windows SmartScreen shows an "unknown publisher"
  warning on first run — click **More info → Run anyway**. (Signing is on the roadmap.)
