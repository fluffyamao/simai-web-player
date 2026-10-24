# simai-web-player

Plays [simai](https://w.atwiki.jp/simai/) (maimai) charts in the browser, in sync with audio.
Canvas 2D, TypeScript, no dependencies.

Note motion, slide paths and play-field geometry are ported from
[MajdataPlay](https://github.com/TeamMajdata/MajdataPlay) (GPL-3.0), which is based on
[MajdataView](https://github.com/LingFeng-bbben/MajdataView). Each ported file names its source.
The simai parser is written from scratch, following the simai documentation and
[SimaiSharp](https://github.com/reflektone-games/SimaiSharp) (MIT).

This project has no affiliation with SEGA. Note shapes are drawn and hit sounds are synthesised in code;
no game assets are included.

## Status

| Milestone | |
|---|---|
| M1 parser, taps / holds / breaks / ex / each / star heads, audio sync, seek, playback rate | done |
| M2 slides: all standard shapes, wifi, chains, `*` multi-slides, fade-in and star motion | done |
| M3 touch / touch hold, firework burst (can be turned off) | done |
| M4 hit sounds (synthesised), break / slide-end effects, `<HS*x>` hi-speed | done |

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
player.setHitSounds(true, 0.3)
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
