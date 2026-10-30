# simai-web-player

Plays [simai](https://w.atwiki.jp/simai/) (maimai) charts in the browser, in sync with audio.
Canvas 2D, TypeScript, no dependencies.

Note motion, slide paths and play-field geometry are ported from
[MajdataPlay](https://github.com/TeamMajdata/MajdataPlay) (GPL-3.0), which is based on
[MajdataView](https://github.com/LingFeng-bbben/MajdataView). Each ported file names its source.
The simai parser is written from scratch, following the simai documentation and
[SimaiSharp](https://github.com/reflektone-games/SimaiSharp) (MIT).

This project has no affiliation with SEGA. Note shapes are drawn in code; no game assets are included.
Hit sounds play a B_full WAV pack that is not part of this repository: serve your own copy and point
`hitSoundBase` at it. The expected files and the sound mapping are in
[assets/hit-sounds/README.md](assets/hit-sounds/README.md).

## Status

| Milestone | |
|---|---|
| M1 parser, taps / holds / breaks / ex / each / star heads, audio sync, seek, playback rate | done |
| M2 slides: all standard shapes, wifi, chains, `*` multi-slides, fade-in and star motion | done |
| M3 touch / touch hold, firework burst (can be turned off) | done |
| M4 hit sounds (B_full samples), break / slide-end effects, `<HS*x>` hi-speed | done |

Standard slides are built as MajdataPlay slide codes (`src/core/slideShapes.ts`); their arrow counts
are tested against the official prefab counts. Not handled yet: pseudo-each (`` ` ``) timing offsets, `<SV*x>` tags (ignored), judgement text.

## Usage

```ts
import { attachProgressBar, attachShuttleButton, parseMaidata, SimaiPlayer } from 'simai-web-player'

const player = new SimaiPlayer(canvas, {
  tapSpeed: 7.5,
  touchSpeed: 7.5,
  fireworks: true,
  hitSounds: true,
  hitSoundVolume: 0.5,
  musicVolume: 1,         // iOS ignores it: the device's buttons set the volume there
})
await player.load({
  maidata: parseMaidata(await (await fetch('maidata.txt')).text()),
  difficulty: 5,          // 1 Easy .. 5 Master, 6 Re:Master, 7 Utage
  audio: 'track.mp3',     // optional: leave out to preview silently
})
player.play()
player.seek(42.5)
player.setRate(0.5)       // half speed, pitch kept
player.setFireworks(false) // hide the burst of `f` touches
// on a light page: leave the square around the round field transparent, darker button numbers
player.setFrame({ background: null, label: '#5f6f8f' })
player.setHitSounds(true, 0.3)
player.setHitSoundVolume(0.8)
player.setHitSoundKindVolume('tap', 0.65) // each sound is 0..1, multiplied by master volume
player.setHitSoundKindVolume('slide', 0.4)
player.setMusicVolume(0.6)
player.setHitSoundPreset('b-full') // B_full is the only built-in sound set; legacy IDs resolve to it
player.previewHitSound('break')  // audition one sound
player.stopHitSoundPreview()     // stop the audition without stopping chart playback
// the user's own hit sound files (e.g. from <input type="file" webkitdirectory>): recognised by
// name (tap.wav, ex.wav, break.wav, ... or MajdataPlay's tap_perfect.wav, ...), leading
// silence trimmed, kept only in this browser (IndexedDB) and restored next time
await player.loadHitSoundPack(input.files)
player.clearHitSoundPack()
player.onTime((t) => { /* every frame while time changes */ })

// progress bar (<input type="range" min="0" max="1">): drag along it to jump anywhere;
// while holding, move the pointer up/down away from it for 1/4 and 1/16 precision.
// Audio pauses while dragging and the chart follows, running backwards when dragged back.
attachProgressBar(player, bar, { onFineChange: (factor) => { /* show a hint */ } })

player.stepNote(1)        // jump to the next note (-1: previous)
// hold-to-move buttons: half speed backwards / forwards while held (audio pauses meanwhile,
// since browsers cannot play audio in reverse); or call player.startShuttle(rate) / stopShuttle()
attachShuttleButton(player, backButton, -0.5)
attachShuttleButton(player, forwardButton, 0.5)
// also built in: drag left/right on the chart (full width = 2 s, Shift for finer),
// mouse wheel over the chart steps note by note (turn off with canvasControls: false)
```

`player.chart.errors` lists any parse errors with line and column.

The player fetches the hit sounds from `hitSoundBase` (default `/hit-sounds/B_full/`); from another
origin, that server must allow CORS. `player.hitSoundLoadErrors` lists any unavailable sounds. The website uses
`restoreHitSoundPack: false` so an older browser-local pack cannot replace B_full.

## Development

```bash
npm install
npm run dev     # demo page at http://localhost:5173
npm test
npm run build   # dist/
```

The demo can open a chart folder (maidata.txt + track.mp3) from disk, or load
`demo/samples/<name>/` with `?song=<name>`. `demo/samples/` is git-ignored: never commit audio.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
