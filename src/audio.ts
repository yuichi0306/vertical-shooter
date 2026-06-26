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

// ショット：高めの短いピッ
export function playShot(): void {
  tone(880, 0.07, "square", 0.05, 300);
}

// 爆発：短いノイズ
export function playExplosion(): void {
  noise(0.25, 0.25);
}

// 被弾：低めの下降音 ＋ ノイズ
export function playHit(): void {
  tone(220, 0.3, "sawtooth", 0.18, 60);
  noise(0.3, 0.2);
}
