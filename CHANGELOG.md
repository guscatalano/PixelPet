# Changelog

All notable changes to PixelPet are documented here. This project follows
[Semantic Versioning](https://semver.org/) (staying in `0.x` while pre-1.0).

## v0.11.0 — collars, and a crash finally cornered

### New
- **Collars.** Put one on any cat — the built-ins included — in *Settings → Look → Collar*,
  pick the band and tag colours, and take it off again whenever you like. It's an accessory
  rather than part of the animal, so it doesn't change the creature underneath: switch pets
  and each one remembers whether it's wearing one.
- **Start on boot** (*Settings → Behavior → Startup*), so your pet is there when you log in.
  It's an ordinary Windows startup entry, visible and removable from Task Manager too. The
  Store version leaves this to Windows, and says so.
- **A flop.** Your pet now flops over on its side and just lies there for a while, breathing.
  Sometimes it rolls onto its back and wriggles; sometimes it doesn't.
- **An ear scratch.** A back foot comes up and goes at it.

### Changed
- **Independence does something now.** It used to be a minor modifier on Affection and
  almost nothing else. It now decides *where* your pet goes: an independent one takes
  itself off to the other end of the screen, a dependent one comes over and settles near
  your mouse pointer.
- **The Behavior tab explains itself.** Hovering a personality slider now tells you what
  that trait actually changes and what each end of it does — no more guessing what
  "Curiosity" is for. Same for the Movement and Startup rows.
- **Tabbies look like tabbies.** The stripes used to run diagonally, like pinstripes on a
  shirt, and wrapped the tail and legs the long way. Now they're the markings a real
  mackerel tabby has: the **M** on the forehead, a line sweeping back off each eye, narrow
  vertical bars down the flanks, a dark line along the spine, **rings** around the tail and
  **bracelets** on the legs.
- **The animation tiles explain themselves too.** Hovering one in *Settings → Behavior →
  Animations* now tells you what that animation is and what makes your pet do it — that
  zoomies are rare on purpose, that the belly roll only ever happens partway through a
  flop, that the ear scratch is an itch rather than a mood. Tiles that can't be turned off
  say so.

### Fixed
- **The crash.** `Math.round()` returns negative zero for anything just below zero, and
  Windows rejects that as a window coordinate — so a cat resting against the left edge of
  your screen could take the whole app down. It slipped past the existing safety net twice
  over, because `-0` counts as both a finite number and as equal to zero. Every computed
  window coordinate now goes through one guard, with a test to keep it that way.
- The sitting pose no longer floats a few pixels off the ground.

## v0.10.0 — moves like the real thing

Everything here came out of comparing the animations against research on how cats
actually move — footfall patterns, hunting posture, breathing and blinking.

### New
- **A “Faces you” control** (*Settings → Look → Drawing*). Your pet used to turn and look
  at you at the end of *every* action, which reads more like staring than like a cat. Now
  it's a dial — 40% by default, so it rests in profile most of the time and looking at you
  means something.

### Changed
- **Stalking looks like hunting now.** Your pet creeps a little, freezes stock-still to
  watch — mid-step, one paw up — then creeps again, with its tail held low and stretched
  out behind, only the tip flicking. It used to slink along continuously with its tail up,
  which read as *pleased with itself* rather than *hunting something*.
- **Trot is a real trot.** It's a two-beat gait — diagonal pairs of legs moving together —
  rather than the bouncier walk it used to be, which made it nearly indistinguishable from
  the prance.
- **Zoomies bound rather than prance.** A cat at full tilt is airborne most of each stride,
  so it now uses the bounding silhouette.
- **Breathing looks right.** Resting and sleeping pets were breathing at roughly half the
  rate of a real cat, shallowly enough to be nearly invisible at small sizes. An unwell pet
  now breathes *faster*, not slower, which is what actually happens.
- **Blinking is no longer clockwork.** Every resting pose blinked in perfect lockstep on a
  fixed timer; blinks are now irregular, as they should be.
- **A livelier wiggle** before a pounce — several quick shimmies instead of one slow lean.

### Fixed
- The Settings window now comes to the front when you ask for it again while it's already
  open but buried behind something else.

## v0.9.0 — how a cat actually moves

### New
- **A “Faces you” control** (*Settings → Look → Drawing*). Your pet used to turn and look
  at you at the end of *every* action, which reads more like staring than like a cat. Now
  it's a dial — 40% by default, so it rests in profile most of the time and looking at you
  means something.

### Changed
- **The string toy is a proper hunt.** Instead of standing still and patting the air, your
  pet now stares, stalks into range, crouches, and **jumps** at the string. The string is a
  real simulated rope — it bends, lags and whips when a paw connects — and it drifts about
  like something alive, occasionally darting out of reach so your pet misses and has to try
  again. Sometimes it catches it properly, drags it down, and the string wriggles free.
- **Zoomies actually look like zoomies** — roughly four times faster, exploding out of each
  turn and skidding into the next, rather than gliding along at a brisk walk.
- **Kneading is slow and dreamy**, about a second and a half per push, and no longer
  metronomic: the depth, the pauses and the number of pushes all vary.
- **A hop is one or two bounds**, the way a cat clears a gap — it used to bunny-hop up to
  forty times in a row across the whole screen. (Rabbits still bound continuously; that's
  their gait, not a hop.)
- **Trot is now brisker than prance**, so the two are finally distinguishable — they were
  moving at exactly the same speed.
- Running pets no longer pedal their legs at a comical rate: stride *length* grows with
  speed, the way a real cat's does, instead of the legs simply spinning faster.

### Fixed
- **Your pet no longer falls through window edges it's standing on.** Windows keeps the
  lock screen's windows around invisibly, above everything else, and v0.7's new z-order
  check counted them as covering every ledge on your main monitor. They're now ignored.
- A rare crash that could take the app down while your pet was moving. If anything like it
  happens again the pet recovers instead of dying, and records what went wrong.

## v0.8.0 — something to play with

### New
- **A string toy.** Every so often a string dangles down in front of your pet and it has a
  go at it — a couple of swipes, and the string swings properly when a paw connects.
  Playful, curious and bored pets reach for it most. Toggleable in *Settings → Behavior*
  like every other animation.

## v0.7.0 — up on the furniture

### New
- **Your pet climbs onto your windows.** Until now it could only ever fall *downhill*,
  so it drifted to the bottom of the screen and stayed on the taskbar. It now sizes up a
  window top above it, winds up, and jumps — and once it's up there it walks along the
  edge like any self-respecting cat on a bookshelf.
- **It knocks things off ledges.** Standing on a window edge, a mischievous pet will reach
  over, pat at nothing a couple of times, look you dead in the eye, and then send something
  tumbling into the void. The pause before the swipe is the whole point.
- **Kneading — making biscuits.** Both kinds, because cats do both: **Knead** is one paw
  pushing away in a steady rhythm, **Knead ×2** is the classic two-paw alternation.
  Affectionate, sleepy pets do it most.
- **Zoomies.** Every so often your pet loses its mind entirely and tears back and forth
  across the screen a few times, then stands there as if nothing happened. Deliberately
  rare — energetic and mischievous pets have a fit every few minutes.

All four are toggleable like every other animation, in *Settings → Behavior*.

### Fixed
- **Your pet no longer stands on windows you can't see.** It was reading every window's
  top edge without checking what was in *front* of it, so it would happily stand on an
  edge buried behind another window and appear to float in mid-air. Now cover the window
  it's sitting on and its footing genuinely disappears — so it falls, as it should.

## v0.6.0 — find your cat

### New
- **“Find Cat” in the tray.** Lost track of your pet behind a pile of windows? Find Cat pings
  a sonar around it — expanding rings and a soft glow — and gives it a little perk-up so you
  can spot it. Unlike *Reset Position* it doesn't move your pet, it just shows you where it is.
- **Seven levels of Detail** instead of three: **½× · ¾× · 1× · 1½× · 2× · 3× · 4×**. The top
  end is much smoother than the old *Fine*, and there's a step either side of the default now.
- **Ten sizes, with finer steps for small pets.** The old jump from the smallest size to the
  next one doubled your pet; there are now quarter-steps down there — **44 · 55 · 66 · 77 · 88**
  — before the bigger sizes carry on as before.

### Changed
- **Size and Detail are labelled by number now.** Sizes read as their pixel width (44 … 308)
  instead of XXS … XXL, and Detail reads as a multiplier. With ten sizes and seven detail
  levels, letters and adjectives had stopped telling you which way was bigger. Your current
  size is unchanged — it's the same setting, relabelled.
- **Settings has been reorganised** into **Pet · Look · Behavior · Care · Dreams**. Dream
  settings all live on the Dreams tab now instead of being split across two, the Pet tab opens
  straight onto your pets, and the creature builder and photo generator are folded behind a
  **New pet** button so they stay out of the way until you want them.

### Fixed
- **Updating no longer looks like a crash.** Windows asks an app to close before it can replace
  it, and PixelPet never answered — so every automatic update killed the app after a 30-second
  wait and logged it as a hang. It now shuts down cleanly when Windows (or a sign-out, or a
  restart) asks it to.
- **Your pet no longer gets stuck behind your windows.** Windows silently drops a window's
  always-on-top flag in a few situations — another app going fullscreen, the lock screen, a
  UAC prompt — and there was no way to get the pet back. It now re-asserts itself.
- Slider readouts (`80ms`, `100%`) no longer spill outside their panel in Settings.

## v0.5.0 — pick your pixels

### New
- **Detail control.** A new *Settings → Pet → Detail* toggle (**Chunky · Normal · Fine**)
  changes how pixelated your pet is — Fine renders the same cat at higher resolution
  (smoother curves, finer whiskers), Chunky at chunkier blocks. Independent of Size, and
  it applies live. Normal is the default and looks exactly as before.
- **An XXS size**, below XS — a tiny 1:1 pet. The size row is now XXS · XS · S · M · L · XL · XXL.
- **Trot, Stalk, and Hop are now animations too.** Any pet can play them (like Prance),
  and they have tiles in the Settings animation gallery — not just creatures whose DNA
  fixes them to that gait.
- **Preview any animation in the creature builder.** A dropdown under the live preview
  lets you watch your creature in Move, Idle, Sit, Loaf, Sphinx, Sleep, Groom, Stretch,
  or Pounce before you Create it.

### Fixed
- **Floppy ears now look like real dog ears** — drooping flaps that hang beside the face
  with a crease, instead of tiny nubs tucked into the head, consistent across the front,
  side, rig, and ¾-turn views.
- **Kitten build rebalanced** — its head was bigger than an adult cat's on a smaller body
  (a bobblehead); now it's a proportionally-big-but-not-giant head with the big kitten eyes.
- **Coat patterns stay put during the stretch** (and other arched poses) instead of sliding
  across the body, and the earlier gait fix (patterns no longer slide during Hop/Trot) ships too.
- Clicking and hovering work at every Detail level, including Chunky.

## v0.4.1 — more gaits, fuller species

### New
- Two more ways to move: **Trot** (a bouncy, tail-up walk) and **Stalk** (a low, slinking
  creep) — so a creature can Walk, Trot, Stalk, or Hop.

### Fixed
- Dogs (and any floppy-eared / snouted creature) now look right in the **¾ head-turn** too —
  they're consistent across every view now.

## v0.4.0 — bring your own creatures

### New
- **Build your own creature — no AI.** A new *Build a creature* editor lets you make a
  **cat, dog, rabbit, fox**… by hand: choose the **build, ears** (pointy / tufted / floppy),
  **eyes, tail** (normal / bushy / thin / nub), **coat pattern & colors**, a **snout**, and
  how it **moves** — with a **live animated preview**.
- **A hop gait.** Set *Moves → Hop* and your creature bounds like a rabbit instead of walking.
- **Shareable creature packs.** **Export** your creature to a `.pixelpet.json` file and
  **Import** someone else's — validated on load, so packs are safe to share. Two example
  packs (a dog and a rabbit) and the format docs ship in `packs/`.
- **A quiet dedication** in Settings, in loving memory of **Ash**.

### Fixed
- Eye styles (round / almond / sleepy) now look clearly different.

## v0.3.3 — for Ash

- A quiet **dedication** at the bottom of Settings, in loving memory of **Ash** — the cat
  PixelPet is named for, and all the joy she brought.

## v0.3.1 — macOS: fixed & universal

### Fixed
- **macOS launch crash** — the Windows-only window-enumeration FFI was being initialized on
  startup; it's now loaded lazily and only on Windows.
- **Universal Mac build** — the macOS app is now a universal binary, so it runs on both
  **Intel** and **Apple Silicon** Macs.

## v0.3.0 — now on macOS

### New
- **macOS build.** PixelPet now runs on macOS as a menu-bar app — your cat lives along the
  bottom of the screen, wanders, naps, and reacts, with Care Mode, Dream Mode, and the cat
  builder all working. (Unsigned for now: on first launch, right-click the app → **Open**.
  "Stands on your windows" remains Windows-only for the moment.)

### Fixed
- Shortened the neck in the **sit** and **sulk** poses — it read too long on slimmer cats.
- Store: the MSIX now ships the branded tile icons instead of the default placeholder.

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
