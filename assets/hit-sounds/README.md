# B_full 打击音

唯一的音包，来自用户提供的 `maimai_sound_variants/B_full`，共 11 个 WAV。**音频文件不在本仓库里**：权利归其原权利人，代码的 GPL 不适用于它们。`manifest.json` 列出每个文件的名字、大小和 SHA256，可以用来核对自己的副本。

音符触发关系对照本地 MajdataPlay `NoteAudioManager.cs` 的 `SFX_NAMES`、`PlayBreakTapSound`、`PlayBreakSlideEndSound`，以及 `TouchHoldDrop.cs` 的 `PlaySFX` / `PlayJudgeSFX`。

| 本包文件 | 对应的 MajdataPlay 角色 | 触发时机 |
|---|---|---|
| answer.wav | answer.wav | 有头音符的节拍，以及长按结束 |
| tap.wav | tap_perfect.wav | 普通 TAP / HOLD 头、TOUCH HOLD 结束判定 |
| ex.wav | tap_ex.wav | EX 命中 |
| break.wav | break_tap.wav | BREAK 命中判定，与 cheer 同时 |
| cheer.wav | break.wav | BREAK 的附加效果；BREAK 滑条结束时也播放 |
| slide.wav | slide.wav | 普通滑条开始滑动 |
| break_slide.wav | slide_break_start.wav | BREAK 滑条开始滑动 |
| break_slide_cheer.wav | slide_break_slide.wav | BREAK 滑条结束判定，与 cheer 同时 |
| touch.wav | touch.wav | 普通 TOUCH |
| touch_hold.wav | touch_Hold_riser.wav | TOUCH HOLD 持续期间；松开即停；重叠不叠加 |
| firework.wav | touch_hanabi.wav | 带烟花 TOUCH / TOUCH HOLD 的结束时刻 |

播放器是预览，不做真实命中判定，因此不使用 GREAT / GOOD / MISS 音效。持续音沿用一次播放，不强行循环原文件；拖到长触摸中间时从相应偏移恢复，暂停、禁用打击音和跳转会停止旧声音。

播放器从 `hitSoundBase` 指定的目录下载这些文件（默认 `/hit-sounds/B_full/`），跨域时对方须允许 CORS。演示页（`npm run dev`）会读取本地的 `assets/hit-sounds/B_full/`，这个目录已被 git 忽略。打击音下载或解码失败会在页面提示，不会切回旧合成音。声音开关和总音量继续可用；网站不再自动恢复先前本地音包或六套旧音色设置。

人工听感仍以用户在真实设备上的试听为准。

网站“声音 → 音效分别调节”可独立设置 11 项音效的 0–100% 相对音量，乘以打击音总音量后输出。初始 100% 保留这套音包现有的混音比例；0% 只静音对应种类。设置保存在当前浏览器，刷新和切换歌曲后恢复。试听使用同样的分项和总音量；切换试听或关闭窗口会停止前一个试听音。“恢复默认”仅恢复分项比例，不改变打击音总音量。
