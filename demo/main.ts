import { attachProgressBar, attachShuttleButton, DIFFICULTY_NAMES, parseMaidata, SimaiPlayer, type Maidata } from '../src'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('view')
const folder = $<HTMLInputElement>('folder')
const difficulty = $<HTMLSelectElement>('difficulty')
const info = $('info')
const errors = $('errors')
const playBtn = $<HTMLButtonElement>('play')
const seek = $<HTMLInputElement>('seek')
const timeLabel = $('time')
const rate = $<HTMLSelectElement>('rate')
const tapSpeed = $<HTMLInputElement>('tapSpeed')
const touchSpeed = $<HTMLInputElement>('touchSpeed')
const fireworks = $<HTMLInputElement>('fireworks')
const sensors = $<HTMLInputElement>('sensors')
const slideJudge = $<HTMLInputElement>('slideJudge')
const hitSounds = $<HTMLInputElement>('hitSounds')
const hitVolume = $<HTMLInputElement>('hitVolume')
const fineHint = $('fineHint')

const player = new SimaiPlayer(canvas)
// handy for poking at it from the devtools console
Object.assign(window, { player })

// hold to move through the chart at half speed, backwards or forwards
attachShuttleButton(player, $('back'), -0.5)
attachShuttleButton(player, $('fwd'), 0.5)
let maidata: Maidata | null = null
let audioUrl: string | undefined

const AUDIO_NAMES = ['track.mp3', 'track.ogg', 'track.opus', 'track.wav']

function fmt(t: number) {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

async function open(text: string, audio: string | undefined) {
  maidata = parseMaidata(text)
  audioUrl = audio
  difficulty.innerHTML = ''
  for (const d of maidata.difficulties) {
    const opt = document.createElement('option')
    opt.value = String(d.index)
    opt.textContent = `${DIFFICULTY_NAMES[d.index] ?? d.index} ${d.level ?? ''}`
    difficulty.append(opt)
  }
  // default to the hardest regular difficulty
  const regular = maidata.difficulties.filter((d) => d.index <= 6)
  const pick = regular[regular.length - 1] ?? maidata.difficulties[0]
  if (pick) difficulty.value = String(pick.index)
  await loadDifficulty()
}

async function loadDifficulty() {
  if (!maidata) return
  const chart = await player.load({ maidata, difficulty: Number(difficulty.value), audio: audioUrl })
  player.setRate(Number(rate.value))
  info.textContent = `${maidata.title} / ${maidata.artist} — ${chart.notes.length} notes${audioUrl ? '' : '（无音频，静音预览）'}`
  errors.textContent = chart.errors.map((e) => `第 ${e.line} 行 ${e.column} 列：${e.message}`).join('\n')
  playBtn.textContent = '播放'
}

folder.addEventListener('change', async () => {
  const files = [...(folder.files ?? [])]
  const md = files.find((f) => f.name.toLowerCase() === 'maidata.txt')
  if (!md) {
    info.textContent = '文件夹里没有 maidata.txt'
    return
  }
  const track = files.find((f) => AUDIO_NAMES.includes(f.name.toLowerCase()))
  await open(await md.text(), track ? URL.createObjectURL(track) : undefined)
})

difficulty.addEventListener('change', loadDifficulty)

playBtn.addEventListener('click', async () => {
  await player.toggle()
  playBtn.textContent = player.playing ? '暂停' : '播放'
})

// drag along the bar to jump; move the pointer up/down away from it while holding for fine control
attachProgressBar(player, seek, {
  onFineChange: (factor) => {
    fineHint.textContent = factor && factor < 1 ? `精细拖动 ×1/${Math.round(1 / factor)}` : ''
  },
})

rate.addEventListener('change', () => player.setRate(Number(rate.value)))
tapSpeed.addEventListener('change', () => player.setTapSpeed(Number(tapSpeed.value)))
touchSpeed.addEventListener('change', () => player.setTouchSpeed(Number(touchSpeed.value)))
fireworks.addEventListener('change', () => player.setFireworks(fireworks.checked))
sensors.addEventListener('change', () => player.setShowSensors(sensors.checked))
slideJudge.addEventListener('change', () => player.setShowSlideJudge(slideJudge.checked))
const applyHitSounds = () => player.setHitSounds(hitSounds.checked, Number(hitVolume.value))
hitSounds.addEventListener('change', applyHitSounds)
hitVolume.addEventListener('input', applyHitSounds)

player.onTime((t) => {
  timeLabel.textContent = fmt(t)
  if (player.scrubbing) return
  playBtn.textContent = player.playing ? '暂停' : '播放'
})

document.addEventListener('keydown', async (e) => {
  // let text fields and menus have their keys; the progress bar keeps its own arrow keys
  if (e.target instanceof HTMLSelectElement) return
  if (e.target instanceof HTMLInputElement && !['range', 'checkbox'].includes(e.target.type)) return
  if (e.target === seek && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return
  if (e.code === 'Space') {
    e.preventDefault()
    await player.toggle()
    playBtn.textContent = player.playing ? '暂停' : '播放'
  } else if (e.code === 'ArrowLeft') player.seek(player.currentTime - 2)
  else if (e.code === 'ArrowRight') player.seek(player.currentTime + 2)
  else if (e.code === 'Comma') player.stepNote(-1)
  else if (e.code === 'Period') player.stepNote(1)
})

// ?song=<folder> loads demo/samples/<folder>/ from the dev server
const song = new URLSearchParams(location.search).get('song')
if (song) {
  const base = `/${encodeURIComponent(song)}/`
  const res = await fetch(base + 'maidata.txt')
  if (res.ok) {
    let audio: string | undefined
    for (const name of AUDIO_NAMES) {
      const head = await fetch(base + name, { method: 'HEAD' })
      if (head.ok && !head.headers.get('content-type')?.includes('text/html')) {
        audio = base + name
        break
      }
    }
    await open(await res.text(), audio)
  } else {
    info.textContent = `找不到 samples/${song}/maidata.txt`
  }
}
