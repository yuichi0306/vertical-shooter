// ===================================================================
// 効果音（音声ファイル不要・Web Audioでその場で生成）
//
// ブラウザは「ユーザーが操作する前」は音を鳴らせない決まりがあるため、
// 最初のキー操作で initAudio() を呼んで有効化します。
// ===================================================================

let ctx: AudioContext | null = null;

// 最初のユーザー操作で呼ぶ。音の再生エンジンを起動／再開する。
export function initAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
  }
  // タブ復帰などで止まっていたら再開
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

// 単純な「音色（オシレーター）」を鳴らす。
// freq … 高さ、dur … 長さ(秒)、type … 波形、vol … 音量
function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  freqEnd?: number,
): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), now + dur);
  }

  // 音量を一気に立ち上げて、ゆっくり消す（プチっと鳴って減衰）
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur);
}

// 「ザー」というノイズを鳴らす（爆発・被弾向け）
function noise(dur: number, vol: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const length = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1; // ランダムな波＝ノイズ
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  // こもった音にするローパスフィルター
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(200, now + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);
  src.stop(now + dur);
}

// --- 実際に使う3つの効果音 ---

// ショット：強化段階(power)が上がるほど、太く迫力のある発射音になる
export function playShot(power = 1): void {
  if (power >= 3) {
    // 最大強化：低い層を重ねた、太く厚みのある「ドュン」
    tone(740, 0.09, "square", 0.05, 220);
    tone(370, 0.09, "sawtooth", 0.04, 140);
  } else if (power === 2) {
    // 中間：倍音を足したにぎやかな「ピュン」
    tone(820, 0.08, "square", 0.05, 260);
    tone(1230, 0.05, "square", 0.025, 500);
  } else {
    // 通常：高めの短い「ピッ」
    tone(880, 0.07, "square", 0.05, 300);
  }
}

// 爆発：短いノイズ
export function playExplosion(): void {
  noise(0.25, 0.25);
}

// ボス被弾：少し低めの「コッ」という短い音
export function playBossHit(): void {
  tone(160, 0.08, "square", 0.06, 90);
}

// ボス撃破：長く尾を引く派手な大爆発（ノイズを重ねつつ低音を轟かせる）
export function playBossExplosion(): void {
  // 太く長いノイズの本体
  noise(0.9, 0.35);
  // 一拍おいて二の爆発を重ね、ドドンと連続する迫力を出す
  setTimeout(() => noise(0.7, 0.28), 120);
  // 地響きのような低音の轟き
  tone(90, 1.0, "sawtooth", 0.22, 30);
  // 上から下へ崩れ落ちる金属的な余韻
  tone(440, 0.8, "square", 0.1, 50);
}

// 被弾：低めの下降音 ＋ ノイズ
export function playHit(): void {
  tone(220, 0.3, "sawtooth", 0.18, 60);
  noise(0.3, 0.2);
}

// ボム発動：低音の轟き＋広がるノイズの「ドゴォン」
export function playBomb(): void {
  tone(180, 0.5, "sawtooth", 0.22, 40); // 地響きの低音
  tone(540, 0.4, "square", 0.12, 90); // 上から崩れる高音
  noise(0.5, 0.32); // 広がる爆風
}

// ===================================================================
// BGM（背景音楽）：音声ファイル不要・効果音と同じくその場で生成
//
// 短い16ステップのループを「少し先まで予約しながら」鳴らし続けます。
// 通常BGMとボス戦BGMの2曲を、setMusic() で切り替えられます。
// ===================================================================

// 音の高さを表す番号（MIDIノート番号）を周波数(Hz)に変換する
function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// --- 2曲ぶんの楽譜（16ステップ。数字=音の高さ、0=休符）---
// 通常BGM：明るく軽快（ハ長調）
const NORMAL_BASS = [36, 0, 48, 0, 41, 0, 53, 0, 43, 0, 55, 0, 45, 0, 57, 0];
const NORMAL_LEAD = [72, 76, 79, 76, 77, 76, 74, 0, 74, 71, 74, 76, 79, 0, 76, 0];
// ボス戦BGM：緊迫感のある短調・速め
const BOSS_BASS = [38, 38, 38, 38, 38, 38, 41, 42, 36, 36, 36, 36, 36, 36, 40, 41];
const BOSS_LEAD = [69, 0, 68, 69, 72, 0, 69, 0, 67, 0, 65, 67, 69, 0, 68, 0];

// 1ステップの長さ（秒）。ボスのほうが速い＝あおられる感じ
const STEP_DUR = { normal: 0.21, boss: 0.16 } as const;
const MUSIC_VOL = 0.35; // BGM全体の音量（効果音より控えめに）

type MusicTrack = "normal" | "boss";

let musicGain: GainNode | null = null; // BGM全体の音量つまみ
let musicTrack: MusicTrack | null = null; // 今鳴らしている曲（null=無音）
let musicStep = 0; // 何ステップ目か
let nextStepTime = 0; // 次のステップを鳴らす予定の時刻
let schedulerId: number | null = null; // 予約処理のタイマー

// BGM専用の音量つまみを用意する（効果音とは別系統）
function ensureMusicGain(): void {
  if (!ctx || musicGain) return;
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.0001;
  musicGain.connect(ctx.destination);
}

// BGMの音を1つ、指定の時刻に鳴らす（musicGain 経由で音量管理）
function musicTone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType,
  vol: number,
): void {
  if (!ctx || !musicGain) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(musicGain);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// 1ステップぶん（ベース＋メロディ）を予約する
function playStep(track: MusicTrack, step: number, time: number, stepDur: number): void {
  const bass = track === "normal" ? NORMAL_BASS : BOSS_BASS;
  const lead = track === "normal" ? NORMAL_LEAD : BOSS_LEAD;
  if (bass[step]) {
    musicTone(midiToFreq(bass[step]), time, stepDur * 0.9, track === "boss" ? "sawtooth" : "triangle", 0.15);
  }
  if (lead[step]) {
    musicTone(midiToFreq(lead[step]), time, stepDur * 0.8, "square", 0.1);
  }
}

// 少し先（約0.12秒）まで、来たぶんのステップを予約し続ける
function scheduler(): void {
  if (!ctx || !musicTrack) return;
  const stepDur = STEP_DUR[musicTrack];
  while (nextStepTime < ctx.currentTime + 0.12) {
    playStep(musicTrack, musicStep, nextStepTime, stepDur);
    musicStep = (musicStep + 1) % 16;
    nextStepTime += stepDur;
  }
}

// BGMを切り替える。"normal"／"boss"／null（停止）。
export function setMusic(track: MusicTrack | null): void {
  if (!ctx) return;
  ensureMusicGain();
  if (!musicGain || track === musicTrack) return;
  musicTrack = track;

  if (track) {
    // 曲の頭から鳴らし始め、すっと音量を上げる
    musicStep = 0;
    nextStepTime = ctx.currentTime + 0.05;
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), ctx.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(MUSIC_VOL, ctx.currentTime + 0.3);
    if (schedulerId === null) {
      schedulerId = window.setInterval(scheduler, 25);
    }
  } else {
    // すっと音量を下げて止める
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), ctx.currentTime);
    musicGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    if (schedulerId !== null) {
      window.clearInterval(schedulerId);
      schedulerId = null;
    }
  }
}
