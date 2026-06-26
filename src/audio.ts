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
