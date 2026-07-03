// ===================================================================
// ステップ9: 効果音と爆発エフェクト（演出）
//   - ショット／爆発／被弾の効果音（Web Audioで生成）
//   - 敵やボスを倒したときに破片が飛び散るエフェクト
// ===================================================================

import { STAGES, type EnemyKind, type BossKind, type StageTheme } from "./stage";
import { initAudio, playShot, playExplosion, playHit, playBossHit, playBossExplosion, playBomb, playHeal, setMusic } from "./audio";

// ゲーム内部の解像度（座標はすべてこのサイズを基準に書く）
const WIDTH = 480;
const HEIGHT = 640;

// 1秒間に何回「更新」するか（60回 = なめらか）
const FPS = 60;
const STEP = 1 / FPS; // 1回の更新が進める時間（秒）

// canvas（絵を描く領域）を取得
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// 右上の「あそびかた」リンク（プレイ中は隠す）
const helpLink = document.getElementById("help-link") as HTMLElement | null;

// -------------------------------------------------------------------
// キーボード入力：今どのキーが押されているかを覚えておく
// -------------------------------------------------------------------
const keys = new Set<string>();

window.addEventListener("keydown", (e) => {
  initAudio(); // 最初のキー操作で音を有効化（ブラウザの制限対策）
  // ポーズの切り替え（P / Esc）。長押しの自動連打を防ぐため、押した瞬間だけ反応する
  if ((e.code === "KeyP" || e.code === "Escape") && !keys.has(e.code)) {
    if (gameState === "playing") pauseGame();
    else if (gameState === "paused") resumeGame();
  }
  keys.add(e.code);
  // 矢印キーやスペースで画面がスクロールしないように
  if (
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
    ].includes(e.code)
  ) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

// 「いずれかのキーが押されているか」を判定する小さな便利関数
function isDown(...codes: string[]): boolean {
  return codes.some((c) => keys.has(c));
}

// -------------------------------------------------------------------
// タッチ操作（スマホ）：画面下に「移動パッド（左）」と
// 「ショット／ボムボタン（右）」を出して、指で遊べるようにする。
// -------------------------------------------------------------------
// 操作パーツの位置と大きさ（ゲーム内座標 480x640 が基準）
const PAD_CX = 82; // 移動パッドの中心X
const PAD_CY = HEIGHT - 90; // 移動パッドの中心Y
const PAD_R = 60; // 移動パッドの大きさ（半径）
const PAD_DEAD = 9; // これより内側は「動かさない」あそび
const SHOT_CX = WIDTH - 62; // ショットボタン
const SHOT_CY = HEIGHT - 64;
const SHOT_R = 44;
const BOMB_CX = WIDTH - 122; // ボムボタン
const BOMB_CY = HEIGHT - 118;
const BOMB_R = 32;
const PAUSE_CX = WIDTH - 22; // ポーズボタン（右上・スマホ用）
const PAUSE_CY = 24;
const PAUSE_R = 15;

// タッチで今どう動かしたいか（-1〜+1）。0なら止まる
let touchDirX = 0;
let touchDirY = 0;
let touchFire = false; // ショットボタンを押している間 true
let uiTap = false; // タイトル/決着画面でのタップ（開始・タイトルへ戻る用）
// タッチ端末かどうか（最初に判定）。操作ボタンの表示に使う
let showTouchControls =
  "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;

// どの指（識別番号）がどのボタンを担当しているか
type TouchRole = "move" | "shot" | "bomb" | "ui";
const touchRoles = new Map<number, TouchRole>();

// 点 (px,py) が円 (cx,cy,r) の中にあるか
function inCircle(px: number, py: number, cx: number, cy: number, r: number): boolean {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

// 画面（ピクセル）座標を、ゲーム内座標（480x640）に変換する
function toGame(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * WIDTH,
    y: ((clientY - rect.top) / rect.height) * HEIGHT,
  };
}

// 移動パッドに触れた指の位置から、進みたい向き（-1〜+1）を求める
function updatePadDir(gx: number, gy: number): void {
  const dx = gx - PAD_CX;
  const dy = gy - PAD_CY;
  const dist = Math.hypot(dx, dy);
  if (dist < PAD_DEAD) {
    touchDirX = 0;
    touchDirY = 0;
    return;
  }
  // パッドの端まで倒すと最大速度。半径で正規化し、1を超えないようにする
  const scale = Math.min(1, dist / PAD_R) / dist;
  touchDirX = dx * scale;
  touchDirY = dy * scale;
}

// ショットボタンを押している指がまだ残っているか調べ直す
function recomputeFire(): void {
  touchFire = false;
  for (const role of touchRoles.values()) {
    if (role === "shot") {
      touchFire = true;
      break;
    }
  }
}

canvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    initAudio(); // 最初のタッチで音を有効化（ブラウザの制限対策）
    showTouchControls = true;
    for (const t of Array.from(e.changedTouches)) {
      const g = toGame(t.clientX, t.clientY);
      // ポーズ中：どこを触っても再開
      if (gameState === "paused") {
        resumeGame();
        touchRoles.set(t.identifier, "ui");
        continue;
      }
      // タイトル/決着画面では、どこを触ってもタップ＝決定
      if (gameState !== "playing") {
        uiTap = true;
        touchRoles.set(t.identifier, "ui");
        continue;
      }
      // 右上のポーズボタン
      if (inCircle(g.x, g.y, PAUSE_CX, PAUSE_CY, PAUSE_R)) {
        pauseGame();
        touchRoles.set(t.identifier, "ui");
        continue;
      }
      if (inCircle(g.x, g.y, BOMB_CX, BOMB_CY, BOMB_R)) {
        touchRoles.set(t.identifier, "bomb");
        if (player.bombs > 0) useBomb();
      } else if (inCircle(g.x, g.y, SHOT_CX, SHOT_CY, SHOT_R)) {
        touchRoles.set(t.identifier, "shot");
        touchFire = true;
      } else if (g.x < WIDTH / 2) {
        // 画面の左半分は移動パッド扱い（パッドの外でもOK）
        touchRoles.set(t.identifier, "move");
        updatePadDir(g.x, g.y);
      } else {
        // 画面の右半分の余白もショット扱い（押しやすさのため）
        touchRoles.set(t.identifier, "shot");
        touchFire = true;
      }
    }
  },
  { passive: false },
);

canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (touchRoles.get(t.identifier) === "move") {
        const g = toGame(t.clientX, t.clientY);
        updatePadDir(g.x, g.y);
      }
    }
  },
  { passive: false },
);

function endTouch(e: TouchEvent): void {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) {
    const role = touchRoles.get(t.identifier);
    touchRoles.delete(t.identifier);
    if (role === "move") {
      // 移動の指が離れたら停止（別の移動指があれば次のtouchmoveで上書きされる）
      touchDirX = 0;
      touchDirY = 0;
    }
  }
  recomputeFire();
}
canvas.addEventListener("touchend", endTouch, { passive: false });
canvas.addEventListener("touchcancel", endTouch, { passive: false });

// -------------------------------------------------------------------
// 背景の星：下に流れることで「スクロールしている」感じを出す
// -------------------------------------------------------------------
type Star = { x: number; y: number; speed: number; size: number };

const stars: Star[] = [];
for (let i = 0; i < 80; i++) {
  stars.push({
    x: Math.random() * WIDTH,
    y: Math.random() * HEIGHT,
    speed: 30 + Math.random() * 90,
    size: Math.random() < 0.8 ? 1 : 2,
  });
}

// -------------------------------------------------------------------
// 背景の装飾レイヤー（遠くの山・雲・近くの地面）
//   奥行きを出すため、層ごとに流れる速さを変える（パララックス）。
//   速い層ほど「近く」に見える。
// -------------------------------------------------------------------
type Deco = { x: number; y: number; scale: number; speed: number };

// 1つの層をランダムに作る
function makeLayer(
  count: number,
  speedMin: number,
  speedMax: number,
  scaleMin: number,
  scaleMax: number,
): Deco[] {
  const arr: Deco[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      scale: scaleMin + Math.random() * (scaleMax - scaleMin),
      speed: speedMin + Math.random() * (speedMax - speedMin),
    });
  }
  return arr;
}

const farHills = makeLayer(6, 10, 18, 0.8, 1.5); // 遠い山（いちばんゆっくり）
const clouds = makeLayer(7, 24, 42, 0.7, 1.6); // 流れる雲（中くらい）
const nearGround = makeLayer(5, 60, 95, 1.0, 1.9); // 近い地面（夜空テーマ用・いちばん速い）

// ステージ2（地球の空）の緑の島。陸地どうしが重ならないよう、
// 縦に等間隔で並べて全部「同じ速さ」で流す（ベルトコンベア方式）。
const ISLAND_COUNT = 4;
const ISLAND_GAP = HEIGHT / ISLAND_COUNT; // 縦の間隔（=160px。島の高さより大きく取る）
const ISLAND_SPEED = 70; // 全部この速さ（バラバラにしない＝追いついて重ならない）
const ISLAND_MARGIN = 60; // 画面外に出たと判定する余白
const islands: Deco[] = [];
for (let i = 0; i < ISLAND_COUNT; i++) {
  islands.push({
    x: ISLAND_MARGIN + Math.random() * (WIDTH - ISLAND_MARGIN * 2),
    y: i * ISLAND_GAP,
    scale: 1.0 + Math.random() * 0.6, // 1.0〜1.6（間隔より小さく収まる大きさに制限）
    speed: ISLAND_SPEED,
  });
}

// 島を同じ速さで流し、下に出たらベルトの一番上へ戻す（間隔を保つので重ならない）
function updateIslands(dt: number): void {
  const belt = ISLAND_COUNT * ISLAND_GAP; // ベルト1周ぶんの長さ
  for (const d of islands) {
    d.y += ISLAND_SPEED * dt;
    if (d.y - ISLAND_MARGIN > HEIGHT) {
      d.y -= belt; // ちょうど1周ぶん上へ戻す（縦の等間隔を保つ）
      d.x = ISLAND_MARGIN + Math.random() * (WIDTH - ISLAND_MARGIN * 2);
    }
  }
}

// 海の中の泡（ステージ3）。下から上へ立ちのぼり、上に出たら下へ戻る。
const bubbles: Deco[] = [];
for (let i = 0; i < 18; i++) {
  bubbles.push({
    x: Math.random() * WIDTH,
    y: Math.random() * HEIGHT,
    scale: 0.5 + Math.random() * 1.1,
    speed: 25 + Math.random() * 50, // 大きい泡ほど速く昇る傾向
  });
}

// 泡を上へ動かす。左右にゆらゆら揺れながら昇る。上に出たら下から出し直す。
function updateBubbles(dt: number): void {
  for (const d of bubbles) {
    d.y -= d.speed * dt;
    d.x += Math.sin((d.y + d.speed) * 0.03) * 12 * dt; // ゆらゆら横揺れ
    if (d.y < -10) {
      d.y = HEIGHT + 10;
      d.x = Math.random() * WIDTH;
    }
  }
}

// 夜空のグラデーション（上＝濃い闇、下＝少し明るい地平線）。一度だけ作る。
const skyGradientNight = ctx.createLinearGradient(0, 0, 0, HEIGHT);
skyGradientNight.addColorStop(0, "#05050f");
skyGradientNight.addColorStop(0.7, "#070a18");
skyGradientNight.addColorStop(1, "#0d1226");

// 地球の空のグラデーション（上＝青い空、下＝水色の海）。一度だけ作る。
const skyGradientDay = ctx.createLinearGradient(0, 0, 0, HEIGHT);
skyGradientDay.addColorStop(0, "#4aa3df"); // 上空の青
skyGradientDay.addColorStop(0.5, "#8fd0f0"); // 水色の空
skyGradientDay.addColorStop(1, "#bfe9ff"); // 下＝明るい海面

// 海の中のグラデーション（上＝光のとどく水色、下＝深い藍）。一度だけ作る。
const skyGradientSea = ctx.createLinearGradient(0, 0, 0, HEIGHT);
skyGradientSea.addColorStop(0, "#2aa7c4"); // 水面に近い明るい水色
skyGradientSea.addColorStop(0.5, "#136a93"); // 中ほどの青
skyGradientSea.addColorStop(1, "#062744"); // 深い藍

// 氷の世界のグラデーション（上＝夜明けの藍、下＝雪原の白っぽい水色）。一度だけ作る。
const skyGradientIce = ctx.createLinearGradient(0, 0, 0, HEIGHT);
skyGradientIce.addColorStop(0, "#13325a"); // 上空の濃い藍
skyGradientIce.addColorStop(0.55, "#4f7eb0"); // 中ほどの青
skyGradientIce.addColorStop(1, "#cfe6f5"); // 下＝雪原の明るい水色

// 宇宙テーマのグラデーション（ステージ5）：ほぼ真っ黒〜深い紫
const skyGradientSpace = ctx.createLinearGradient(0, 0, 0, HEIGHT);
skyGradientSpace.addColorStop(0, "#05030f"); // 上＝漆黒
skyGradientSpace.addColorStop(0.5, "#0c0922"); // 中ほどの濃い紫
skyGradientSpace.addColorStop(1, "#14082a"); // 下＝深い紫

// 氷の世界の雪（ステージ4）。上から下へ降り、左右にゆれる。下に出たら上へ戻す。
const snowflakes: Deco[] = [];
for (let i = 0; i < 60; i++) {
  snowflakes.push({
    x: Math.random() * WIDTH,
    y: Math.random() * HEIGHT,
    scale: 0.4 + Math.random() * 1.2, // 大きい雪ほど手前＝速く落ちる
    speed: 30 + Math.random() * 60,
  });
}

// 雪を下へ動かす。ふわふわ横揺れしながら降る。下に出たら上から出し直す。
function updateSnow(dt: number): void {
  for (const d of snowflakes) {
    d.y += d.speed * dt;
    d.x += Math.sin((d.y + d.speed) * 0.02) * 10 * dt; // ふわふわ横揺れ
    if (d.y > HEIGHT + 6) {
      d.y = -6;
      d.x = Math.random() * WIDTH;
    }
  }
}

// 今の背景テーマ（ステージごとに切り替わる）。起動時／タイトルは夜空。
let theme: StageTheme = "night";

// 1つの層を下へ流す。画面の下に出たら上へ戻して再利用する。
function updateLayer(layer: Deco[], dt: number, margin: number): void {
  for (const d of layer) {
    d.y += d.speed * dt;
    if (d.y - margin > HEIGHT) {
      d.y = -margin;
      d.x = Math.random() * WIDTH;
    }
  }
}

// -------------------------------------------------------------------
// 自機
// -------------------------------------------------------------------
const PLAYER_SPEED = 260; // 1秒あたりに動くピクセル数（基本の移動速さ）
const PLAYER_RADIUS = 11; // 見た目／画面端で止まるときの半径
const SPEED_MAX = 2; // スピードアップの最大段階（バナナで上がる）
const SPEED_STEP = 0.2; // 1段階ごとに移動速度が +20%（最大段階で +40%）

const START_LIVES = 3; // 開始時の残機
const INVINCIBLE_TIME = 2.0; // 被弾後の無敵時間（秒）

// ボム（緊急回避）
const START_BOMBS = 3; // 開始時のボム数
const BOMB_INVINCIBLE_TIME = 1.5; // ボム発動中の無敵時間（秒）
const BOMB_FLASH_TIME = 0.45; // ボムの閃光の表示時間（秒）
const BOSS_BOMB_DAMAGE = 10; // ボムがボスに与えるダメージ

const player = {
  x: WIDTH / 2,
  y: HEIGHT - 90,
  fireCooldown: 0, // 次に撃てるようになるまでの残り時間（秒）
  lives: START_LIVES, // 残機
  invincible: 0, // 残りの無敵時間（秒）。0より大きい間は無敵
  power: 1, // ショットの強化段階（1〜POWER_MAX）
  speedLevel: 0, // スピードアップの段階（0〜SPEED_MAX。バナナで上がる）
  lean: 0, // 首の傾き（-1=左 / 0=正面 / +1=右）。移動方向へなめらかに追従
  bombs: START_BOMBS, // 残りのボム数
};

// ボムの演出・入力管理
let bombFlash = 0; // 0より大きい間、画面に閃光を出す
let bombKeyWasDown = false; // 前フレームでボムキーが押されていたか（押した瞬間だけ反応させる）

// やられた時の演出（画面の揺れ・ヒットストップ）
const SHAKE_TIME = 0.35; // 画面が揺れる時間（秒）
const SHAKE_MAG = 7; // 揺れの大きさ（px）。だんだん小さくなる
const HITSTOP_TIME = 0.07; // 被弾の瞬間、動きを止める時間（秒）
let shakeTime = 0; // 残りの揺れ時間（秒）
let hitStop = 0; // 残りのヒットストップ時間（秒）。0より大きい間は動きが止まる

// ボス撃破の大演出（画面フラッシュ）
const BOSS_DEFEAT_FLASH_TIME = 0.5; // 撃破フラッシュの表示時間（秒）
let bossDefeatFlash = 0; // 0より大きい間、画面が白くフラッシュする
let bossDefeatColor = "#ffffff"; // フラッシュのふち色（倒したボスの色）

// ゲーム全体の状態。
type GameState = "title" | "playing" | "paused" | "gameover" | "clear";
let gameState: GameState = "title"; // 起動時はタイトル画面から
let resultLock = 0; // 決着直後、入力を受け付けない時間（秒）
let titleLock = 0; // タイトルに戻った直後、入力を受け付けない時間（秒）
let audioReady = false; // 一度でも音を有効化したか（最初の1操作はBGMを鳴らす合図に使う）

// 連戦の進行：今が何ステージ目か
let stageIndex = 0; // 0 = ステージ1
let stage = STAGES[0]; // 今プレイしているステージのデータ
const STAGE_BANNER_TIME = 2.2; // ステージ開始時に名前を表示する時間（秒）
let stageBanner = 0; // 0より大きい間、ステージ名を画面中央に出す

// スコア
const SCORE_ENEMY = 100; // 雑魚1体撃破
const SCORE_ITEM = 100; // 強化アイテム（キャベツ・バナナ）を拾う
const SCORE_BOSS = 5000; // ボス撃破
const SCORE_MIDBOSS = 2000; // 中ボス撃破（ステージ5の宇宙チンパンジー）
const LIFE_PENALTY = 500; // クリア時、残機が満タンから1減るごとの減点
const BOMB_PENALTY = 200; // ボムを1回使うごとの減点
let score = 0;
let clearLifePenalty = 0; // 直近のクリアで引かれた残機ぶんの減点（表示用）

// ハイスコア（ブラウザに保存して次回も残す）
const HIGHSCORE_KEY = "vshooter.highscore";

function loadHighScore(): number {
  const v = localStorage.getItem(HIGHSCORE_KEY);
  return v ? Number(v) || 0 : 0;
}

function saveHighScoreIfNeeded(): void {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem(HIGHSCORE_KEY, String(highScore));
    newRecord = true;
  }
}

let highScore = loadHighScore();
let newRecord = false; // 今回のプレイでハイスコアを更新したか

// -------------------------------------------------------------------
// 自機のショット（弾）
// -------------------------------------------------------------------
const BULLET_SPEED = 560; // 上へ進む速さ（px/秒）
const FIRE_INTERVAL = 0.12; // 連射の間隔（秒）。小さいほど速く撃てる

const BULLET_RADIUS = 4; // 当たり判定用の半径
// vx/vy … 1秒あたりに進む量（拡散ショットで斜めに飛ばすために向きを持たせる）
// laser … true のときは「お供の小亀」が撃つまっすぐなレーザー（見た目が細い光の柱）
type Bullet = { x: number; y: number; vx: number; vy: number; laser?: boolean };
const bullets: Bullet[] = [];

// パワーアップ
const POWER_MAX = 5; // 最大強化段階
const MAX_BOMBS = 9; // ボムの最大ストック数（拾いすぎ防止）

// 5段階目の「お供の小亀（オプション）」
//   自機の近くに現れ、移動するとなめらかについてくる。撃つたびにレーザーを出す。
const OPTION_OFFSET_X = -30; // 自機からの定位置（左に少し）
const OPTION_OFFSET_Y = -6; // 自機からの定位置（少し上）
const OPTION_FOLLOW = 9; // 追従のなめらかさ（大きいほど速く追いつく）
const LASER_SPEED = 760; // レーザーが上へ進む速さ（px/秒）。通常弾より速い
const optionTurtle = { x: player.x, y: player.y, active: false };
const ITEM_DROP_RATE = 0.12; // 敵撃破時にアイテムが出る確率（0.12 = 12%）
const ITEM_RADIUS = 10; // アイテムの大きさ／当たり判定
const ITEM_SPEED = 90; // アイテムが下りる速さ（px/秒）

// kind … "power"=パワーアップ（キャベツ）／"bomb"=ボム補充（黄金の豚が落とす）
type Item = { x: number; y: number; kind: "power" | "bomb" | "speed" };
const items: Item[] = [];

// -------------------------------------------------------------------
// 爆発エフェクト（飛び散る破片）
// -------------------------------------------------------------------
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 残り寿命（秒）
  maxLife: number; // 寿命の最大値（透明度の計算に使う）
  color: string;
  size: number; // 火花の大きさ（半径）
};
const particles: Particle[] = [];

// 指定位置で破片をまき散らす（丸い火花）
function spawnExplosion(x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 160;
    const life = 0.3 + Math.random() * 0.4;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      color,
      size: 1.6 + Math.random() * 2.6, // 大小ばらつかせる
    });
  }
}

// -------------------------------------------------------------------
// 自機のエンジン噴射（後ろに残る光の軌跡）
// -------------------------------------------------------------------
type Trail = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number };
const trails: Trail[] = [];

// テーマごとの噴射の色（白い芯＋この色のオーラ）
function exhaustColor(): string {
  return theme === "night" ? "#7dffb0"
    : theme === "sky" ? "#bfe8ff"
    : theme === "sea" ? "#8dffe0"
    : theme === "ice" ? "#d8f0ff"
    : "#c9a8ff"; // space
}

// -------------------------------------------------------------------
// アイテム取得などの手応え演出（浮かぶ文字＋広がる光の輪）
// -------------------------------------------------------------------
// ふわっと上に浮かんで消える文字（「+100」など）
type FloatText = { x: number; y: number; text: string; color: string; life: number; maxLife: number };
const floatTexts: FloatText[] = [];
function spawnFloatText(x: number, y: number, text: string, color: string): void {
  floatTexts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
}
// パッと広がって消える光の輪
type Ring = { x: number; y: number; color: string; life: number; maxLife: number; maxR: number };
const rings: Ring[] = [];
function spawnRing(x: number, y: number, color: string, maxR = 26): void {
  rings.push({ x, y, color, life: 0.45, maxLife: 0.45, maxR });
}

// -------------------------------------------------------------------
// 敵の弾（ボスが撃ってくる弾。自機に当たる）
// -------------------------------------------------------------------
const EBULLET_RADIUS = 6;
type EnemyBullet = { x: number; y: number; vx: number; vy: number; color: string };
const enemyBullets: EnemyBullet[] = [];

// 敵弾の基本色（赤）。ボスが撃つときだけ、その下の色に一時的に切り替える
const EBULLET_DEFAULT_COLOR = "#ff3838";
let currentEBulletColor = EBULLET_DEFAULT_COLOR;

// "#rrggbb" を "rgba(r,g,b,a)" に変換（グラデーションの透明度指定に使う）
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// -------------------------------------------------------------------
// ボス
// -------------------------------------------------------------------
const BOSS_RADIUS = 38; // 見た目／当たり判定（両ボス共通）
const BOSS_Y_TARGET = 110; // 入場後に留まる高さ
const BOSS_ENTER_SPEED = 70; // 入場で下りてくる速さ
const EBULLET_SPEED = 190; // 敵弾の速さ
const BOSS_ENRAGE_RATIO = 0.5; // 怒りモード：HPがこの割合以下になると激しくなる

// phase … "enter"=入場中, "fight"=戦闘中
type Boss = {
  x: number;
  y: number;
  hp: number;
  maxHp: number; // 最大HP（HPバーの割合・怒り判定に使う）
  kind: BossKind; // ボスの種類（見た目と攻撃が変わる）
  phase: "enter" | "fight";
  dir: number; // 左右移動の向き（+1 か -1）
  fireTimer: number; // 次の攻撃までの残り秒
  patternIndex: number; // 次に使う攻撃パターン番号
  walk: number; // 歩行アニメの位相（増えるほど腕足が振れる）
  spinAngle: number; // うずまき攻撃用の回転角度
  moveTime: number; // 前後（上下）移動用にたまっていく時間
  enraged: boolean; // 怒りモードに入ったか（HP半分以下で true）
  isMid: boolean; // 中ボスか（true なら倒しても次ステージへ進まず道中再開）
  summonTimer: number; // お供（小型メカゴリラ）を呼ぶまでの残り秒（メカ母艦ゴリラ用）
  // --- 突進（酸素ボンベのゴリラ専用）---
  chargeState: "none" | "windup" | "dash" | "back"; // 突進の段階
  chargeTimer: number; // 次の突進までの残り秒（none の間に減る）
  chargeStateTimer: number; // windup（ためる）の残り秒
  chargeVX: number; // 突進中の速度（x）
  chargeVY: number; // 突進中の速度（y）
};
let boss: Boss | null = null;
let bossSpawned = false; // このステージで既にボスを出したか
let midBossSpawned = false; // このステージで既に中ボスを出したか（ステージ5用）

// -------------------------------------------------------------------
// 敵
// -------------------------------------------------------------------
const ENEMY_RADIUS = 16; // 見た目／当たり判定の半径
const ENEMY_SPEED = 110; // 下りてくる速さ（px/秒）。蛇の降下に使う
const ENEMY_HP = 1; // 倒すのに必要な被弾数
const SNAIL_SPEED = 45; // カタツムリ：ゆっくり下りる速さ（px/秒）
const SNAKE_AMPLITUDE = 70; // 蛇：左右にくねる幅（px）
const SNAKE_FREQ = 1.8; // 蛇：くねりの速さ
const SNAKE_FIRE_INTERVAL = 1.8; // 蛇：弾を撃つ間隔（秒）。蛇だけが撃ってくる
const SPIDER_SPEED = 130; // 蜘蛛：上下動の基準速さ（px/秒）
const SPIDER_FREQ = 3.0; // 蜘蛛：糸で伸び縮みする速さ
const EAGLE_HP = 2; // 鷲：少し硬い（2発で倒す）
const EAGLE_FALL_SPEED = 55; // 鷲：少しずつ下りる基準速さ（px/秒）
const EAGLE_WANDER_SPEED = 130; // 鷲：ふらふら横移動する速さ（px/秒）
const EAGLE_WANDER_MIN = 0.5; // 鷲：方向を変えるまでの最短時間（秒）
const EAGLE_WANDER_MAX = 1.2; // 鷲：方向を変えるまでの最長時間（秒）
const EAGLE_FIRE_INTERVAL = 2.0; // 鷲：弾を撃つ間隔（秒）
const GOLDPIG_HP = 5; // 黄金の豚：硬い（5発で撃破）
const GOLDPIG_SPEED = 130; // 黄金の豚：画面を横切る速さ（px/秒）
const GOLDPIG_Y = 95; // 黄金の豚：飛ぶ高さ（中心）
const TUNA_SPEED = 260; // マグロ：まっすぐ速く下りる速さ（黄金の豚の2倍）

// クラゲは「蛇と同じ動き」、イカは「鷲と同じ動き」なので専用の定数は不要
// （クラゲ＝snakeの定数、イカ＝eagleの定数をそのまま使う）

// ステージ4（氷の世界）の敵。動きは既存を流用：
//   つらら＝マグロ（まっすぐ速い）、ペンギン＝蛇（くねって撃つ）、シロクマ＝鷲（ふらふら撃つ）
const SHIROKUMA_HP = 3; // シロクマ：硬い（3発で撃破。鷲より手ごわい）
const YUKIDARUMA_HP = 2; // 雪だるま：少し硬い（2発）
const YUKIDARUMA_SPEED = 52; // 雪だるま：ゆっくり下りる速さ（カタツムリくらい）
const YUKIDARUMA_FIRE_INTERVAL = 2.4; // 雪だるま：たまに自機へ弾を撃つ間隔（秒）

// ステージ5（宇宙）の敵。動きは既存を流用：
//   UFO＝シロクマ（ふらふら撃つ・硬め）、隕石＝マグロ（まっすぐ速い）、
//   エイリアン＝蛇（くねって撃つ）、衛星ロボ＝雪だるま（ゆっくり＋たまに撃つ・倒すと爆発）
const UFO_HP = 3; // UFO：硬め（3発。シロクマと同じ）
const SATELLITE_HP = 2; // 衛星ロボ：少し硬い（2発）。倒すと爆発
const SATELLITE_BLAST_RADIUS = ENEMY_RADIUS * 3.0; // 衛星ロボの爆風（雪だるまの2倍範囲）
// ラスボス（メカ母艦ゴリラ）が戦闘中に射出する「お供」＝小型メカゴリラ
const MINION_HP = 2; // 小型メカゴリラ：2発で撃破
const SUMMON_INTERVAL = 4.5; // お供を呼ぶ間隔（秒）
const SUMMON_INTERVAL_ENRAGED = 2.8; // 怒り時はもっと頻繁に呼ぶ
const MINION_MAX = 3; // 同時に存在できるお供の上限（増えすぎ防止）

// エンジェル（お助けキャラ）：黄金の豚と同じく横切りつつ、上下にも大きく動く
const ANGEL_SPEED = 110; // 画面を横切る速さ（px/秒）
const ANGEL_Y = 200; // 上下の動きの中心の高さ
const ANGEL_AMP = 90; // 上下の動きの大きさ（px）。豚より大きく上下する
const MAX_LIVES = 5; // 残機の上限（エンジェルで増えすぎないように）

// 種類ごとの爆発の色（撃破エフェクト用）
const ENEMY_EXPLOSION_COLOR: Record<EnemyKind, string> = {
  snail: "#e8c98f", // カタツムリ＝クリーム色
  snake: "#6cc456", // 蛇＝緑
  spider: "#d2453f", // 蜘蛛＝赤
  eagle: "#b5793a", // 鷲＝こげ茶
  goldpig: "#ffd34d", // 黄金の豚＝金色
  jellyfish: "#ff9ed8", // クラゲ＝うすピンク
  tuna: "#8fb8d6", // マグロ＝青銀
  squid: "#d98fe0", // イカ＝うす紫
  angel: "#fff3b0", // エンジェル＝淡い金（※倒さないので通常は未使用）
  tsurara: "#bfe8ff", // つらら＝氷の水色
  penguin: "#cfe9f5", // ペンギン＝白っぽい水色
  shirokuma: "#eaf3fb", // シロクマ＝白
  yukidaruma: "#ffffff", // 雪だるま＝白
  ufo: "#8ce6ff", // UFO＝水色の光
  meteor: "#ffae6b", // 隕石＝オレンジの火
  alien: "#9cff8c", // エイリアン＝黄緑
  satellite: "#ffd36b", // 衛星ロボ＝金属の黄
  minionGorilla: "#b9c2d6", // 小型メカゴリラ＝銀色
};

// kind … 敵の種類、baseX … 揺れの基準になる横位置、age … 出現からの経過秒
// fireTimer … 次に弾を撃つまでの残り秒（蛇と鷲が使う）
// vx/vy … 1秒あたりの移動量（鷲のふらふら移動に使う）
// wanderTimer … 次にふらふらの向きを変えるまでの残り秒（鷲だけが使う）
// dir … 進む向き。+1=上から下へ（通常）／-1=下から上へ（ステージ2以降の下から出現）
type Enemy = {
  x: number;
  y: number;
  hp: number;
  kind: EnemyKind;
  baseX: number;
  age: number;
  fireTimer: number;
  vx: number;
  vy: number;
  wanderTimer: number;
  dir: number;
};
const enemies: Enemy[] = [];

// タイムライン進行用：ステージ開始からの経過秒と、次に処理するイベント番号
let stageTime = 0;
let nextEventIndex = 0;

// バナナ（スピードアップ）の出現スケジュール。1ステージに2個、道中のランダムな時刻に出す。
// ボス戦中・中ボス戦中は道中の時間が進まない／ボスがいるので出ない。
let bananaTimes: number[] = [];
function scheduleBananas(): void {
  const lo = 2.0; // 早すぎないように
  const hi = Math.max(lo + 1, stage.duration - 2.0); // ボス直前は避ける
  const rand = () => lo + Math.random() * (hi - lo);
  bananaTimes = [rand(), rand()].sort((a, b) => a - b);
}
// バナナを1個、画面の上のランダムな横位置に落とす
function spawnBanana(): void {
  const x = ITEM_RADIUS + Math.random() * (WIDTH - ITEM_RADIUS * 2);
  items.push({ x, y: -ITEM_RADIUS, kind: "speed" });
}

// 敵を1体作る。from="bottom" のときは画面の下から上へ向かって出る。
function spawnEnemy(kind: EnemyKind, xRatio: number, from: "top" | "bottom" = "top"): void {
  // 横切る黄金の豚・エンジェルは「下から」を無視（左右から登場するため）
  const dir = from === "bottom" && kind !== "goldpig" && kind !== "angel" ? -1 : 1;
  let x = xRatio * WIDTH;
  // dir が -1（下から）なら画面下の外側に、+1（上から）なら画面上の外側に出す
  let y = dir < 0 ? HEIGHT + ENEMY_RADIUS : -ENEMY_RADIUS;
  // 発射タイミングを少しずらして、全部が同時に撃たないようにする
  let fireTimer = SNAKE_FIRE_INTERVAL * (0.6 + Math.random() * 0.8);
  let hp = ENEMY_HP;
  let vx = 0;
  let vy = 0;
  if (kind === "eagle" || kind === "squid" || kind === "shirokuma" || kind === "ufo") {
    // イカ・シロクマ・UFOは鷲と同じ動き（ふらふら動いて撃つ）。シロクマ・UFOは硬い
    hp = kind === "shirokuma" ? SHIROKUMA_HP : kind === "ufo" ? UFO_HP : EAGLE_HP;
    fireTimer = EAGLE_FIRE_INTERVAL * (0.5 + Math.random());
    vy = EAGLE_FALL_SPEED * dir; // 進む向き（下から出たら上へ）
  } else if (kind === "yukidaruma" || kind === "satellite") {
    // 雪だるま・衛星ロボ：ゆっくり下りつつ、たまに撃つ（少し硬い）。倒すと爆発
    hp = kind === "satellite" ? SATELLITE_HP : YUKIDARUMA_HP;
    fireTimer = YUKIDARUMA_FIRE_INTERVAL * (0.6 + Math.random() * 0.8);
  } else if (kind === "goldpig") {
    hp = GOLDPIG_HP;
    // x=0 なら左から右へ、x=1 なら右から左へ、画面の外から飛んでくる
    const fromLeft = xRatio < 0.5;
    vx = (fromLeft ? 1 : -1) * GOLDPIG_SPEED;
    x = fromLeft ? -ENEMY_RADIUS : WIDTH + ENEMY_RADIUS;
    y = GOLDPIG_Y;
  } else if (kind === "angel") {
    // エンジェル：黄金の豚と同じく画面外から横切る（上下にも大きく動く）
    const fromLeft = xRatio < 0.5;
    vx = (fromLeft ? 1 : -1) * ANGEL_SPEED;
    x = fromLeft ? -ENEMY_RADIUS : WIDTH + ENEMY_RADIUS;
    y = ANGEL_Y;
  }
  enemies.push({ x, y, hp, kind, baseX: x, age: 0, fireTimer, vx, vy, wanderTimer: 0, dir });
}

// 自機のショットを撃つ。強化段階で弾の数と広がりが変わる。
function fireShot(): void {
  const y = player.y - 16;
  if (player.power >= 4) {
    // 4段階：前方に3つに分かれる弾（正面＋左右ななめ＝当初の3段階の形）
    //        ＋後方に2つに分かれる弾（左右に開いて下へ）
    const back = player.y + 16; // 後方（下）の発射位置
    bullets.push({ x: player.x, y, vx: 0, vy: -BULLET_SPEED });
    bullets.push({ x: player.x, y, vx: -150, vy: -BULLET_SPEED });
    bullets.push({ x: player.x, y, vx: 150, vy: -BULLET_SPEED });
    bullets.push({ x: player.x, y: back, vx: -120, vy: BULLET_SPEED });
    bullets.push({ x: player.x, y: back, vx: 120, vy: BULLET_SPEED });
  } else if (player.power === 3) {
    // 3段階：正面 + 左右に少し開く3way
    bullets.push({ x: player.x, y, vx: 0, vy: -BULLET_SPEED });
    bullets.push({ x: player.x, y, vx: -150, vy: -BULLET_SPEED });
    bullets.push({ x: player.x, y, vx: 150, vy: -BULLET_SPEED });
  } else if (player.power === 2) {
    // 2段階：左右に並んだ2発
    bullets.push({ x: player.x - 8, y, vx: 0, vy: -BULLET_SPEED });
    bullets.push({ x: player.x + 8, y, vx: 0, vy: -BULLET_SPEED });
  } else {
    // 1段階：正面に1発
    bullets.push({ x: player.x, y, vx: 0, vy: -BULLET_SPEED });
  }

  // 5段階：お供の小亀がその位置から前後（上下）にまっすぐレーザーを撃つ
  if (player.power >= 5 && optionTurtle.active) {
    bullets.push({ x: optionTurtle.x, y: optionTurtle.y - 12, vx: 0, vy: -LASER_SPEED, laser: true });
    bullets.push({ x: optionTurtle.x, y: optionTurtle.y + 12, vx: 0, vy: LASER_SPEED, laser: true });
  }
}

// ボスを登場させる（種類はステージごとに決まる）。
// isMid=true なら中ボス（倒しても次ステージへ進まず、道中が再開する）。
function spawnBoss(kind: BossKind, isMid = false): void {
  const cfg = BOSS_CONFIG[kind];
  boss = {
    x: WIDTH / 2,
    y: -BOSS_RADIUS,
    hp: cfg.maxHp,
    maxHp: cfg.maxHp,
    kind,
    phase: "enter",
    dir: 1,
    fireTimer: cfg.fireInterval,
    patternIndex: 0,
    walk: 0,
    spinAngle: 0,
    moveTime: 0,
    enraged: false,
    isMid,
    summonTimer: SUMMON_INTERVAL,
    chargeState: "none",
    chargeTimer: cfg.chargeInterval || 999, // 0（突進なし）のボスは事実上発動しない
    chargeStateTimer: 0,
    chargeVX: 0,
    chargeVY: 0,
  };
  if (!isMid) bossSpawned = true; // 中ボスは「ステージのボスを出した」扱いにしない
  setMusic(stage.bossMusic); // ボス登場でそのステージのボスBGMに切り替え（中ボスも流用）
}

// お供（小型メカゴリラ）を1体、母艦の位置あたりから射出する。
// 動きは鷲と同じ（ふらふら動いて撃つ。spawnEnemy を通さず直接追加）。
function spawnMinion(x: number, y: number): void {
  enemies.push({
    x,
    y,
    hp: MINION_HP,
    kind: "minionGorilla",
    baseX: x,
    age: 0,
    fireTimer: EAGLE_FIRE_INTERVAL * (0.5 + Math.random()),
    vx: (Math.random() * 2 - 1) * EAGLE_WANDER_SPEED,
    vy: EAGLE_FALL_SPEED,
    wanderTimer: 0,
    dir: 1,
  });
}

// 敵弾を1発、指定の向き（角度ラジアン）に撃つ
function fireEnemyBullet(x: number, y: number, angle: number): void {
  enemyBullets.push({
    x,
    y,
    vx: Math.cos(angle) * EBULLET_SPEED,
    vy: Math.sin(angle) * EBULLET_SPEED,
    color: currentEBulletColor,
  });
}

// 攻撃パターン0：自機を狙って3発（少しずつ角度をずらす）
function bossPatternAimed(b: Boss): void {
  const base = Math.atan2(player.y - b.y, player.x - b.x);
  for (const offset of [-0.15, 0, 0.15]) {
    fireEnemyBullet(b.x, b.y + BOSS_RADIUS, base + offset);
  }
}

// 攻撃パターン1：下方向に扇状にばらまく
function bossPatternFan(b: Boss): void {
  const count = 7;
  const spread = 1.2; // 扇の広さ（ラジアン）
  const start = Math.PI / 2 - spread / 2; // 真下を中心に
  for (let i = 0; i < count; i++) {
    const angle = start + (spread * i) / (count - 1);
    fireEnemyBullet(b.x, b.y + BOSS_RADIUS, angle);
  }
}

// 攻撃パターン2：自機を狙って広めに5発（機械ゴリラ用）
function bossPatternAimedWide(b: Boss): void {
  const base = Math.atan2(player.y - b.y, player.x - b.x);
  for (const offset of [-0.32, -0.16, 0, 0.16, 0.32]) {
    fireEnemyBullet(b.x, b.y + BOSS_RADIUS, base + offset);
  }
}

// 攻撃パターン3：全方位にリング状にばらまく（機械ゴリラ用）
function bossPatternRing(b: Boss): void {
  const count = 16;
  for (let i = 0; i < count; i++) {
    fireEnemyBullet(b.x, b.y, (i / count) * Math.PI * 2);
  }
}

// 攻撃パターン4：回転しながら撃つ「うずまき弾」（機械ゴリラ用）
//   呼ばれるたびに少しずつ角度がずれて、らせん状に弾が広がる
function bossPatternSpiral(b: Boss): void {
  for (let i = 0; i < 4; i++) {
    fireEnemyBullet(b.x, b.y, b.spinAngle + (i / 4) * Math.PI * 2);
  }
  b.spinAngle += 0.45; // 次回は少し回す
}

// 攻撃パターン5：左右の腕から下方向へ2列の連射（機械ゴリラ用）
function bossPatternTwinStream(b: Boss): void {
  for (const side of [-1, 1]) {
    const x = b.x + side * 26;
    for (const offset of [-0.12, 0, 0.12]) {
      fireEnemyBullet(x, b.y + 10, Math.PI / 2 + offset);
    }
  }
}

// 攻撃パターン6：画面の上のあちこちから、まっすぐ下へ「つらら」を降らせる（スノーゴリラ用）
function bossPatternIcicles(b: Boss): void {
  void b;
  for (let i = 0; i < 6; i++) {
    const x = (WIDTH / 6) * (i + 0.5) + (Math.random() * 30 - 15);
    fireEnemyBullet(x, 8, Math.PI / 2); // 真下へ
  }
}

// ボスごとに弾の色を変える（見分けやすく・テーマに合わせて）
//   ステージ1=炎のオレンジ／2=電撃の水色／3=深海の緑／4=氷の白青／中ボス=紫／ラスボス=金
const BOSS_BULLET_COLOR: Record<BossKind, string> = {
  gorilla: "#ff7a2f",
  machineGorilla: "#46c8ff",
  scubaGorilla: "#3bffc4",
  snowGorilla: "#bfe8ff",
  spaceChimp: "#b06bff",
  motherGorilla: "#ffcf3b",
};

// ボスの表示名（HPバーの下に出す）
const BOSS_NAME: Record<BossKind, string> = {
  gorilla: "ゴリラ",
  machineGorilla: "機械ゴリラ",
  scubaGorilla: "酸素ボンベゴリラ",
  snowGorilla: "スノーゴリラ",
  spaceChimp: "宇宙チンパンジー",
  motherGorilla: "メカ母艦ゴリラ",
};

// ボスごとの設定（体力・動き・攻撃の激しさ・使う技の一覧）
type BossConfig = {
  maxHp: number; // 体力
  swaySpeed: number; // 左右移動の速さ
  swaySpeedEnraged: number; // 怒り時の左右移動の速さ
  bobAmplitude: number; // 前後（上下）に動く幅（px）。0なら前後移動しない
  bobSpeed: number; // 前後移動の速さ
  fireInterval: number; // 攻撃と攻撃の間隔（秒）
  fireIntervalEnraged: number; // 怒り時の攻撃間隔（短い＝激しい）
  patterns: ((b: Boss) => void)[]; // 順番に使う攻撃技
  chargeInterval: number; // 突進の間隔（秒）。0なら突進しない
  chargeIntervalEnraged: number; // 怒り時の突進間隔
  chargeSpeed: number; // 突進の速さ（px/秒）
};

const BOSS_CONFIG: Record<BossKind, BossConfig> = {
  // ステージ1：ゴリラ（おとなしめ・左右のみ・2種の技）
  gorilla: {
    maxHp: 80,
    swaySpeed: 60,
    swaySpeedEnraged: 105,
    bobAmplitude: 0,
    bobSpeed: 0,
    fireInterval: 1.4,
    fireIntervalEnraged: 0.75,
    patterns: [bossPatternAimed, bossPatternFan],
    chargeInterval: 0, // 突進しない
    chargeIntervalEnraged: 0,
    chargeSpeed: 0,
  },
  // ステージ2：機械ゴリラ（硬い・左右＋前後に動く・多彩な5種の技）
  machineGorilla: {
    maxHp: 120,
    swaySpeed: 85,
    swaySpeedEnraged: 140,
    bobAmplitude: 50, // 自機に近づいたり離れたり、前後に動く
    bobSpeed: 1.3,
    fireInterval: 1.1,
    fireIntervalEnraged: 0.6,
    patterns: [
      bossPatternAimedWide,
      bossPatternFan,
      bossPatternRing,
      bossPatternTwinStream,
      bossPatternSpiral,
    ],
    chargeInterval: 0, // 突進しない
    chargeIntervalEnraged: 0,
    chargeSpeed: 0,
  },
  // ステージ3：酸素ボンベのゴリラ（機械ゴリラの動き＋たまに自機へ突進）
  scubaGorilla: {
    maxHp: 150,
    swaySpeed: 90,
    swaySpeedEnraged: 145,
    bobAmplitude: 50, // 前後にも動く（機械ゴリラと同じ）
    bobSpeed: 1.3,
    fireInterval: 1.1,
    fireIntervalEnraged: 0.6,
    patterns: [
      bossPatternAimedWide,
      bossPatternFan,
      bossPatternRing,
      bossPatternTwinStream,
      bossPatternSpiral,
    ],
    chargeInterval: 5.0, // 約5秒ごとに突進
    chargeIntervalEnraged: 3.0, // 怒り時はもっと頻繁に
    chargeSpeed: 430, // 突進の速さ
  },
  // ステージ4：スノーゴリラ（酸素ボンベゴリラより少し硬く・つらら降らしを追加）
  snowGorilla: {
    maxHp: 165,
    swaySpeed: 95,
    swaySpeedEnraged: 150,
    bobAmplitude: 50, // 前後にも動く
    bobSpeed: 1.3,
    fireInterval: 1.05,
    fireIntervalEnraged: 0.58,
    patterns: [
      bossPatternAimedWide,
      bossPatternIcicles, // つらら降らし
      bossPatternFan,
      bossPatternRing,
      bossPatternIcicles,
      bossPatternSpiral,
      bossPatternTwinStream,
    ],
    chargeInterval: 5.5, // たまに突進（氷の床を滑るイメージ）
    chargeIntervalEnraged: 3.2,
    chargeSpeed: 450,
  },
  // ステージ5：宇宙チンパンジー（中ボス）。素早く動くが体力は控えめ
  spaceChimp: {
    maxHp: 95,
    swaySpeed: 120, // すばしっこく左右に動く
    swaySpeedEnraged: 170,
    bobAmplitude: 35, // 前後にもひょいひょい動く
    bobSpeed: 1.8,
    fireInterval: 1.2,
    fireIntervalEnraged: 0.7,
    patterns: [bossPatternAimed, bossPatternFan, bossPatternAimedWide],
    chargeInterval: 0, // 突進しない
    chargeIntervalEnraged: 0,
    chargeSpeed: 0,
  },
  // ステージ5：メカ母艦ゴリラ（ラスボス）。シリーズ最高HP＋全技＋お供を射出
  motherGorilla: {
    maxHp: 260, // シリーズ最高の体力
    swaySpeed: 80,
    swaySpeedEnraged: 130,
    bobAmplitude: 55, // 前後にも大きく動く
    bobSpeed: 1.2,
    fireInterval: 0.95, // 攻撃が激しい
    fireIntervalEnraged: 0.55,
    patterns: [
      bossPatternAimedWide,
      bossPatternFan,
      bossPatternRing,
      bossPatternTwinStream,
      bossPatternIcicles, // 上から降り注ぐ弾も流用
      bossPatternSpiral,
      bossPatternAimed,
    ],
    chargeInterval: 6.0, // たまに突進
    chargeIntervalEnraged: 3.5,
    chargeSpeed: 460,
  },
};

// 突進（酸素ボンベのゴリラ専用）の状態を進める。
//   none（通常）→ windup（少し引いてためる）→ dash（自機めがけて突っ込む）
//   → back（元の高さへ戻る）→ none … をくり返す。
//   突進中は true を返し、その間は通常の左右移動・攻撃を止める。
function updateBossCharge(b: Boss, cfg: BossConfig, dt: number): boolean {
  if (b.chargeState === "none") {
    b.chargeTimer -= dt;
    if (b.chargeTimer <= 0) {
      b.chargeState = "windup";
      b.chargeStateTimer = 0.5; // ためる時間
    }
    return false; // まだ通常行動
  }

  if (b.chargeState === "windup") {
    // 少し上に引いて「ためる」。狙いは最新の自機位置に合わせ続ける
    b.y -= 35 * dt;
    b.chargeStateTimer -= dt;
    if (b.chargeStateTimer <= 0) {
      const ang = Math.atan2(player.y - b.y, player.x - b.x);
      const sp = cfg.chargeSpeed * (b.enraged ? 1.25 : 1);
      b.chargeVX = Math.cos(ang) * sp;
      b.chargeVY = Math.sin(ang) * sp;
      b.chargeState = "dash";
    }
  } else if (b.chargeState === "dash") {
    // 自機めがけて突っ込む。横は画面端ではね返す
    b.x += b.chargeVX * dt;
    b.y += b.chargeVY * dt;
    if (b.x < BOSS_RADIUS) {
      b.x = BOSS_RADIUS;
      b.chargeVX = Math.abs(b.chargeVX);
    } else if (b.x > WIDTH - BOSS_RADIUS) {
      b.x = WIDTH - BOSS_RADIUS;
      b.chargeVX = -Math.abs(b.chargeVX);
    }
    // 画面下のほうまで突っ込んだら戻りへ
    if (b.y >= HEIGHT - BOSS_RADIUS - 30) {
      b.y = HEIGHT - BOSS_RADIUS - 30;
      b.chargeState = "back";
    }
  } else {
    // back：元の高さへ戻る
    b.y -= BOSS_ENTER_SPEED * 1.8 * dt;
    if (b.y <= BOSS_Y_TARGET) {
      b.y = BOSS_Y_TARGET;
      b.chargeState = "none";
      b.chargeTimer = b.enraged ? cfg.chargeIntervalEnraged : cfg.chargeInterval;
      b.moveTime = 0; // 前後移動の位相をリセット
    }
  }
  return true; // 突進中
}

// 自機がダメージを受けたときの共通処理（敵との接触・敵弾の両方から呼ぶ）
function damagePlayer(): void {
  player.lives -= 1;
  player.power = Math.max(1, player.power - 1); // 被弾で1段階ダウン
  spawnExplosion(player.x, player.y, "#5cff9d", 24);
  playHit();
  // 被弾の手応え：画面を揺らし、一瞬だけ動きを止める
  shakeTime = SHAKE_TIME;
  hitStop = HITSTOP_TIME;
  if (player.lives <= 0) {
    gameState = "gameover";
    resultLock = 0.8; // 誤リスタート防止
    saveHighScoreIfNeeded();
    setMusic(null); // ゲームオーバーでBGMを止める
    shakeTime = SHAKE_TIME * 1.8; // 最後の1機は大きく揺らす
  } else {
    player.invincible = INVINCIBLE_TIME; // しばらく無敵で復活
  }
}

// 倒すと爆発する敵の共通処理。範囲内に自機がいれば被弾（無敵中はノーダメージ）。
function blastExplode(x: number, y: number, radius: number, color: string, count: number): void {
  spawnExplosion(x, y, color, count);
  if (player.invincible <= 0 && hit(x, y, radius, player.x, player.y, PLAYER_RADIUS)) {
    damagePlayer();
  }
}

// 雪だるまは倒されると爆発する。爆風の範囲は当たり判定(ENEMY_RADIUS)の1.5倍（約21px）。
function snowmanExplode(x: number, y: number): void {
  blastExplode(x, y, ENEMY_RADIUS * 1.5, "#dff0fb", 26);
}

// 衛星ロボは倒されると爆発する。爆風の範囲は雪だるまの2倍（ENEMY_RADIUS*3.0＝約48px）。
function satelliteExplode(x: number, y: number): void {
  blastExplode(x, y, SATELLITE_BLAST_RADIUS, "#ffe39a", 40);
}

// 敵が倒れたときに「爆発する敵」なら爆風を出す（雪だるま・衛星ロボ）。
function explodeOnDeath(e: Enemy): void {
  if (e.kind === "yukidaruma") snowmanExplode(e.x, e.y);
  else if (e.kind === "satellite") satelliteExplode(e.x, e.y);
}

// ボム発動：画面全体を攻撃し、敵弾を消し、しばらく無敵になる
function useBomb(): void {
  player.bombs -= 1;
  score = Math.max(0, score - BOMB_PENALTY); // ボムを使うと減点
  bombFlash = BOMB_FLASH_TIME;
  player.invincible = Math.max(player.invincible, BOMB_INVINCIBLE_TIME);
  playBomb();
  // ド派手な発動演出：三重の衝撃波リング＋自機まわりのキラキラ＋画面揺れ
  spawnRing(player.x, player.y, "#ffffff", Math.max(WIDTH, HEIGHT));
  spawnRing(player.x, player.y, "#8bd8ff", Math.max(WIDTH, HEIGHT) * 0.72);
  spawnRing(player.x, player.y, "#bfe9ff", Math.max(WIDTH, HEIGHT) * 0.46);
  spawnExplosion(player.x, player.y, "#bfe9ff", 28);
  spawnExplosion(player.x, player.y, "#ffffff", 14);
  shakeTime = SHAKE_TIME;

  // 画面内の雑魚を全部倒す（爆発と得点つき。アイテムは出ない）
  // ※エンジェル（お助けキャラ）は巻き込まず残す
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.kind === "angel") continue; // エンジェルは残す
    spawnExplosion(e.x, e.y, ENEMY_EXPLOSION_COLOR[e.kind], 14);
    // 雪だるま・衛星ロボは倒されると爆発（ボム発動中は無敵なので自機ダメージなし）
    explodeOnDeath(e);
    score += e.kind === "goldpig" ? SCORE_ENEMY * 2 : SCORE_ENEMY;
    defeated += 1;
    enemies.splice(i, 1);
  }

  // 飛んでいる敵弾を全部消す（緊急回避）
  enemyBullets.length = 0;

  // ボスがいれば大ダメージ
  if (boss) {
    boss.hp -= BOSS_BOMB_DAMAGE;
    spawnExplosion(boss.x, boss.y, "#ffffff", 20);
    if (boss.hp <= 0) {
      defeatBoss(); // 次ステージへ進むか全クリア
    } else {
      playBossHit();
    }
  }
}

// ボスを倒したときの共通処理。
//   まだ後のステージがあれば次へ進み、最後のステージならゲームクリア。
function defeatBoss(): void {
  if (!boss) return;
  const color =
    boss.kind === "machineGorilla"
      ? "#7fe9ff"
      : boss.kind === "scubaGorilla"
        ? "#7fffe0"
        : boss.kind === "snowGorilla"
          ? "#cdeefb"
          : boss.kind === "spaceChimp"
            ? "#ffd27f"
            : boss.kind === "motherGorilla"
              ? "#9fb4ff"
              : "#b15cff";
  const bx = boss.x;
  const by = boss.y;
  // 破片を中心＋周囲に何度もまき散らす（大量）
  spawnExplosion(bx, by, "#ffffff", 34); // 白い閃光の破片
  spawnExplosion(bx, by, color, 60);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    spawnExplosion(bx + Math.cos(a) * 26, by + Math.sin(a) * 26, color, 16);
  }
  // 三重の衝撃波リング（大・中・小）
  spawnRing(bx, by, "#ffffff", 210);
  spawnRing(bx, by, color, 150);
  spawnRing(bx, by, color, 95);
  // 画面フラッシュ＋大きめの揺れ＋一瞬のため（インパクト）
  bossDefeatFlash = BOSS_DEFEAT_FLASH_TIME;
  bossDefeatColor = color;
  shakeTime = SHAKE_TIME * 1.6;
  hitStop = 0.16;
  playBossExplosion();
  const wasMid = boss.isMid;
  boss = null;

  // 中ボスを倒したとき：ステージは進めず、道中を再開する（雑魚出現が再びはじまる）
  if (wasMid) {
    score += SCORE_MIDBOSS;
    setMusic(stage.normalMusic); // 道中BGMに戻す
    return;
  }

  score += SCORE_BOSS;
  if (stageIndex < STAGES.length - 1) {
    advanceStage(); // 次のステージへ（連戦）
  } else {
    gameState = "clear"; // 最後のボスを倒した＝全クリア
    // 残機が満タンから1減るごとに減点（残機を多く残すほど高得点）
    clearLifePenalty = Math.max(0, START_LIVES - player.lives) * LIFE_PENALTY;
    score = Math.max(0, score - clearLifePenalty);
    resultLock = 0.8;
    saveHighScoreIfNeeded();
    setMusic("ending"); // 全クリアのお祝いBGMを流す
  }
}

// 次のステージへ進む。残機・パワー・スコアは引き継ぐ。
function advanceStage(): void {
  stageIndex += 1;
  stage = STAGES[stageIndex];
  theme = stage.theme; // 背景テーマを切り替え
  stageTime = 0;
  nextEventIndex = 0;
  bossSpawned = false;
  midBossSpawned = false;
  enemies.length = 0;
  enemyBullets.length = 0;
  bullets.length = 0;
  items.length = 0;
  scheduleBananas(); // このステージのバナナ出現タイミングを決め直す
  stageBanner = STAGE_BANNER_TIME; // 「STAGE 2」などを表示
  setMusic(stage.normalMusic); // そのステージの道中BGMに切り替え
}

// ゲームを最初の状態に戻す（開始時とリスタート時に呼ぶ）
function resetGame(): void {
  player.x = WIDTH / 2;
  player.y = HEIGHT - 90;
  player.fireCooldown = 0;
  player.lives = START_LIVES;
  player.invincible = 0;
  player.power = 1;
  player.speedLevel = 0; // スピードアップもリセット
  player.lean = 0;
  optionTurtle.active = false; // お供の小亀はリセット（5段階で再び出現）
  player.bombs = START_BOMBS;
  bombFlash = 0;
  bossDefeatFlash = 0;
  bombKeyWasDown = false;
  shakeTime = 0;
  hitStop = 0;
  bullets.length = 0;
  enemies.length = 0;
  items.length = 0;
  enemyBullets.length = 0;
  particles.length = 0;
  trails.length = 0;
  floatTexts.length = 0;
  rings.length = 0;
  boss = null;
  bossSpawned = false;
  midBossSpawned = false;
  stageIndex = 0; // 最初のステージから
  stage = STAGES[0];
  theme = stage.theme;
  stageBanner = STAGE_BANNER_TIME; // 「STAGE 1」を表示
  stageTime = 0;
  nextEventIndex = 0;
  scheduleBananas(); // ステージ1のバナナ出現タイミングを決める
  defeated = 0;
  score = 0;
  clearLifePenalty = 0;
  newRecord = false;
  // タッチ操作の状態も初期化（押しっぱなし扱いが残らないように）
  touchDirX = 0;
  touchDirY = 0;
  touchFire = false;
  touchRoles.clear();
  gameState = "playing";
  setMusic(stage.normalMusic); // 道中はそのステージの通常BGM
}

// 倒した数（スコアの土台。正式なスコア表示はステップ8で整える）
let defeated = 0;

// 二点が「当たっているか」を円どうしで判定する。
// 距離が「半径の合計」より近ければ当たり。
// （平方根を使わず、両辺を2乗で比べると速い）
function hit(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy < r * r;
}


// -------------------------------------------------------------------
// update: ゲームの状態を「STEP秒ぶん」進める（固定タイムステップ）
// -------------------------------------------------------------------
function update(dt: number): void {
  // --- 背景の星（ゲームオーバー中も流し続ける）---
  for (const s of stars) {
    s.y += s.speed * dt;
    if (s.y > HEIGHT) {
      s.y -= HEIGHT;
      s.x = Math.random() * WIDTH;
    }
  }

  // --- 背景の装飾レイヤー（山・雲・地面）も常に流す ---
  updateLayer(farHills, dt, 60);
  updateLayer(clouds, dt, 40);
  updateLayer(nearGround, dt, 70);
  updateIslands(dt); // 地球の空テーマの島（同じ速さ・等間隔で重ならない）
  updateBubbles(dt); // 海の中テーマの泡（下から上へ立ちのぼる）
  updateSnow(dt); // 氷の世界テーマの降る雪

  // ボムの閃光・画面の揺れを時間で弱めていく（どの状態でも進める）
  if (bombFlash > 0) bombFlash -= dt;
  if (bossDefeatFlash > 0) bossDefeatFlash -= dt;
  if (shakeTime > 0) shakeTime -= dt;

  // --- 爆発の破片（どの状態でも動かし続ける）---
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96; // だんだん減速
    p.vy *= 0.96;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // --- エンジン噴射の粒：流れながら消える ---
  for (let i = trails.length - 1; i >= 0; i--) {
    const tr = trails[i];
    tr.x += tr.vx * dt;
    tr.y += tr.vy * dt;
    tr.vx *= 0.94;
    tr.life -= dt;
    if (tr.life <= 0) trails.splice(i, 1);
  }

  // --- 浮かぶ文字（「+100」など）：ゆっくり上へ昇って消える ---
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i];
    f.y -= 28 * dt; // 上に昇る
    f.life -= dt;
    if (f.life <= 0) floatTexts.splice(i, 1);
  }

  // --- 光の輪：時間で寿命を減らす（広がり具合は寿命から計算）---
  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].life -= dt;
    if (rings[i].life <= 0) rings.splice(i, 1);
  }

  // この1フレームのタップ（タッチ操作）を1回だけ取り出す
  const tapped = uiTap;
  uiTap = false;

  // タイトル画面：キー or タップでゲーム開始
  if (gameState === "title") {
    // タイトルでは壮大なファンファーレを流す。
    // （音はブラウザの制限で最初の操作後に有効になるため、有効になり次第ここで鳴り始める）
    setMusic("title");
    if (titleLock > 0) titleLock -= dt;
    else if (isDown("KeyZ", "Space", "Enter") || tapped) {
      // まだ一度も音を有効化していなければ、この操作は「BGMを鳴らす合図」にする。
      // （こうしないと、最初の1操作で即ゲーム開始してタイトル曲が鳴る間がない）
      if (!audioReady) {
        audioReady = true;
        titleLock = 0.6; // 続けてもう一度押すとスタート（曲を聴ける間をつくる）
      } else {
        resetGame();
      }
    }
    return;
  }

  // 決着後（ゲームオーバー / クリア）は、キー or タップでタイトルへ戻る
  if (gameState === "gameover" || gameState === "clear") {
    if (resultLock > 0) resultLock -= dt;
    else if (isDown("KeyZ", "Space", "Enter") || tapped) {
      gameState = "title";
      titleLock = 0.4; // 押しっぱなしで即スタートしないように
      theme = "night"; // タイトルは夜空の背景に戻す
    }
    return;
  }

  // 無敵時間を減らす
  if (player.invincible > 0) player.invincible -= dt;

  // --- 自機の移動 ---
  let dx = 0;
  let dy = 0;
  if (isDown("ArrowLeft", "KeyA")) dx -= 1;
  if (isDown("ArrowRight", "KeyD")) dx += 1;
  if (isDown("ArrowUp", "KeyW")) dy -= 1;
  if (isDown("ArrowDown", "KeyS")) dy += 1;

  // 斜め移動が速くなりすぎないように調整（ベクトルの正規化）
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.sqrt(2);
    dx *= inv;
    dy *= inv;
  }

  // タッチの移動パッドが使われていれば、そちらを優先（指の倒し具合で速さが変わる）
  if (touchDirX !== 0 || touchDirY !== 0) {
    dx = touchDirX;
    dy = touchDirY;
  }

  // スピードアップ段階に応じて移動速度を上げる（バナナ1個ごとに +20%）
  const moveSpeed = PLAYER_SPEED * (1 + player.speedLevel * SPEED_STEP);
  player.x += dx * moveSpeed * dt;
  player.y += dy * moveSpeed * dt;

  // 首の傾きを、今の左右入力（-1/0/+1）へなめらかに近づける
  const leanTarget = Math.sign(dx);
  player.lean += (leanTarget - player.lean) * Math.min(1, dt * 12);

  // 画面の外に出ないように位置を制限する
  player.x = Math.max(PLAYER_RADIUS, Math.min(WIDTH - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(HEIGHT - PLAYER_RADIUS, player.y));

  // --- エンジン噴射：自機の後ろ（下）から光の粒を出す。動くと勢いが増す ---
  const moving = dx !== 0 || dy !== 0;
  const rearY = player.y + PLAYER_RADIUS * 0.7;
  const puffs = moving ? 2 : 1;
  for (let i = 0; i < puffs; i++) {
    trails.push({
      x: player.x + (Math.random() * 6 - 3),
      y: rearY,
      vx: (Math.random() * 2 - 1) * 16 - dx * 22, // 移動と逆向きに少し流す
      vy: (moving ? 70 : 40) + Math.random() * 45, // 下へ流れる
      life: moving ? 0.32 : 0.22,
      maxLife: moving ? 0.32 : 0.22,
      size: (moving ? 3.2 : 2.2) + Math.random() * 1.8,
    });
  }

  // --- お供の小亀（5段階目）：自機の定位置へなめらかについてくる ---
  if (player.power >= 5) {
    const tx = player.x + OPTION_OFFSET_X;
    const ty = player.y + OPTION_OFFSET_Y;
    if (!optionTurtle.active) {
      // 出現した瞬間は定位置にパッと現れる（画面の外から飛んでこない）
      optionTurtle.x = tx;
      optionTurtle.y = ty;
      optionTurtle.active = true;
    }
    const k = Math.min(1, dt * OPTION_FOLLOW);
    optionTurtle.x += (tx - optionTurtle.x) * k;
    optionTurtle.y += (ty - optionTurtle.y) * k;
  } else {
    optionTurtle.active = false;
  }

  // --- ショット（キー or タッチのショットボタン）---
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if ((isDown("KeyZ", "Space") || touchFire) && player.fireCooldown <= 0) {
    fireShot();
    playShot(player.power);
    player.fireCooldown = FIRE_INTERVAL;
  }

  // --- ボム（緊急回避）：押した瞬間に、残りがあれば発動 ---
  const bombDown = isDown("KeyX", "ShiftLeft", "ShiftRight");
  if (bombDown && !bombKeyWasDown && player.bombs > 0) {
    useBomb();
  }
  bombKeyWasDown = bombDown;

  // 弾を向きに沿って進める
  for (const b of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  // 画面の外（上・下・左右）に出た弾を消す（後方ショット・下向きレーザー対応）
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (b.y < -10 || b.y > HEIGHT + 10 || b.x < -10 || b.x > WIDTH + 10) {
      bullets.splice(i, 1);
    }
  }

  // ステージ名のバナー表示を時間で消していく
  if (stageBanner > 0) stageBanner -= dt;

  // --- 敵の出現（データ駆動タイムライン）---
  // 中ボスと戦っている間は道中の時間を止める（雑魚も出さず、中ボスに集中させる）
  if (!(boss && boss.isMid)) {
    stageTime += dt;
    // 「今の時刻」に達したイベントを順番に処理する
    while (
      nextEventIndex < stage.timeline.length &&
      stage.timeline[nextEventIndex].time <= stageTime
    ) {
      const ev = stage.timeline[nextEventIndex];
      spawnEnemy(ev.kind, ev.x, ev.from);
      nextEventIndex += 1;
    }

    // バナナ（スピードアップ）の出現：予定時刻に達したら落とす。
    // ボスがいる間は出さない（道中だけ）。中ボス戦中はこのブロック自体が動かない。
    while (!boss && bananaTimes.length > 0 && bananaTimes[0] <= stageTime) {
      bananaTimes.shift();
      spawnBanana();
    }
  }

  // --- 敵の移動（種類ごとに動きが違う）---
  for (const e of enemies) {
    e.age += dt;
    if (e.kind === "snail") {
      // カタツムリ：ほとんど動かず、ゆっくり下りる（dir=-1なら上る）だけ
      e.y += SNAIL_SPEED * dt * e.dir;
    } else if (e.kind === "yukidaruma" || e.kind === "satellite") {
      // 雪だるま・衛星ロボ：ゆっくり下りつつ、たまに自機へ弾を撃つ
      e.y += YUKIDARUMA_SPEED * dt * e.dir;
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.y > 0 && e.y < HEIGHT - 80) {
        const angle = Math.atan2(player.y - e.y, player.x - e.x);
        fireEnemyBullet(e.x, e.y, angle);
        e.fireTimer = YUKIDARUMA_FIRE_INTERVAL;
      }
    } else if (
      e.kind === "snake" ||
      e.kind === "jellyfish" ||
      e.kind === "penguin" ||
      e.kind === "alien"
    ) {
      // 蛇・クラゲ・ペンギン・エイリアン：基準位置を中心に、サイン波で左右にくねりながら下りる（dir=-1なら上る）
      e.y += ENEMY_SPEED * dt * e.dir;
      e.x = e.baseX + Math.sin(e.age * SNAKE_FREQ) * SNAKE_AMPLITUDE;
      // 画面内にいる間はたまに自機へ弾を撃つ
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.y > 0 && e.y < HEIGHT - 80) {
        const angle = Math.atan2(player.y - e.y, player.x - e.x);
        fireEnemyBullet(e.x, e.y, angle);
        e.fireTimer = SNAKE_FIRE_INTERVAL;
      }
    } else if (e.kind === "tuna" || e.kind === "tsurara" || e.kind === "meteor") {
      // マグロ・つらら・隕石：まっすぐ進む、ただし速い（黄金の豚の2倍速）。dir=-1なら下から上へ
      e.y += TUNA_SPEED * dt * e.dir;
    } else if (e.kind === "spider") {
      // 蜘蛛：糸で上下に伸び縮みしながら（縦に動いて）下りる。
      // 速さをサイン波で増減させ、時には少し上に戻る＝縦のビヨンビヨン感を出す
      e.y += SPIDER_SPEED * (0.6 + Math.sin(e.age * SPIDER_FREQ)) * dt * e.dir;
    } else if (e.kind === "goldpig") {
      // 黄金の豚：画面を横切りながら、ふわふわ上下に揺れて飛ぶ（横に出たら退場）
      e.x += e.vx * dt;
      e.y = GOLDPIG_Y + Math.sin(e.age * 2.5) * 24;
    } else if (e.kind === "angel") {
      // エンジェル：画面を横切りつつ、上下に大きくゆったり動く（横に出たら退場）
      e.x += e.vx * dt;
      e.y = ANGEL_Y + Math.sin(e.age * 2.2) * ANGEL_AMP;
    } else {
      // 鷲・イカ・シロクマ・UFO・小型メカゴリラ：一定時間ごとに進む向きをランダムに変えて、ふらふら動き回る。
      // 横は気まぐれ、縦は必ず少しずつ下りる（いつか画面外へ出る）。
      e.wanderTimer -= dt;
      if (e.wanderTimer <= 0) {
        e.vx = (Math.random() * 2 - 1) * EAGLE_WANDER_SPEED;
        // 縦は必ず進行方向へ（dir=+1なら下り、dir=-1なら上る）
        e.vy = EAGLE_FALL_SPEED * (0.4 + Math.random() * 1.2) * e.dir;
        e.wanderTimer = EAGLE_WANDER_MIN + Math.random() * (EAGLE_WANDER_MAX - EAGLE_WANDER_MIN);
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      // 画面の左右端で跳ね返す
      if (e.x < ENEMY_RADIUS) {
        e.x = ENEMY_RADIUS;
        e.vx = Math.abs(e.vx);
      } else if (e.x > WIDTH - ENEMY_RADIUS) {
        e.x = WIDTH - ENEMY_RADIUS;
        e.vx = -Math.abs(e.vx);
      }
      // 画面内にいる間は、自機を狙って弾を撃つ
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.y > 0 && e.y < HEIGHT - 80) {
        const angle = Math.atan2(player.y - e.y, player.x - e.x);
        fireEnemyBullet(e.x, e.y, angle);
        e.fireTimer = EAGLE_FIRE_INTERVAL;
      }
    }
  }

  // --- 当たり判定：自分の弾 × 敵 ---
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (e.kind === "angel") continue; // エンジェルはお助けキャラ：弾は素通り
      if (hit(b.x, b.y, BULLET_RADIUS, e.x, e.y, ENEMY_RADIUS)) {
        bullets.splice(bi, 1); // 弾は消える
        e.hp -= 1;
        if (e.hp <= 0) {
          enemies.splice(ei, 1); // 敵を倒した
          defeated += 1;
          if (e.kind === "goldpig") {
            // 黄金の豚：得点は2倍。撃破すると必ずボムを落とす
            score += SCORE_ENEMY * 2;
            spawnExplosion(e.x, e.y, ENEMY_EXPLOSION_COLOR[e.kind], 30);
            items.push({ x: e.x, y: e.y, kind: "bomb" });
          } else {
            score += SCORE_ENEMY;
            spawnExplosion(e.x, e.y, ENEMY_EXPLOSION_COLOR[e.kind], 14);
            // 一定確率でパワーアップアイテムを落とす
            if (Math.random() < ITEM_DROP_RATE) {
              items.push({ x: e.x, y: e.y, kind: "power" });
            }
          }
          playExplosion();
          // 雪だるま・衛星ロボは倒されると爆発（範囲内の自機にダメージ）
          explodeOnDeath(e);
        }
        break; // この弾はもう消えたので、次の弾へ
      }
    }
  }

  // --- アイテム：落下 → 自機が拾うと強化、画面外で消える ---
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.y += ITEM_SPEED * dt;
    if (hit(player.x, player.y, PLAYER_RADIUS, it.x, it.y, ITEM_RADIUS)) {
      items.splice(i, 1);
      if (it.kind === "bomb") {
        player.bombs = Math.min(MAX_BOMBS, player.bombs + 1); // ボムを1つ補充
        // 手応え演出：黄色い光の輪＋「BOMB +1」（ボムは加点なし）
        spawnRing(it.x, it.y, "#ffd23b");
        spawnExplosion(it.x, it.y, "#ffe88a", 8);
        spawnFloatText(it.x, it.y, "BOMB +1", "#ffd23b");
      } else if (it.kind === "speed") {
        player.speedLevel = Math.min(SPEED_MAX, player.speedLevel + 1); // スピード1段階アップ
        score += SCORE_ITEM; // 強化アイテム取得で+100点
        // 手応え演出：光の輪＋キラキラ＋「+100」
        spawnRing(it.x, it.y, "#ffd23b");
        spawnExplosion(it.x, it.y, "#ffe88a", 8);
        spawnFloatText(it.x, it.y, "+100", "#fff36b");
      } else {
        player.power = Math.min(POWER_MAX, player.power + 1); // 1段階アップ
        score += SCORE_ITEM; // 強化アイテム取得で+100点
        // 手応え演出：水色の光の輪＋キラキラ＋「+100」
        spawnRing(it.x, it.y, "#7be0ff");
        spawnExplosion(it.x, it.y, "#bdf3ff", 8);
        spawnFloatText(it.x, it.y, "+100", "#fff36b");
      }
    } else if (it.y > HEIGHT + ITEM_RADIUS) {
      items.splice(i, 1); // 拾えず画面下へ
    }
  }

  // --- お助けキャラ：エンジェルに触れると残機+1（無敵中でも拾える）---
  for (let ei = enemies.length - 1; ei >= 0; ei--) {
    const e = enemies[ei];
    if (e.kind !== "angel") continue;
    if (hit(player.x, player.y, PLAYER_RADIUS, e.x, e.y, ENEMY_RADIUS)) {
      enemies.splice(ei, 1);
      const gained = player.lives < MAX_LIVES;
      if (gained) player.lives += 1; // ハートが1増える（上限あり）
      spawnExplosion(e.x, e.y, "#fff3b0", 18); // 淡い金のキラキラ
      spawnRing(e.x, e.y, "#ffe6a0", 32);
      spawnFloatText(e.x, e.y, gained ? "1UP!" : "MAX", "#ff8aa8");
      playHeal();
    }
  }

  // --- 当たり判定：敵 × 自機（無敵中は当たらない。エンジェルは対象外）---
  if (player.invincible <= 0) {
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (e.kind === "angel") continue; // お助けキャラはダメージを与えない
      if (hit(player.x, player.y, PLAYER_RADIUS, e.x, e.y, ENEMY_RADIUS)) {
        enemies.splice(ei, 1); // ぶつかった敵は壊れる
        damagePlayer();
        break;
      }
    }
  }

  // --- 画面の外（上・下・左右）に出た敵を消す（横切る黄金の豚は左右で退場）---
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (
      e.y > HEIGHT + ENEMY_RADIUS ||
      e.y < -ENEMY_RADIUS - 30 || // 下から上って画面の上へ抜けた敵
      e.x < -ENEMY_RADIUS - 30 ||
      e.x > WIDTH + ENEMY_RADIUS + 30
    ) {
      enemies.splice(i, 1);
    }
  }

  // --- 中ボスの登場（ステージ5）：途中の時刻に達し、雑魚を片付けたら出現。
  //     倒すまで道中の時間は止まる（上のタイムライン処理を参照）---
  if (
    stage.midBoss &&
    !midBossSpawned &&
    !boss &&
    stageTime >= (stage.midBossTime ?? 0) &&
    enemies.length === 0
  ) {
    spawnBoss(stage.midBoss, true); // isMid=true（中ボス）
    midBossSpawned = true;
  }

  // --- ボスの登場：道中が終わり、雑魚を全部片付けたら出現 ---
  if (!bossSpawned && !boss && stageTime >= stage.duration && enemies.length === 0) {
    spawnBoss(stage.boss);
  }

  // --- ボスの行動 ---
  if (boss) {
    const cfg = BOSS_CONFIG[boss.kind];
    boss.walk += dt * 9; // 移動中ずっと腕と足を振り続ける

    // HPが半分以下になった瞬間、一度だけ怒りモードに入る
    if (!boss.enraged && boss.hp <= boss.maxHp * BOSS_ENRAGE_RATIO) {
      boss.enraged = true;
      spawnExplosion(boss.x, boss.y, "#ff3b3b", 30); // 赤い怒りの演出
      playBossHit();
    }

    // メカ母艦ゴリラ（ラスボス）：戦闘中、たまにお供（小型メカゴリラ）を射出する
    if (boss.kind === "motherGorilla" && boss.phase === "fight") {
      boss.summonTimer -= dt;
      if (boss.summonTimer <= 0) {
        const active = enemies.reduce((n, e) => n + (e.kind === "minionGorilla" ? 1 : 0), 0);
        if (active < MINION_MAX) {
          spawnMinion(boss.x + (Math.random() * 50 - 25), boss.y + 24);
        }
        boss.summonTimer = boss.enraged ? SUMMON_INTERVAL_ENRAGED : SUMMON_INTERVAL;
      }
    }

    if (boss.phase === "enter") {
      // 所定の高さまで下りてくる
      boss.y += BOSS_ENTER_SPEED * dt;
      if (boss.y >= BOSS_Y_TARGET) {
        boss.y = BOSS_Y_TARGET;
        boss.phase = "fight";
      }
    } else {
      // 突進する（酸素ボンベのゴリラ）。突進中は通常の移動・攻撃を止める
      const charging =
        cfg.chargeInterval > 0 && updateBossCharge(boss, cfg, dt);

      if (charging) {
        // 突進中に自機へぶつかったらダメージ（無敵中は当たらない）
        if (
          player.invincible <= 0 &&
          hit(player.x, player.y, PLAYER_RADIUS, boss.x, boss.y, BOSS_RADIUS)
        ) {
          damagePlayer();
        }
      } else {
      // 怒りモードなら、左右移動も攻撃も激しくなる
      const swaySpeed = boss.enraged ? cfg.swaySpeedEnraged : cfg.swaySpeed;
      const fireInterval = boss.enraged ? cfg.fireIntervalEnraged : cfg.fireInterval;

      // 左右に往復しながら、一定間隔で攻撃パターンを撃つ
      boss.x += boss.dir * swaySpeed * dt;
      if (boss.x < BOSS_RADIUS) {
        boss.x = BOSS_RADIUS;
        boss.dir = 1;
      } else if (boss.x > WIDTH - BOSS_RADIUS) {
        boss.x = WIDTH - BOSS_RADIUS;
        boss.dir = -1;
      }

      // 前後（上下）の動き：自機に近づいたり離れたりする（機械ゴリラ用）
      // 怒り時は少し速く・大きく動く
      if (cfg.bobAmplitude > 0) {
        boss.moveTime += dt * (boss.enraged ? 1.4 : 1);
        const amp = boss.enraged ? cfg.bobAmplitude * 1.3 : cfg.bobAmplitude;
        boss.y = BOSS_Y_TARGET + Math.sin(boss.moveTime * cfg.bobSpeed) * amp;
      }

      boss.fireTimer -= dt;
      if (boss.fireTimer <= 0) {
        // このボスの色で弾を撃つ（撃ち終わったら通常の赤に戻す）
        currentEBulletColor = BOSS_BULLET_COLOR[boss.kind];
        cfg.patterns[boss.patternIndex](boss);
        boss.patternIndex = (boss.patternIndex + 1) % cfg.patterns.length;
        // 怒り時は、通常の技に加えて自機を狙う弾も撃つ
        if (boss.enraged) bossPatternAimed(boss);
        currentEBulletColor = EBULLET_DEFAULT_COLOR;
        boss.fireTimer = fireInterval;
      }
      } // 通常行動（突進していないとき）の終わり
    }

    // 自分の弾 × ボス
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      if (hit(b.x, b.y, BULLET_RADIUS, boss.x, boss.y, BOSS_RADIUS)) {
        bullets.splice(bi, 1);
        boss.hp -= 1;
        if (boss.hp <= 0) {
          defeatBoss(); // 次ステージへ進むか全クリア
          break;
        }
        // まだ生きていれば、被弾の手応えとして低めの音を鳴らす
        playBossHit();
      }
    }
  }

  // --- 敵弾：移動 → 自機に当たれば被弾 → 画面外で消える ---
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const eb = enemyBullets[i];
    eb.x += eb.vx * dt;
    eb.y += eb.vy * dt;
    const offscreen =
      eb.y < -20 || eb.y > HEIGHT + 20 || eb.x < -20 || eb.x > WIDTH + 20;
    if (offscreen) {
      enemyBullets.splice(i, 1);
    } else if (
      player.invincible <= 0 &&
      hit(player.x, player.y, PLAYER_RADIUS, eb.x, eb.y, EBULLET_RADIUS)
    ) {
      enemyBullets.splice(i, 1);
      damagePlayer();
    }
  }
}

// -------------------------------------------------------------------
// 自機を「頭がキリン・体が亀」の姿で描く。(cx, cy) が中心。上が前方。
// -------------------------------------------------------------------
function drawPlayerGiraffeTurtle(cx: number, cy: number, lean = 0): void {
  ctx.save();
  ctx.translate(cx, cy);

  // --- 亀の体 ---
  // 4枚のひれ（甲羅の四隅から斜めに）
  ctx.fillStyle = "#2e7d43";
  const flippers: [number, number, number][] = [
    [-11, 1, -0.7], // 左前
    [11, 1, 0.7], // 右前
    [-10, 11, 0.5], // 左後
    [10, 11, -0.5], // 右後
  ];
  for (const [fx, fy, rot] of flippers) {
    ctx.beginPath();
    ctx.ellipse(fx, fy, 4, 2.5, rot, 0, Math.PI * 2);
    ctx.fill();
  }
  // しっぽ（後ろ＝下）
  ctx.beginPath();
  ctx.moveTo(-3, 13);
  ctx.lineTo(3, 13);
  ctx.lineTo(0, 19);
  ctx.closePath();
  ctx.fill();

  // 甲羅本体（緑のドーム）
  ctx.fillStyle = "#3fae5a";
  ctx.beginPath();
  ctx.ellipse(0, 6, 12, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // 甲羅のフチを少し濃く
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#2e7d43";
  ctx.stroke();
  // 甲羅の模様（六角っぽい仕切り線）
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(0, 14);
  ctx.moveTo(-9, 6);
  ctx.lineTo(-2, 6);
  ctx.moveTo(2, 6);
  ctx.lineTo(9, 6);
  ctx.stroke();

  // --- キリンの首と頭（前方＝上へ伸びる。移動方向へ傾く） ---
  // 首の付け根(0,1)を軸に、leanの分だけ左右へ傾ける（最大±0.5ラジアン）
  ctx.translate(0, 1);
  ctx.rotate(lean * 0.5);
  ctx.translate(0, -1);
  // 首
  ctx.fillStyle = "#e8b14c";
  ctx.beginPath();
  ctx.moveTo(-3, 1);
  ctx.lineTo(3, 1);
  ctx.lineTo(5, -18);
  ctx.lineTo(1, -20);
  ctx.closePath();
  ctx.fill();
  // 首の模様（キリン柄の斑点）
  ctx.fillStyle = "#b9772b";
  ctx.beginPath();
  ctx.arc(-0.5, -4, 1.4, 0, Math.PI * 2);
  ctx.arc(2, -11, 1.3, 0, Math.PI * 2);
  ctx.fill();

  // 頭（少し前傾）
  ctx.fillStyle = "#e8b14c";
  ctx.beginPath();
  ctx.ellipse(4, -22, 5, 3.4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // 角（ツノ）2本＋先っぽの玉
  ctx.strokeStyle = "#b9772b";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(2, -24);
  ctx.lineTo(1, -28);
  ctx.moveTo(5, -25);
  ctx.lineTo(5, -29);
  ctx.stroke();
  ctx.fillStyle = "#b9772b";
  ctx.beginPath();
  ctx.arc(1, -28.5, 1.3, 0, Math.PI * 2);
  ctx.arc(5, -29.5, 1.3, 0, Math.PI * 2);
  ctx.fill();
  // 目
  ctx.fillStyle = "#1c1208";
  ctx.beginPath();
  ctx.arc(5, -23, 1.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// お供の小亀（5段階目のオプション）を描く。(cx, cy) が中心。
// 自機の亀をぐっと小さくした、頭が上を向いた緑の子亀。
// -------------------------------------------------------------------
function drawMiniTurtle(cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.62, 0.62); // 自機よりひと回り小さく

  // 4枚のひれ
  ctx.fillStyle = "#2e7d43";
  const flippers: [number, number, number][] = [
    [-9, 0, -0.7],
    [9, 0, 0.7],
    [-8, 9, 0.5],
    [8, 9, -0.5],
  ];
  for (const [fx, fy, rot] of flippers) {
    ctx.beginPath();
    ctx.ellipse(fx, fy, 3.4, 2.2, rot, 0, Math.PI * 2);
    ctx.fill();
  }
  // しっぽ
  ctx.beginPath();
  ctx.moveTo(-2.5, 10);
  ctx.lineTo(2.5, 10);
  ctx.lineTo(0, 15);
  ctx.closePath();
  ctx.fill();

  // 甲羅（緑のドーム）
  ctx.fillStyle = "#3fae5a";
  ctx.beginPath();
  ctx.ellipse(0, 4, 10, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "#2e7d43";
  ctx.stroke();
  // 甲羅の模様
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -2.5);
  ctx.lineTo(0, 10.5);
  ctx.moveTo(-7.5, 4);
  ctx.lineTo(-1.5, 4);
  ctx.moveTo(1.5, 4);
  ctx.lineTo(7.5, 4);
  ctx.stroke();

  // 頭（上を向く）＋目
  ctx.fillStyle = "#2e7d43";
  ctx.beginPath();
  ctx.ellipse(0, -8, 4.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1208";
  ctx.beginPath();
  ctx.arc(-1.7, -9, 0.9, 0, Math.PI * 2);
  ctx.arc(1.7, -9, 0.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// パワーアップアイテムをキャベツの姿で描く。(cx, cy) が中心。
// -------------------------------------------------------------------
function drawCabbage(cx: number, cy: number): void {
  const s = ITEM_RADIUS / 10; // ITEM_RADIUS に合わせて拡大縮小
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);

  // 外側の葉（濃い緑のギザギザした輪郭）
  ctx.fillStyle = "#5aa336";
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(ang) * 5, Math.sin(ang) * 5, 5.5, 4.2, ang, 0, Math.PI * 2);
    ctx.fill();
  }
  // 葉のあいだの陰影（少し明るい緑）
  ctx.fillStyle = "#6cb33f";
  ctx.beginPath();
  ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
  ctx.fill();

  // 内側の丸い玉（明るい緑）
  ctx.fillStyle = "#9bd96f";
  ctx.beginPath();
  ctx.arc(-0.5, -0.5, 6.3, 0, Math.PI * 2);
  ctx.fill();

  // 葉脈（中心から外へ伸びるカーブ）
  ctx.strokeStyle = "#5aa336";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.quadraticCurveTo(-4, -1, -2.5, -6);
  ctx.moveTo(0, 3);
  ctx.quadraticCurveTo(4, -1, 2.5, -6);
  ctx.moveTo(0, 4);
  ctx.quadraticCurveTo(-6, 2, -6.5, -2);
  ctx.moveTo(0, 4);
  ctx.quadraticCurveTo(6, 2, 6.5, -2);
  ctx.stroke();

  // 中心の芯（うずまきの中心）
  ctx.fillStyle = "#c6ec9f";
  ctx.beginPath();
  ctx.arc(0, 1, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// スピードアップアイテムをバナナの姿で描く。(cx, cy) が中心。
// -------------------------------------------------------------------
function drawBanana(cx: number, cy: number): void {
  const s = ITEM_RADIUS / 10; // ITEM_RADIUS に合わせて拡大縮小
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.rotate(-0.5); // 少し斜めに

  // バナナの三日月形（外側＝黄、内側をくり抜いた形）
  ctx.fillStyle = "#ffcf33";
  ctx.beginPath();
  ctx.moveTo(-7, 7);
  ctx.quadraticCurveTo(-10, -6, 2, -9); // 外側のカーブ（上）
  ctx.quadraticCurveTo(-2, -3, -3, 4); // 内側のカーブ（下）へ戻る
  ctx.quadraticCurveTo(-5, 6, -7, 7);
  ctx.closePath();
  ctx.fill();

  // 明るいハイライト
  ctx.fillStyle = "#ffe27a";
  ctx.beginPath();
  ctx.moveTo(-6, 5);
  ctx.quadraticCurveTo(-8, -4, 1, -7);
  ctx.quadraticCurveTo(-3, -2, -4, 4);
  ctx.closePath();
  ctx.fill();

  // 両端の茶色いヘタ
  ctx.fillStyle = "#7a5a2a";
  ctx.beginPath();
  ctx.arc(2, -9, 1.6, 0, Math.PI * 2);
  ctx.arc(-7, 7, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // 稜線（バナナの筋）
  ctx.strokeStyle = "#e0a91f";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-5.5, 5);
  ctx.quadraticCurveTo(-8, -3, 0.5, -7.5);
  ctx.stroke();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その1：カタツムリ（動かない敵）。(cx, cy) が中心。
// -------------------------------------------------------------------
function drawSnail(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // ニュルニュル這う動き：体が前後に伸び縮みする
  const reach = Math.sin(age * 4) * 0.07;

  // 這う体（クリーム色）。伸び縮みは体と頭だけにかける
  ctx.save();
  ctx.scale(1 + reach, 1 - reach * 0.5);
  ctx.fillStyle = "#e8c98f";
  ctx.beginPath();
  ctx.ellipse(-1, 9, 15, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 頭（右前方）
  ctx.beginPath();
  ctx.ellipse(11, 3, 6, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 殻（うずまき）
  ctx.fillStyle = "#d98a3d";
  ctx.beginPath();
  ctx.arc(-3, -1, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8a4d1a";
  ctx.lineWidth = 2;
  ctx.stroke();
  // うずまきの線
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 3; a += 0.2) {
    const r = 9.5 - a * 0.95;
    if (r < 1) break;
    const px = -3 + Math.cos(a) * r;
    const py = -1 + Math.sin(a) * r;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // 触角2本＋先っぽの目（ゆらゆら揺れる）
  const sway = Math.sin(age * 2.5) * 1.6;
  ctx.strokeStyle = "#e8c98f";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(13, -1);
  ctx.lineTo(16 + sway, -8);
  ctx.moveTo(10, -2);
  ctx.lineTo(11 + sway * 0.7, -9);
  ctx.stroke();
  ctx.fillStyle = "#1c1208";
  ctx.beginPath();
  ctx.arc(16 + sway, -8, 1.4, 0, Math.PI * 2);
  ctx.arc(11 + sway * 0.7, -9, 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その2：蛇（横に動く敵）。(cx, cy) が中心。
// -------------------------------------------------------------------
function drawSnake(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // うねうね動き：S字のふくらみが波打つ
  const w = Math.sin(age * 6) * 2.5;
  const headBob = Math.sin(age * 6 + 1) * 1.5;

  // くねった胴体（S字）
  ctx.strokeStyle = "#5fb84a";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-13, 11);
  ctx.quadraticCurveTo(3 + w, 7, -3, -1);
  ctx.quadraticCurveTo(-8 - w, -8, 7, -12 + headBob);
  ctx.stroke();
  // 背中の模様
  ctx.strokeStyle = "#3e8a30";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-9, 10);
  ctx.lineTo(-6, 9);
  ctx.moveTo(-1, 3);
  ctx.lineTo(2, 4);
  ctx.moveTo(-2, -6);
  ctx.lineTo(1, -5);
  ctx.stroke();

  // 頭（胴体と一緒に上下する）
  ctx.fillStyle = "#6cc456";
  ctx.beginPath();
  ctx.ellipse(8, -13 + headBob, 6.5, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // 目
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(10, -15 + headBob, 1.3, 0, Math.PI * 2);
  ctx.fill();
  // 舌（赤いちょろ）：チロチロ出し入れする
  const tongueOut = Math.max(0, Math.sin(age * 7)); // 0〜1
  if (tongueOut > 0.25) {
    const tl = tongueOut * 4; // 伸びる長さ
    ctx.strokeStyle = "#e0506a";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(13, -14 + headBob);
    ctx.lineTo(15 + tl, -15 + headBob);
    ctx.moveTo(15 + tl, -15 + headBob);
    ctx.lineTo(17 + tl, -16.5 + headBob);
    ctx.moveTo(15 + tl, -15 + headBob);
    ctx.lineTo(17 + tl, -13.5 + headBob);
    ctx.stroke();
  }

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その3：蜘蛛（縦に動く敵）。(cx, cy) が中心。上に糸が伸びる。
// -------------------------------------------------------------------
function drawSpider(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // 糸でゆらゆら：体全体が少し左右に揺れる（糸の根元は固定）
  const swing = Math.sin(age * 3) * 2.5;

  // 上に伸びる糸（根元はまっすぐ、体の方が揺れる）
  ctx.strokeStyle = "rgba(210, 210, 220, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -42);
  ctx.lineTo(swing, -13);
  ctx.stroke();

  // 以降の体は揺れに合わせて横へずらす
  ctx.translate(swing, 0);

  // 8本の脚（左右4本ずつ、ひざで折れる）。ワサワサ動く
  ctx.strokeStyle = "#2b2b33";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const ly = -6 + i * 4.5;
      const wig = Math.sin(age * 11 + i * 0.9 + (side > 0 ? Math.PI : 0)) * 2.2;
      ctx.beginPath();
      ctx.moveTo(side * 4, ly);
      ctx.lineTo(side * 11, ly - 3 + wig);
      ctx.lineTo(side * 16, ly + 4 - wig);
      ctx.stroke();
    }
  }

  // おしり（大きい胴）
  ctx.fillStyle = "#3a3a44";
  ctx.beginPath();
  ctx.ellipse(0, 5, 8, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // 頭胸部
  ctx.fillStyle = "#2b2b33";
  ctx.beginPath();
  ctx.arc(0, -5, 6, 0, Math.PI * 2);
  ctx.fill();
  // 背中の赤い砂時計模様
  ctx.fillStyle = "#d2453f";
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.lineTo(-3, 1);
  ctx.lineTo(3, 1);
  ctx.closePath();
  ctx.moveTo(0, 4);
  ctx.lineTo(-3, 8);
  ctx.lineTo(3, 8);
  ctx.closePath();
  ctx.fill();
  // 目（白い点）
  ctx.fillStyle = "#e8e8e8";
  ctx.beginPath();
  ctx.arc(-2, -6, 1, 0, Math.PI * 2);
  ctx.arc(2, -6, 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その4：鷲（ふらふら動く敵）。(cx, cy) が中心。下（自機の方）を向く。
//   age に応じて翼を羽ばたかせる。
// -------------------------------------------------------------------
function drawEagle(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const flap = Math.sin(age * 11) * 5; // 翼の上下の羽ばたき

  // --- 翼（左右に大きく広げる。先ほど羽ばたく）---
  const BODY = "#7a5230"; // 体のこげ茶
  const WING = "#5e3f24"; // 翼の濃い茶
  for (const side of [-1, 1]) {
    ctx.fillStyle = WING;
    ctx.beginPath();
    ctx.moveTo(side * 4, -2);
    ctx.quadraticCurveTo(side * 18, -8 - flap, side * 26, 2 - flap);
    ctx.quadraticCurveTo(side * 16, 2, side * 5, 6);
    ctx.closePath();
    ctx.fill();
    // 風切羽の筋
    ctx.strokeStyle = "#3f2a18";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(side * 10, 0 - flap * 0.5);
    ctx.lineTo(side * 22, 1 - flap);
    ctx.stroke();
  }

  // --- 尾羽（上＝後ろ）---
  ctx.fillStyle = WING;
  ctx.beginPath();
  ctx.moveTo(-5, -6);
  ctx.lineTo(5, -6);
  ctx.lineTo(0, -16);
  ctx.closePath();
  ctx.fill();

  // --- 胴体 ---
  ctx.fillStyle = BODY;
  ctx.beginPath();
  ctx.ellipse(0, 1, 6, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- 頭（白い・下向き＝自機の方）---
  ctx.fillStyle = "#f0ece2";
  ctx.beginPath();
  ctx.arc(0, 10, 5, 0, Math.PI * 2);
  ctx.fill();
  // くちばし（黄色・下を向く）
  ctx.fillStyle = "#f2b134";
  ctx.beginPath();
  ctx.moveTo(-2.5, 13);
  ctx.lineTo(2.5, 13);
  ctx.lineTo(0, 19);
  ctx.closePath();
  ctx.fill();
  // 目（鋭い黒目）
  ctx.fillStyle = "#1c1208";
  ctx.beginPath();
  ctx.arc(-2.2, 9, 1.1, 0, Math.PI * 2);
  ctx.arc(2.2, 9, 1.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その5：黄金の豚（レア）。(cx, cy) が中心。age できらめく。
// -------------------------------------------------------------------
function drawGoldPig(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const GOLD = "#f4c63a"; // 金色
  const GOLD_DARK = "#c8961a"; // 影の金色
  const GOLD_LIGHT = "#ffe98a"; // ハイライト

  // ほんのり光るオーラ（レア感）
  const pulse = 0.5 + 0.5 * Math.sin(age * 6);
  ctx.save();
  ctx.globalAlpha = 0.18 + pulse * 0.18;
  ctx.fillStyle = "#fff0a0";
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 耳
  ctx.fillStyle = GOLD_DARK;
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(-5, -16);
  ctx.lineTo(-4, -7);
  ctx.closePath();
  ctx.moveTo(12, -10);
  ctx.lineTo(5, -16);
  ctx.lineTo(4, -7);
  ctx.closePath();
  ctx.fill();

  // 足
  ctx.fillStyle = GOLD_DARK;
  ctx.fillRect(-9, 9, 5, 6);
  ctx.fillRect(4, 9, 5, 6);

  // 体（まるい胴）
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  // 上のハイライト
  ctx.fillStyle = GOLD_LIGHT;
  ctx.beginPath();
  ctx.ellipse(-4, -5, 7, 4, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // 鼻（ブタの口）
  ctx.fillStyle = GOLD_DARK;
  ctx.beginPath();
  ctx.ellipse(0, 4, 6, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7a5a10";
  ctx.beginPath();
  ctx.arc(-2, 4, 1, 0, Math.PI * 2);
  ctx.arc(2, 4, 1, 0, Math.PI * 2);
  ctx.fill();

  // 目
  ctx.fillStyle = "#1c1208";
  ctx.beginPath();
  ctx.arc(-5, -3, 1.6, 0, Math.PI * 2);
  ctx.arc(5, -3, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // くるんとしたしっぽ
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(17, 2, 3, Math.PI, Math.PI * 2.6);
  ctx.stroke();

  // きらめき（チカッと光る）
  if (pulse > 0.7) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-9, -9, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その6：クラゲ（ステージ3）。(cx, cy) が中心。age でかさが脈打ち、触手が揺れる。
// -------------------------------------------------------------------
function drawJellyfish(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const squash = Math.sin(age * 3) * 0.12; // かさがふわふわ伸び縮み

  // 触手（下に揺れる細いひも）
  ctx.strokeStyle = "rgba(255, 158, 216, 0.85)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i++) {
    const tx = i * 4;
    const wave = Math.sin(age * 4 + i) * 3;
    ctx.beginPath();
    ctx.moveTo(tx, 2);
    ctx.quadraticCurveTo(tx + wave, 10, tx + wave * 0.6, 18);
    ctx.stroke();
  }

  // かさ（半円のドーム）
  ctx.fillStyle = "#f7b6e0";
  ctx.beginPath();
  ctx.ellipse(0, 0, 13 * (1 + squash), 11 * (1 - squash), 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // かさのフチ
  ctx.fillStyle = "#e87cc0";
  ctx.fillRect(-13 * (1 + squash), -1, 26 * (1 + squash), 3);
  // かさの中の模様（うすい点々）
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  ctx.arc(-4, -4, 1.6, 0, Math.PI * 2);
  ctx.arc(4, -4, 1.6, 0, Math.PI * 2);
  ctx.arc(0, -6, 1.6, 0, Math.PI * 2);
  ctx.fill();
  // 目（つぶらな黒目）
  ctx.fillStyle = "#3a1530";
  ctx.beginPath();
  ctx.arc(-3, -2, 1.4, 0, Math.PI * 2);
  ctx.arc(3, -2, 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その7：マグロ（ステージ3）。(cx, cy) が中心。まっすぐ下りる。age で尾びれを振る。
// -------------------------------------------------------------------
function drawTuna(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const tail = Math.sin(age * 18) * 4; // 高速で泳ぐので尾びれを速く振る
  const BODY = "#5b7f9e"; // 背の青銀
  const BELLY = "#cdd9e2"; // 腹の白銀

  // 体は進行方向（下）を向く縦長の紡錘形
  // 尾びれ（上＝後ろ）
  ctx.fillStyle = "#3f5f78";
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(-7, -20 + tail);
  ctx.lineTo(7, -20 - tail);
  ctx.closePath();
  ctx.fill();

  // 胴体
  ctx.fillStyle = BODY;
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  // 腹（明るい下側）
  ctx.fillStyle = BELLY;
  ctx.beginPath();
  ctx.ellipse(0, 4, 5, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // 胸びれ（左右）
  ctx.fillStyle = "#3f5f78";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 6, 0);
    ctx.lineTo(side * 13, 4);
    ctx.lineTo(side * 6, 6);
    ctx.closePath();
    ctx.fill();
  }

  // 目（先頭＝下のほう）
  ctx.fillStyle = "#10202c";
  ctx.beginPath();
  ctx.arc(-3, 9, 1.5, 0, Math.PI * 2);
  ctx.arc(3, 9, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その8：イカ（ステージ3）。(cx, cy) が中心。age で足がうねうね動く。
// -------------------------------------------------------------------
function drawSquid(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const BODY = "#c77dd6"; // むらさき
  const BODY_DARK = "#9a52ab";

  // 足（下に伸びる10本のうち代表5本。うねうね動く）
  ctx.strokeStyle = BODY_DARK;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i++) {
    const lx = i * 3.5;
    const wave = Math.sin(age * 7 + i * 0.8) * 4;
    ctx.beginPath();
    ctx.moveTo(lx, 4);
    ctx.quadraticCurveTo(lx + wave, 12, lx + wave * 0.5, 19);
    ctx.stroke();
  }

  // 頭（とがった三角の胴＝下向き）
  ctx.fillStyle = BODY;
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(-9, 6);
  ctx.lineTo(9, 6);
  ctx.closePath();
  ctx.fill();
  // エンペラ（左右のひれ）
  ctx.fillStyle = BODY_DARK;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 7, -10);
    ctx.lineTo(side * 13, -4);
    ctx.lineTo(side * 6, 0);
    ctx.closePath();
    ctx.fill();
  }

  // 大きな目（イカらしいクリッとした目）
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(-4, 0, 3, 0, Math.PI * 2);
  ctx.arc(4, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a0a20";
  ctx.beginPath();
  ctx.arc(-4, 1, 1.5, 0, Math.PI * 2);
  ctx.arc(4, 1, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// お助けキャラ：エンジェル（ステージ2）。(cx, cy) が中心。age で羽ばたき＋きらめき。
//   触れると残機(ハート)が1増える。倒す相手ではない。
// -------------------------------------------------------------------
function drawAngel(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const flap = Math.sin(age * 9) * 4; // 翼の羽ばたき
  const pulse = 0.5 + 0.5 * Math.sin(age * 5);

  // やわらかい光のオーラ（神々しさ）
  ctx.save();
  ctx.globalAlpha = 0.15 + pulse * 0.12;
  ctx.fillStyle = "#fff6c0";
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 翼（左右の白い羽。羽ばたく）
  ctx.fillStyle = "#ffffff";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 5, -2);
    ctx.quadraticCurveTo(side * 20, -10 - flap, side * 24, 2 - flap);
    ctx.quadraticCurveTo(side * 16, 2, side * 6, 6);
    ctx.closePath();
    ctx.fill();
  }

  // 体（白いローブ）
  ctx.fillStyle = "#fdfdff";
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(-7, 12);
  ctx.lineTo(7, 12);
  ctx.closePath();
  ctx.fill();

  // 頭（肌色の丸）
  ctx.fillStyle = "#ffe0c2";
  ctx.beginPath();
  ctx.arc(0, -8, 6, 0, Math.PI * 2);
  ctx.fill();
  // 目（にっこり）
  ctx.fillStyle = "#5a4636";
  ctx.beginPath();
  ctx.arc(-2.3, -8, 1, 0, Math.PI * 2);
  ctx.arc(2.3, -8, 1, 0, Math.PI * 2);
  ctx.fill();
  // ほっぺ
  ctx.fillStyle = "rgba(255, 150, 150, 0.5)";
  ctx.beginPath();
  ctx.arc(-3.5, -6, 1.4, 0, Math.PI * 2);
  ctx.arc(3.5, -6, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // 天使の輪（頭の上で光る）
  ctx.strokeStyle = "#ffe14d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -16, 5, 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 小さなハートマーク（胸元・お助け感）
  ctx.fillStyle = "#ff6b8a";
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-3, 0, -5, 4, 0, 8);
  ctx.bezierCurveTo(5, 4, 3, 0, 0, 4);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その9：つらら／氷の塊（ステージ4）。(cx, cy) が中心。先端は下向き。
// -------------------------------------------------------------------
function drawTsurara(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const shimmer = 0.5 + 0.5 * Math.sin(age * 6); // きらめき

  // 本体（下にとがった氷の柱）
  ctx.fillStyle = "#bfe8ff";
  ctx.beginPath();
  ctx.moveTo(-7, -14);
  ctx.lineTo(7, -14);
  ctx.lineTo(2, 6);
  ctx.lineTo(0, 16); // とがった先端
  ctx.lineTo(-2, 6);
  ctx.closePath();
  ctx.fill();
  // 内側の明るい芯
  ctx.fillStyle = "#eaf7ff";
  ctx.beginPath();
  ctx.moveTo(-3, -12);
  ctx.lineTo(2, -12);
  ctx.lineTo(0, 8);
  ctx.closePath();
  ctx.fill();
  // ふちの濃い水色
  ctx.strokeStyle = "#7fc4ec";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-7, -14);
  ctx.lineTo(0, 16);
  ctx.lineTo(7, -14);
  ctx.stroke();
  // きらり（白い光点）
  ctx.fillStyle = `rgba(255,255,255,${0.4 + shimmer * 0.5})`;
  ctx.beginPath();
  ctx.arc(-2, -6, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その10：ペンギン（ステージ4）。(cx, cy) が中心。age で羽と体が揺れる。
// -------------------------------------------------------------------
function drawPenguin(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const waddle = Math.sin(age * 5) * 3; // よちよち左右に傾く
  const flap = Math.sin(age * 8) * 3; // 羽ばたき
  ctx.rotate((waddle * Math.PI) / 180);

  // 体（黒い背中）
  ctx.fillStyle = "#2b3442";
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  // おなか（白）
  ctx.fillStyle = "#f4fbff";
  ctx.beginPath();
  ctx.ellipse(0, 2, 7, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // 羽（左右・羽ばたく）
  ctx.fillStyle = "#222a36";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 9, -4);
    ctx.quadraticCurveTo(side * 16, 2 + flap, side * 9, 10);
    ctx.closePath();
    ctx.fill();
  }

  // 足（オレンジ）
  ctx.fillStyle = "#ff9f3a";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 4, 15, 4, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // くちばし（オレンジの三角・下向き）
  ctx.fillStyle = "#ff9f3a";
  ctx.beginPath();
  ctx.moveTo(-3, -7);
  ctx.lineTo(3, -7);
  ctx.lineTo(0, -2);
  ctx.closePath();
  ctx.fill();

  // 目
  ctx.fillStyle = "#10151c";
  ctx.beginPath();
  ctx.arc(-3.5, -9, 1.6, 0, Math.PI * 2);
  ctx.arc(3.5, -9, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その11：シロクマ（ステージ4）。(cx, cy) が中心。age で歩く揺れ。硬い。
// -------------------------------------------------------------------
function drawPolarBear(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const sway = Math.sin(age * 4); // のっそり歩く揺れ
  const FUR = "#eef5fb";
  const FUR_SHADOW = "#cdddec";

  // 手足（4本・のっそり）
  ctx.fillStyle = FUR_SHADOW;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 10, 12 + sway * side * 2, 5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 体（大きな白い丸）
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.ellipse(0, 2, 16, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  // 頭
  ctx.beginPath();
  ctx.ellipse(0, -13, 11, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // 耳
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.arc(-8, -20, 3.5, 0, Math.PI * 2);
  ctx.arc(8, -20, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FUR_SHADOW;
  ctx.beginPath();
  ctx.arc(-8, -20, 1.8, 0, Math.PI * 2);
  ctx.arc(8, -20, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // 鼻先（少し前に出た口元）
  ctx.fillStyle = "#e3eef7";
  ctx.beginPath();
  ctx.ellipse(0, -9, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 鼻
  ctx.fillStyle = "#2a2f38";
  ctx.beginPath();
  ctx.arc(0, -10, 2, 0, Math.PI * 2);
  ctx.fill();
  // 目
  ctx.beginPath();
  ctx.arc(-4.5, -15, 1.6, 0, Math.PI * 2);
  ctx.arc(4.5, -15, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その12：雪だるま（ステージ4）。(cx, cy) が中心。age でわずかに揺れる。
// -------------------------------------------------------------------
function drawSnowman(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  const tilt = Math.sin(age * 2.5) * 2; // ゆらゆら
  ctx.rotate((tilt * Math.PI) / 180);

  // 下の玉（大）
  ctx.fillStyle = "#f6fbff";
  ctx.beginPath();
  ctx.arc(0, 8, 12, 0, Math.PI * 2);
  ctx.fill();
  // 上の玉（小＝頭）
  ctx.beginPath();
  ctx.arc(0, -8, 8.5, 0, Math.PI * 2);
  ctx.fill();
  // 影でまるみを出す
  ctx.fillStyle = "rgba(180, 205, 228, 0.5)";
  ctx.beginPath();
  ctx.arc(4, 10, 5, 0, Math.PI * 2);
  ctx.fill();

  // 腕（枝）
  ctx.strokeStyle = "#7a5230";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 8, 2);
    ctx.lineTo(side * 16, -3);
    ctx.moveTo(side * 12, -0.5);
    ctx.lineTo(side * 15, 2);
    ctx.stroke();
  }

  // ボタン（炭）
  ctx.fillStyle = "#33373f";
  ctx.beginPath();
  ctx.arc(0, 5, 1.4, 0, Math.PI * 2);
  ctx.arc(0, 10, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // 鼻（にんじん）
  ctx.fillStyle = "#ff8a2a";
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(7, -6.5);
  ctx.lineTo(0, -5);
  ctx.closePath();
  ctx.fill();
  // 目
  ctx.fillStyle = "#33373f";
  ctx.beginPath();
  ctx.arc(-3, -10, 1.3, 0, Math.PI * 2);
  ctx.arc(3, -10, 1.3, 0, Math.PI * 2);
  ctx.fill();

  // バケツの帽子
  ctx.fillStyle = "#7f8a96";
  ctx.fillRect(-6, -20, 12, 6);
  ctx.fillRect(-7.5, -15, 15, 2.5);

  ctx.restore();
}

// 敵：UFO（ステージ5）。銀色の円盤＋光るドーム＋点滅するライト
function drawUfo(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // 下に伸びる吸引ビーム（ほんのり光る）
  ctx.save();
  ctx.globalAlpha = 0.18 + Math.sin(age * 4) * 0.06;
  ctx.fillStyle = "#8ce6ff";
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(6, 4);
  ctx.lineTo(13, 20);
  ctx.lineTo(-13, 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 円盤の本体（横長の楕円）
  ctx.fillStyle = "#9aa7bd";
  ctx.beginPath();
  ctx.ellipse(0, 2, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // 円盤のふち（濃いめ）
  ctx.fillStyle = "#5e6b82";
  ctx.beginPath();
  ctx.ellipse(0, 4.5, 16, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // 上のドーム（ガラス）
  ctx.fillStyle = "#bfeaff";
  ctx.beginPath();
  ctx.arc(0, 0, 8, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(-2.5, -2, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // 底の点滅ライト（3つ・順番に光る）
  for (let i = -1; i <= 1; i++) {
    const on = Math.floor(age * 6 + i + 1) % 3 === 0;
    ctx.fillStyle = on ? "#fff36b" : "#c46cff";
    ctx.beginPath();
    ctx.arc(i * 8, 5.5, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// 敵：隕石（ステージ5）。燃える岩。後ろ（上）に炎の尾を引く
function drawMeteor(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // 炎の尾（上へ伸びる。ちらちら揺れる）
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const flick = 1 + Math.sin(age * 20) * 0.15;
  const grad = ctx.createLinearGradient(0, -34 * flick, 0, 0);
  grad.addColorStop(0, "rgba(255,180,80,0)");
  grad.addColorStop(0.5, "rgba(255,140,40,0.5)");
  grad.addColorStop(1, "rgba(255,230,150,0.9)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-7, -2);
  ctx.lineTo(0, -34 * flick);
  ctx.lineTo(7, -2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 岩の本体（ごつごつした多角形）
  ctx.fillStyle = "#6b4a3a";
  ctx.beginPath();
  ctx.moveTo(-11, 0);
  ctx.lineTo(-6, -9);
  ctx.lineTo(5, -10);
  ctx.lineTo(11, -2);
  ctx.lineTo(8, 9);
  ctx.lineTo(-4, 11);
  ctx.closePath();
  ctx.fill();
  // 明るい当たり面（進行方向＝下側を熱で光らせる）
  ctx.fillStyle = "#a85a2a";
  ctx.beginPath();
  ctx.moveTo(-4, 11);
  ctx.lineTo(8, 9);
  ctx.lineTo(4, 3);
  ctx.lineTo(-2, 4);
  ctx.closePath();
  ctx.fill();
  // クレーター（くぼみ）
  ctx.fillStyle = "#4d352a";
  ctx.beginPath();
  ctx.arc(-3, -3, 2.4, 0, Math.PI * 2);
  ctx.arc(4, -1, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// 敵：エイリアン（ステージ5）。緑の小さな宇宙人。大きな黒い目＋触角
function drawAlien(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  const wob = Math.sin(age * 4) * 1.5; // ふわふわ揺れる

  // 触角（先に光る玉）
  ctx.strokeStyle = "#5fbf4a";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 3, -10);
    ctx.quadraticCurveTo(side * 6, -18, side * 4 + wob, -22);
    ctx.stroke();
    ctx.fillStyle = "#bfff6b";
    ctx.beginPath();
    ctx.arc(side * 4 + wob, -22, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 体（小さめ・緑）
  ctx.fillStyle = "#79d65f";
  ctx.beginPath();
  ctx.ellipse(0, 8, 7, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // 細い腕
  ctx.strokeStyle = "#5fbf4a";
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 5, 5);
    ctx.lineTo(side * 11, 10 + wob);
    ctx.stroke();
  }

  // 頭（大きい・緑）
  ctx.fillStyle = "#8fe06f";
  ctx.beginPath();
  ctx.ellipse(0, -4, 11, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // 大きな黒いアーモンド型の目
  ctx.fillStyle = "#1b2530";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 4.5, -4, 3, 4.5, side * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 目のハイライト
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * 5, -6, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// 敵：衛星ロボ（ステージ5）。金属の箱＋ソーラーパネルの翼＋点滅する赤い目。倒すと爆発
function drawSatellite(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(age * 1.5) * 0.15); // ゆっくり傾く

  // ソーラーパネルの翼（左右）
  ctx.fillStyle = "#27538a";
  ctx.strokeStyle = "#6f9fd6";
  ctx.lineWidth = 0.8;
  for (const side of [-1, 1]) {
    ctx.fillRect(side * 9, -5, side * 9, 10);
    // パネルの格子
    ctx.beginPath();
    ctx.moveTo(side * 13, -5);
    ctx.lineTo(side * 13, 5);
    ctx.moveTo(side * 9, 0);
    ctx.lineTo(side * 18, 0);
    ctx.stroke();
  }

  // 本体（金属の箱）
  ctx.fillStyle = "#aeb8c8";
  ctx.fillRect(-8, -8, 16, 16);
  ctx.fillStyle = "#7e8a9e";
  ctx.fillRect(-8, 3, 16, 5); // 下の影
  // ふち
  ctx.strokeStyle = "#4d566a";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-8, -8, 16, 16);

  // 点滅する赤い目（カメラ）
  const blink = Math.floor(age * 5) % 2 === 0;
  ctx.fillStyle = blink ? "#ff5b5b" : "#7a2a2a";
  ctx.beginPath();
  ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.arc(-1, -1, 1, 0, Math.PI * 2);
  ctx.fill();

  // 上のアンテナ
  ctx.strokeStyle = "#cfd6e2";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(0, -14);
  ctx.stroke();
  ctx.fillStyle = "#ffd36b";
  ctx.beginPath();
  ctx.arc(0, -15, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// 敵：小型メカゴリラ（ステージ5・お供）。ラスボスが射出する銀色の小さいメカゴリラ
function drawMinionGorilla(cx: number, cy: number, age: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  const sway = Math.sin(age * 6) * 1.2; // 手足を小刻みに動かす

  // 腕（左右・銀）
  ctx.fillStyle = "#8f9aae";
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 11, 0);
    ctx.rotate(side * sway * 0.1);
    ctx.fillRect(-3, -3, 6, 12);
    // こぶし
    ctx.beginPath();
    ctx.arc(0, 10, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 胴体（銀の箱・丸み）
  ctx.fillStyle = "#b9c2d6";
  ctx.beginPath();
  ctx.roundRect(-9, -6, 18, 16, 4);
  ctx.fill();
  // 胸のコア（青く光る）
  ctx.fillStyle = "#5cd6ff";
  ctx.beginPath();
  ctx.arc(0, 2, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // 頭（メカゴリラ顔・光るバイザーの目）
  ctx.fillStyle = "#9aa7bd";
  ctx.beginPath();
  ctx.roundRect(-7, -15, 14, 11, 3);
  ctx.fill();
  // バイザー（横長に光る赤い目）
  ctx.fillStyle = "#1b2430";
  ctx.fillRect(-5.5, -12, 11, 4);
  ctx.fillStyle = "#ff6b6b";
  ctx.fillRect(-4.5, -11, 9, 2);

  // 足（左右・小刻みに動く）
  ctx.fillStyle = "#8f9aae";
  for (const side of [-1, 1]) {
    ctx.fillRect(side * 5 - 2.5, 9, 5, 6 + side * sway);
  }

  ctx.restore();
}

// 敵を種類に応じた姿で描く
function drawEnemy(e: Enemy): void {
  // 下から上る敵（dir<0）は絵を上下に反転して進行方向（上）を向かせる。
  // ただしクラゲ・イカ・ペンギン・シロクマ・雪だるま・エイリアン・衛星ロボ・UFOは
  // 上向きでも不自然なので反転しない（つらら・隕石は反転して進行方向＝上を向くと自然）。
  const flip =
    e.dir < 0 &&
    e.kind !== "jellyfish" &&
    e.kind !== "squid" &&
    e.kind !== "penguin" &&
    e.kind !== "shirokuma" &&
    e.kind !== "yukidaruma" &&
    e.kind !== "alien" &&
    e.kind !== "satellite" &&
    e.kind !== "ufo";
  if (flip) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(1, -1);
  }
  const cx = flip ? 0 : e.x;
  const cy = flip ? 0 : e.y;
  if (e.kind === "snail") drawSnail(cx, cy, e.age);
  else if (e.kind === "snake") drawSnake(cx, cy, e.age);
  else if (e.kind === "spider") drawSpider(cx, cy, e.age);
  else if (e.kind === "eagle") drawEagle(cx, cy, e.age);
  else if (e.kind === "jellyfish") drawJellyfish(cx, cy, e.age);
  else if (e.kind === "tuna") drawTuna(cx, cy, e.age);
  else if (e.kind === "squid") drawSquid(cx, cy, e.age);
  else if (e.kind === "angel") drawAngel(cx, cy, e.age);
  else if (e.kind === "tsurara") drawTsurara(cx, cy, e.age);
  else if (e.kind === "penguin") drawPenguin(cx, cy, e.age);
  else if (e.kind === "shirokuma") drawPolarBear(cx, cy, e.age);
  else if (e.kind === "yukidaruma") drawSnowman(cx, cy, e.age);
  else if (e.kind === "ufo") drawUfo(cx, cy, e.age);
  else if (e.kind === "meteor") drawMeteor(cx, cy, e.age);
  else if (e.kind === "alien") drawAlien(cx, cy, e.age);
  else if (e.kind === "satellite") drawSatellite(cx, cy, e.age);
  else if (e.kind === "minionGorilla") drawMinionGorilla(cx, cy, e.age);
  else drawGoldPig(cx, cy, e.age);
  if (flip) ctx.restore();
}

// ボム補充アイテム（黄金の豚が落とす）の姿。(cx, cy) が中心。
function drawBombItem(cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  // 本体（黒い玉）
  ctx.fillStyle = "#2b2f3a";
  ctx.beginPath();
  ctx.arc(0, 2, 8, 0, Math.PI * 2);
  ctx.fill();
  // ハイライト
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(-3, -1, 2.2, 0, Math.PI * 2);
  ctx.fill();
  // 導火線
  ctx.strokeStyle = "#9a7b3a";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(3, -5);
  ctx.quadraticCurveTo(8, -9, 6, -12);
  ctx.stroke();
  // 火花
  ctx.fillStyle = "#ffb648";
  ctx.beginPath();
  ctx.arc(6, -13, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff0a0";
  ctx.beginPath();
  ctx.arc(6, -13, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// -------------------------------------------------------------------
// ボス：ゴリラ。(cx, cy) が中心。walk が大きいほど腕と足が振れる。
// -------------------------------------------------------------------
function drawGorillaBoss(cx: number, cy: number, walk: number, enraged = false): void {
  ctx.save();
  ctx.translate(cx, cy);

  const swing = Math.sin(walk); // -1〜+1：腕と足の振り
  const bob = Math.sin(walk * 2) * 2; // 上下に小さく弾む

  // 怒りモードでは赤いオーラをまとう（ドクンと脈打つ）
  if (enraged) {
    const pulse = 0.5 + 0.5 * Math.sin(walk * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.25;
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 40 + pulse * 5, 46 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.translate(0, bob);

  const FUR = "#4a4a55"; // 体毛（明るめ）
  const FUR_DARK = "#34343d"; // 体毛（暗め）
  const SKIN = "#211f26"; // 顔・手足の肌

  // --- 足（左右で逆に踏み出す）---
  ctx.strokeStyle = FUR_DARK;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-11, 16);
  ctx.lineTo(-13 + swing * 6, 34);
  ctx.moveTo(11, 16);
  ctx.lineTo(13 - swing * 6, 34);
  ctx.stroke();
  // 足の甲
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(-15 + swing * 6, 36, 8, 4.5, 0, 0, Math.PI * 2);
  ctx.ellipse(15 - swing * 6, 36, 8, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- 腕（足と逆向きに振る。長くてナックル歩き）---
  ctx.strokeStyle = FUR;
  ctx.lineWidth = 15;
  ctx.beginPath();
  ctx.moveTo(-18, -12);
  ctx.lineTo(-30 - swing * 6, 20);
  ctx.moveTo(18, -12);
  ctx.lineTo(30 + swing * 6, 20);
  ctx.stroke();
  // こぶし
  ctx.fillStyle = FUR_DARK;
  ctx.beginPath();
  ctx.arc(-30 - swing * 6, 23, 9, 0, Math.PI * 2);
  ctx.arc(30 + swing * 6, 23, 9, 0, Math.PI * 2);
  ctx.fill();

  // --- 胴体 ---
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.ellipse(0, 2, 22, 25, 0, 0, Math.PI * 2);
  ctx.fill();
  // 明るいおなか
  ctx.fillStyle = "#5d5d6a";
  ctx.beginPath();
  ctx.ellipse(0, 6, 13, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- 頭 ---
  // 耳
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.arc(-17, -25, 5, 0, Math.PI * 2);
  ctx.arc(17, -25, 5, 0, Math.PI * 2);
  ctx.fill();
  // 頭本体
  ctx.beginPath();
  ctx.ellipse(0, -24, 18, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  // 顔（肌）
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(0, -20, 12, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  // 出っぱった眉
  ctx.fillStyle = "#15131a";
  ctx.beginPath();
  ctx.ellipse(0, -27, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // 目（怒り時は赤く光る）
  ctx.fillStyle = enraged ? "#ff3b3b" : "#f3d44a";
  ctx.beginPath();
  ctx.arc(-5, -24, 2.4, 0, Math.PI * 2);
  ctx.arc(5, -24, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#15131a";
  ctx.beginPath();
  ctx.arc(-5, -24, 1.1, 0, Math.PI * 2);
  ctx.arc(5, -24, 1.1, 0, Math.PI * 2);
  ctx.fill();
  // 鼻の穴
  ctx.beginPath();
  ctx.arc(-3, -15, 1.3, 0, Math.PI * 2);
  ctx.arc(3, -15, 1.3, 0, Math.PI * 2);
  ctx.fill();
  // 口（への字）
  ctx.strokeStyle = "#15131a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-5, -10);
  ctx.quadraticCurveTo(0, -8, 5, -10);
  ctx.stroke();

  ctx.restore();
}

// -------------------------------------------------------------------
// ボス：機械のゴリラ（ステージ2）。(cx, cy) が中心。
//   walk が大きいほど腕と足が動く。enraged=true で目とコアが赤く光る。
// -------------------------------------------------------------------
function drawMachineGorillaBoss(cx: number, cy: number, walk: number, enraged = false): void {
  ctx.save();
  ctx.translate(cx, cy);

  const swing = Math.sin(walk);
  const bob = Math.sin(walk * 2) * 1.5;
  const glow = enraged ? "#ff4040" : "#5cd6ff"; // 光る部分の色

  // 怒りモードでは赤いオーラが脈打つ
  if (enraged) {
    const pulse = 0.5 + 0.5 * Math.sin(walk * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.22 + pulse * 0.22;
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 42 + pulse * 5, 48 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.translate(0, bob);

  const METAL = "#8a93a3"; // 金属の明るい灰
  const METAL_DARK = "#525a68"; // 金属の暗い灰
  const JOINT = "#2e333d"; // 関節・すきまの黒っぽい色

  // --- 足（角ばった脚。左右で逆に踏み出す）---
  ctx.fillStyle = METAL_DARK;
  for (const side of [-1, 1]) {
    const sx = side * 11;
    const step = side === -1 ? swing * 6 : -swing * 6;
    ctx.fillRect(sx - 7, 14, 14, 16);
    ctx.fillStyle = JOINT;
    ctx.fillRect(sx - 9 + step, 30, 18, 6); // 足の甲
    ctx.fillStyle = METAL_DARK;
  }

  // --- 腕（長く太い、ゴリラのように下へ伸びる腕。足と逆に振る。先端は砲口）---
  for (const side of [-1, 1]) {
    const sw = side * swing * 6;
    const sx = side * 26; // ひじ〜こぶしの外側位置
    // 太い腕（厚い線で描く）
    ctx.strokeStyle = METAL;
    ctx.lineWidth = 16;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(side * 16, -12);
    ctx.lineTo(sx, 26 + sw);
    ctx.stroke();
    // 肩の関節
    ctx.fillStyle = JOINT;
    ctx.beginPath();
    ctx.arc(side * 16, -12, 7, 0, Math.PI * 2);
    ctx.fill();
    // こぶし（砲口）
    ctx.fillStyle = METAL_DARK;
    ctx.beginPath();
    ctx.arc(sx, 30 + sw, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, 30 + sw, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 胴体（角ばった装甲）---
  ctx.fillStyle = METAL;
  ctx.fillRect(-20, -16, 40, 38);
  // 装甲のフチ
  ctx.strokeStyle = JOINT;
  ctx.lineWidth = 2;
  ctx.strokeRect(-20, -16, 40, 38);
  // パネルの線
  ctx.beginPath();
  ctx.moveTo(-20, -2);
  ctx.lineTo(20, -2);
  ctx.stroke();
  // 胸の動力コア（光る丸）
  const corePulse = 0.6 + 0.4 * Math.sin(walk * 3);
  ctx.fillStyle = glow;
  ctx.globalAlpha = 0.5 + corePulse * 0.5;
  ctx.beginPath();
  ctx.arc(0, 6, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 6, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // --- 頭（金属のヘルメット）---
  ctx.fillStyle = METAL;
  ctx.fillRect(-14, -40, 28, 22);
  ctx.strokeStyle = JOINT;
  ctx.strokeRect(-14, -40, 28, 22);
  // 耳のような側面パーツ
  ctx.fillStyle = METAL_DARK;
  ctx.fillRect(-18, -34, 4, 10);
  ctx.fillRect(14, -34, 4, 10);
  // バイザー（横長の光る目）
  ctx.fillStyle = "#15171c";
  ctx.fillRect(-11, -33, 22, 8);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(-5, -29, 2.4, 0, Math.PI * 2);
  ctx.arc(5, -29, 2.4, 0, Math.PI * 2);
  ctx.fill();
  // アンテナ
  ctx.strokeStyle = METAL_DARK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.lineTo(0, -48);
  ctx.stroke();
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -49, 2, 0, Math.PI * 2);
  ctx.fill();
  // 口元のグリル（への字）
  ctx.strokeStyle = JOINT;
  ctx.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 5 - 2, -22);
    ctx.lineTo(i * 5 - 2, -19);
    ctx.stroke();
  }

  ctx.restore();
}

// -------------------------------------------------------------------
// ボス：酸素ボンベのゴリラ（ステージ3）。(cx, cy) が中心。
//   ゴリラ＋ダイビング装備（酸素ボンベ・水中マスク・足ひれ）。
//   walk が大きいほど腕足が振れる。enraged=true で目とオーラが赤い。
// -------------------------------------------------------------------
function drawScubaGorilla(cx: number, cy: number, walk: number, enraged = false): void {
  ctx.save();
  ctx.translate(cx, cy);

  const swing = Math.sin(walk);
  const bob = Math.sin(walk * 2) * 2;

  // 怒りオーラ（赤く脈打つ）
  if (enraged) {
    const pulse = 0.5 + 0.5 * Math.sin(walk * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.25;
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 42 + pulse * 5, 48 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 立ちのぼる泡（水中らしさ）
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  for (let i = 0; i < 4; i++) {
    const bx = 20 + i * 4;
    const by = -34 - ((walk * 18 + i * 22) % 60);
    ctx.beginPath();
    ctx.arc(bx, by, 2 + (i % 2), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(0, bob);

  const FUR = "#3f5a52"; // 体毛（深い海の緑がかった灰）
  const FUR_DARK = "#2c403a";
  const SKIN = "#1c2622";

  // --- 酸素ボンベ（背中。黄色いタンク2本＋レギュレーターのホース）---
  ctx.fillStyle = "#e0a92a"; // タンクの黄色
  for (const tx of [-9, 4]) {
    ctx.beginPath();
    ctx.roundRect(tx - 4 + 22, -18, 9, 30, 4);
    ctx.fill();
    ctx.fillStyle = "#9c7416";
    ctx.fillRect(tx - 4 + 22, -20, 9, 4); // バルブ
    ctx.fillStyle = "#e0a92a";
  }
  // ホース（タンクから口元へ）
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(24, -14);
  ctx.quadraticCurveTo(16, -30, 4, -22);
  ctx.stroke();

  // --- 足（左右で逆に踏み出す）＋ 足ひれ ---
  ctx.strokeStyle = FUR_DARK;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-11, 16);
  ctx.lineTo(-13 + swing * 6, 34);
  ctx.moveTo(11, 16);
  ctx.lineTo(13 - swing * 6, 34);
  ctx.stroke();
  // 足ひれ（フィン）
  ctx.fillStyle = "#1f6f86";
  for (const side of [-1, 1]) {
    const fx = side === -1 ? -15 + swing * 6 : 15 - swing * 6;
    ctx.beginPath();
    ctx.ellipse(fx, 39, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 腕（足と逆向きに振る）---
  ctx.strokeStyle = FUR;
  ctx.lineWidth = 15;
  ctx.beginPath();
  ctx.moveTo(-18, -12);
  ctx.lineTo(-30 - swing * 6, 20);
  ctx.moveTo(18, -12);
  ctx.lineTo(30 + swing * 6, 20);
  ctx.stroke();
  // こぶし
  ctx.fillStyle = FUR_DARK;
  ctx.beginPath();
  ctx.arc(-30 - swing * 6, 23, 9, 0, Math.PI * 2);
  ctx.arc(30 + swing * 6, 23, 9, 0, Math.PI * 2);
  ctx.fill();

  // --- 胴体 ---
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.ellipse(0, 2, 22, 25, 0, 0, Math.PI * 2);
  ctx.fill();
  // ウェットスーツのおなか（濃い青）
  ctx.fillStyle = "#234e63";
  ctx.beginPath();
  ctx.ellipse(0, 6, 13, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- 頭 ---
  // 耳
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.arc(-17, -25, 5, 0, Math.PI * 2);
  ctx.arc(17, -25, 5, 0, Math.PI * 2);
  ctx.fill();
  // 頭本体
  ctx.beginPath();
  ctx.ellipse(0, -24, 18, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  // 顔（肌）
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(0, -20, 12, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- 水中マスク（透明バイザー＋バンド）---
  // バンド
  ctx.strokeStyle = "#15131a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-13, -26);
  ctx.lineTo(13, -26);
  ctx.stroke();
  // ガラス（青く光る）
  ctx.fillStyle = enraged ? "rgba(255,80,80,0.55)" : "rgba(120,210,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(0, -24, 11, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#dfe9ee";
  ctx.lineWidth = 2;
  ctx.stroke();
  // 目（マスク越しに光る）
  ctx.fillStyle = enraged ? "#ff3b3b" : "#f3d44a";
  ctx.beginPath();
  ctx.arc(-5, -24, 2.4, 0, Math.PI * 2);
  ctx.arc(5, -24, 2.4, 0, Math.PI * 2);
  ctx.fill();
  // ガラスのハイライト
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(-5, -27, 3, 1.5, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // --- レギュレーター（口にくわえるマウスピース）---
  ctx.fillStyle = "#15131a";
  ctx.beginPath();
  ctx.arc(0, -12, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#444";
  ctx.fillRect(-2, -13, 4, 4);

  ctx.restore();
}

// -------------------------------------------------------------------
// ボス：スノーゴリラ（ステージ4）。白いモコモコの毛＋つららの牙。
//   (cx, cy) が中心。walk が大きいほど腕と足が振れる。enraged で赤く光る。
// -------------------------------------------------------------------
function drawSnowGorillaBoss(cx: number, cy: number, walk: number, enraged = false): void {
  ctx.save();
  ctx.translate(cx, cy);

  const swing = Math.sin(walk);
  const bob = Math.sin(walk * 2) * 2;

  // 怒りオーラ（赤く脈打つ）
  if (enraged) {
    const pulse = 0.5 + 0.5 * Math.sin(walk * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.25;
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 44 + pulse * 6, 50 + pulse * 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    // 通常時は冷気の青白いオーラ
    const pulse = 0.5 + 0.5 * Math.sin(walk * 1.2);
    ctx.save();
    ctx.globalAlpha = 0.16 + pulse * 0.12;
    ctx.fillStyle = "#bfe8ff";
    ctx.beginPath();
    ctx.ellipse(0, 0, 42 + pulse * 5, 48 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 舞い散る冷気（小さな雪のきらめき）
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  for (let i = 0; i < 5; i++) {
    const sx = -24 + ((walk * 22 + i * 30) % 60);
    const sy = -30 + ((walk * 16 + i * 18) % 56);
    ctx.beginPath();
    ctx.arc(sx, sy, 1.4 + (i % 2), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(0, bob);

  const FUR = "#eef5fb"; // 白い毛
  const FUR_DARK = "#cdddec"; // 影
  const SKIN = "#2b3442"; // 顔の濃い色

  // --- 足（左右で逆に踏み出す）---
  ctx.strokeStyle = FUR_DARK;
  ctx.lineWidth = 15;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-11, 16);
  ctx.lineTo(-13 + swing * 6, 34);
  ctx.moveTo(11, 16);
  ctx.lineTo(13 - swing * 6, 34);
  ctx.stroke();

  // --- 腕（足と逆向きに振る）---
  ctx.strokeStyle = FUR;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(-18, -12);
  ctx.lineTo(-31 - swing * 6, 20);
  ctx.moveTo(18, -12);
  ctx.lineTo(31 + swing * 6, 20);
  ctx.stroke();
  // こぶし
  ctx.fillStyle = FUR_DARK;
  ctx.beginPath();
  ctx.arc(-31 - swing * 6, 23, 10, 0, Math.PI * 2);
  ctx.arc(31 + swing * 6, 23, 10, 0, Math.PI * 2);
  ctx.fill();

  // --- 胴体（モコモコ）---
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.ellipse(0, 2, 24, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  // おなかの明るいふくらみ
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(0, 6, 14, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- 頭 ---
  // 耳
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.arc(-18, -25, 6, 0, Math.PI * 2);
  ctx.arc(18, -25, 6, 0, Math.PI * 2);
  ctx.fill();
  // 頭本体
  ctx.beginPath();
  ctx.ellipse(0, -24, 19, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  // 顔（濃い色）
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(0, -20, 13, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // 目（怒りで赤く光る）
  ctx.fillStyle = enraged ? "#ff4040" : "#dff3ff";
  ctx.beginPath();
  ctx.arc(-5, -23, 3, 0, Math.PI * 2);
  ctx.arc(5, -23, 3, 0, Math.PI * 2);
  ctx.fill();
  if (enraged) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#ff6060";
    ctx.beginPath();
    ctx.arc(-5, -23, 5, 0, Math.PI * 2);
    ctx.arc(5, -23, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // 鼻の穴
  ctx.fillStyle = "#11161e";
  ctx.beginPath();
  ctx.arc(-3, -15, 1.4, 0, Math.PI * 2);
  ctx.arc(3, -15, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // つららの牙（口元から下へ伸びる氷の歯）
  ctx.fillStyle = "#cdeefb";
  for (const fx of [-6, -2, 2, 6]) {
    ctx.beginPath();
    ctx.moveTo(fx - 2, -11);
    ctx.lineTo(fx + 2, -11);
    ctx.lineTo(fx, -5);
    ctx.closePath();
    ctx.fill();
  }

  // 頭に積もった雪＆つららの冠
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(0, -38, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cdeefb";
  for (const ix of [-12, -4, 4, 12]) {
    ctx.beginPath();
    ctx.moveTo(ix - 2.5, -36);
    ctx.lineTo(ix + 2.5, -36);
    ctx.lineTo(ix, -28);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// 遠い山（暗い青のなだらかな影）
function drawHill(d: Deco): void {
  ctx.fillStyle = "#161f38";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y, 58 * d.scale, 26 * d.scale, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 流れる雲（ふわっとした半透明のかたまり）
function drawCloud(d: Deco): void {
  const s = d.scale;
  ctx.fillStyle = "rgba(150, 165, 215, 0.10)";
  const puffs: [number, number, number, number][] = [
    [-18, 1, 14, 9],
    [0, -4, 19, 12],
    [18, 1, 14, 9],
    [4, 5, 12, 8],
  ];
  for (const [ox, oy, rx, ry] of puffs) {
    ctx.beginPath();
    ctx.ellipse(d.x + ox * s, d.y + oy * s, rx * s, ry * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 近い地面（夜の島。青グレーで「奥の飾り」に下げ、緑の敵・アイテムと色がぶつからないように）
function drawGround(d: Deco): void {
  const s = d.scale;
  ctx.save();
  ctx.globalAlpha = 0.6; // 少し薄くして背景に沈める
  ctx.fillStyle = "#141b2e"; // 緑→青グレー
  ctx.beginPath();
  ctx.ellipse(d.x, d.y, 50 * s, 30 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(120, 140, 190, 0.16)"; // ふちも青系に
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// --- ここから「地球の空」テーマの背景パーツ ---

// 海面のきらめき（明るい水色の細長い波）。いちばん奥。
function drawSeaSparkle(d: Deco): void {
  const s = d.scale;
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y, 40 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 緑の島（上から見た陸地。砂浜のふち付き）。中間。
function drawIsland(d: Deco): void {
  const s = d.scale;
  // 砂浜（外側の薄い砂色）
  ctx.fillStyle = "#e6d6a0";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y, 44 * s, 30 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 緑の陸地（内側）
  ctx.fillStyle = "#4e9e4e";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y, 36 * s, 23 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 濃い緑の茂み
  ctx.fillStyle = "#3a7d3a";
  ctx.beginPath();
  ctx.ellipse(d.x - 8 * s, d.y - 4 * s, 12 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(d.x + 10 * s, d.y + 5 * s, 10 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 白い雲（手前をふわっと流れる）。いちばん手前。
function drawCloudWhite(d: Deco): void {
  const s = d.scale;
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  const puffs: [number, number, number, number][] = [
    [-18, 2, 15, 10],
    [0, -4, 20, 13],
    [18, 2, 15, 10],
    [4, 6, 13, 9],
  ];
  for (const [ox, oy, rx, ry] of puffs) {
    ctx.beginPath();
    ctx.ellipse(d.x + ox * s, d.y + oy * s, rx * s, ry * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// -------------------------------------------------------------------
// ボス：宇宙チンパンジー（ステージ5の中ボス）。(cx, cy) が中心。
//   宇宙服＋ガラスのヘルメットをかぶった、すばしっこいチンパンジー。
//   walk が大きいほど腕足が振れる。enraged=true で目とオーラが赤い。
// -------------------------------------------------------------------
function drawSpaceChimpBoss(cx: number, cy: number, walk: number, enraged = false): void {
  ctx.save();
  ctx.translate(cx, cy);

  const swing = Math.sin(walk);
  const bob = Math.sin(walk * 2) * 2;
  const glow = enraged ? "#ff4040" : "#7df9ff";

  // 怒りモードでは赤いオーラが脈打つ
  if (enraged) {
    const pulse = 0.5 + 0.5 * Math.sin(walk * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.22 + pulse * 0.22;
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 38 + pulse * 5, 44 + pulse * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.translate(0, bob);

  const SUIT = "#dfe6f0"; // 宇宙服の白
  const SUIT_DARK = "#9aa6ba"; // 影
  const FUR = "#6b4a35"; // チンパンジーの茶色

  // --- ジェットパックの噴射（背中の左右から下へ）---
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const side of [-1, 1]) {
    const f = 0.7 + Math.random() * 0.3;
    const g = ctx.createLinearGradient(side * 16, 18, side * 16, 40 * f);
    g.addColorStop(0, "rgba(255,210,120,0.8)");
    g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(side * 12, 18);
    ctx.lineTo(side * 20, 18);
    ctx.lineTo(side * 16, 40 * f);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // --- 足（宇宙ブーツ。左右で逆に踏み出す）---
  ctx.fillStyle = SUIT;
  for (const side of [-1, 1]) {
    const step = side === -1 ? swing * 5 : -swing * 5;
    ctx.fillRect(side * 9 - 6, 16, 12, 14);
    ctx.fillStyle = SUIT_DARK;
    ctx.fillRect(side * 9 - 8 + step, 28, 16, 6); // ブーツの底
    ctx.fillStyle = SUIT;
  }

  // --- 腕（長いゴリラ的な腕。足と逆に振る。手は茶色い毛）---
  for (const side of [-1, 1]) {
    const sw = side * swing * 7;
    ctx.strokeStyle = SUIT;
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(side * 14, -8);
    ctx.lineTo(side * 22, 22 + sw);
    ctx.stroke();
    // 手（茶色い毛）
    ctx.fillStyle = FUR;
    ctx.beginPath();
    ctx.arc(side * 22, 26 + sw, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 胴体（宇宙服）---
  ctx.fillStyle = SUIT;
  ctx.beginPath();
  ctx.roundRect(-17, -14, 34, 34, 8);
  ctx.fill();
  ctx.strokeStyle = SUIT_DARK;
  ctx.lineWidth = 2;
  ctx.stroke();
  // 胸のコントロールパネル（光る）
  ctx.fillStyle = "#1b2430";
  ctx.beginPath();
  ctx.roundRect(-9, -2, 18, 12, 3);
  ctx.fill();
  for (let i = -1; i <= 1; i++) {
    ctx.fillStyle = i === 0 ? glow : "#ffd36b";
    ctx.beginPath();
    ctx.arc(i * 5, 4, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 頭（チンパンジーの顔＋ガラスのヘルメット）---
  // 大きな耳
  ctx.fillStyle = FUR;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * 13, -30, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 顔（茶色の頭＋うすい肌色の顔）
  ctx.fillStyle = FUR;
  ctx.beginPath();
  ctx.arc(0, -30, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8c8a8";
  ctx.beginPath();
  ctx.ellipse(0, -28, 8, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // 目
  ctx.fillStyle = enraged ? "#ff4040" : "#3a2a20";
  ctx.beginPath();
  ctx.arc(-3.5, -30, 2, 0, Math.PI * 2);
  ctx.arc(3.5, -30, 2, 0, Math.PI * 2);
  ctx.fill();
  // 鼻と口
  ctx.strokeStyle = "#8a6a50";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, -24, 3, 0.2, Math.PI - 0.2);
  ctx.stroke();
  // ガラスのヘルメット（半透明のドーム＋反射）
  ctx.strokeStyle = "rgba(160, 220, 255, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -29, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(180, 230, 255, 0.12)";
  ctx.beginPath();
  ctx.arc(0, -29, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -29, 12, Math.PI * 1.1, Math.PI * 1.5);
  ctx.stroke();

  ctx.restore();
}

// -------------------------------------------------------------------
// ボス：メカ母艦ゴリラ（ステージ5のラスボス）。(cx, cy) が中心。
//   巨大戦艦と一体化した機械ゴリラ。機械ゴリラの最終進化版。
//   walk が大きいほど腕足が振れる。enraged=true で目とオーラが赤い。
// -------------------------------------------------------------------
function drawMotherGorillaBoss(cx: number, cy: number, walk: number, enraged = false): void {
  ctx.save();
  ctx.translate(cx, cy);

  const swing = Math.sin(walk);
  const bob = Math.sin(walk * 2) * 1.2;
  const glow = enraged ? "#ff4040" : "#9fb4ff";

  // 怒りモードでは赤いオーラが脈打つ（大きめ）
  if (enraged) {
    const pulse = 0.5 + 0.5 * Math.sin(walk * 1.5);
    ctx.save();
    ctx.globalAlpha = 0.22 + pulse * 0.22;
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.ellipse(0, 2, 52 + pulse * 6, 50 + pulse * 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.translate(0, bob);

  const HULL = "#3b4a63"; // 母艦の濃紺の装甲
  const HULL_LIGHT = "#5a6f93"; // 明るい装甲
  const METAL = "#8a93a3"; // ゴリラ部分の金属
  const METAL_DARK = "#525a68";
  const JOINT = "#232832";

  // --- 母艦の翼／スラスター（左右に大きく張り出す）---
  for (const side of [-1, 1]) {
    ctx.fillStyle = HULL;
    ctx.beginPath();
    ctx.moveTo(side * 18, 4);
    ctx.lineTo(side * 46, -6);
    ctx.lineTo(side * 50, 8);
    ctx.lineTo(side * 20, 18);
    ctx.closePath();
    ctx.fill();
    // 翼端のスラスター（光る）
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(walk * 3);
    ctx.beginPath();
    ctx.arc(side * 47, 1, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 砲口（翼の下に2門）
    ctx.fillStyle = METAL_DARK;
    ctx.fillRect(side * 30 - 3, 14, 6, 8);
    ctx.fillRect(side * 40 - 3, 12, 6, 8);
  }

  // --- 足（角ばった脚。左右で逆に踏み出す）---
  ctx.fillStyle = METAL_DARK;
  for (const side of [-1, 1]) {
    const sx = side * 12;
    const step = side === -1 ? swing * 5 : -swing * 5;
    ctx.fillRect(sx - 8, 20, 16, 16);
    ctx.fillStyle = JOINT;
    ctx.fillRect(sx - 10 + step, 36, 20, 6);
    ctx.fillStyle = METAL_DARK;
  }

  // --- 腕（太いゴリラの腕。足と逆に振る。先端は大砲のこぶし）---
  for (const side of [-1, 1]) {
    const sw = side * swing * 6;
    const sx = side * 30;
    ctx.strokeStyle = METAL;
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(side * 18, -10);
    ctx.lineTo(sx, 28 + sw);
    ctx.stroke();
    // こぶし砲
    ctx.fillStyle = METAL_DARK;
    ctx.beginPath();
    ctx.arc(sx, 32 + sw, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, 32 + sw, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 胴体（母艦の中央ブロック。大きく角ばった装甲）---
  ctx.fillStyle = HULL_LIGHT;
  ctx.fillRect(-24, -18, 48, 44);
  ctx.strokeStyle = "#1b2230";
  ctx.lineWidth = 2;
  ctx.strokeRect(-24, -18, 48, 44);
  // 装甲のパネル線
  ctx.beginPath();
  ctx.moveTo(-24, 0);
  ctx.lineTo(24, 0);
  ctx.moveTo(-12, -18);
  ctx.lineTo(-12, 26);
  ctx.moveTo(12, -18);
  ctx.lineTo(12, 26);
  ctx.stroke();
  // 胸の巨大動力コア（強く光る）
  const corePulse = 0.6 + 0.4 * Math.sin(walk * 3);
  ctx.fillStyle = glow;
  ctx.globalAlpha = 0.5 + corePulse * 0.5;
  ctx.beginPath();
  ctx.arc(0, 8, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 8, 3.5, 0, Math.PI * 2);
  ctx.fill();
  // 「お供を出す」格納ハッチ（左右）
  ctx.fillStyle = "#1b2230";
  ctx.fillRect(-22, 14, 8, 8);
  ctx.fillRect(14, 14, 8, 8);

  // --- 頭（金属のゴリラヘルメット。機械ゴリラより厳めしい）---
  ctx.fillStyle = METAL;
  ctx.fillRect(-16, -44, 32, 26);
  ctx.strokeStyle = "#1b2230";
  ctx.strokeRect(-16, -44, 32, 26);
  // 側面の耳パーツ
  ctx.fillStyle = METAL_DARK;
  ctx.fillRect(-21, -38, 5, 12);
  ctx.fillRect(16, -38, 5, 12);
  // バイザー（横長の光る目）
  ctx.fillStyle = "#15171c";
  ctx.fillRect(-13, -37, 26, 9);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(-6, -32.5, 2.8, 0, Math.PI * 2);
  ctx.arc(6, -32.5, 2.8, 0, Math.PI * 2);
  ctx.fill();
  // 2本のアンテナ（王冠のように）
  ctx.strokeStyle = METAL_DARK;
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 8, -44);
    ctx.lineTo(side * 11, -54);
    ctx.stroke();
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(side * 11, -55, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // 口元のグリル
  ctx.strokeStyle = "#1b2230";
  ctx.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 6 - 2, -26);
    ctx.lineTo(i * 6 - 2, -22);
    ctx.stroke();
  }

  ctx.restore();
}

// 背景をテーマに応じて描く（夜空 or 地球の空）
function drawBackground(): void {
  if (theme === "night") {
    // 夜空：グラデーション → 遠い山 → 星 → 雲 → 近い島
    ctx.fillStyle = skyGradientNight;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // いちばん奥の山は少しぼかして遠近感（被写界深度）を出す
    ctx.filter = "blur(2px)";
    for (const d of farHills) drawHill(d);
    ctx.filter = "none";
    ctx.fillStyle = "#aab4ff";
    for (const s of stars) ctx.fillRect(s.x, s.y, s.size, s.size);
    for (const d of clouds) drawCloud(d);
    for (const d of nearGround) drawGround(d);
  } else if (theme === "sky") {
    // 地球の空：水色グラデーション → 海のきらめき → 緑の島 → 白い雲
    ctx.fillStyle = skyGradientDay;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const d of farHills) drawSeaSparkle(d);
    for (const d of islands) drawIsland(d);
    for (const d of clouds) drawCloudWhite(d);
  } else if (theme === "sea") {
    // 海の中：藍のグラデーション → 差し込む光 → 奥の岩 → 立ちのぼる泡
    ctx.fillStyle = skyGradientSea;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawLightRays();
    ctx.filter = "blur(2px)"; // 奥の岩はぼかして遠近感
    for (const d of farHills) drawSeaRock(d);
    ctx.filter = "none";
    for (const d of bubbles) drawBubble(d);
  } else if (theme === "ice") {
    // 氷の世界：藍→白のグラデーション → オーロラ → 奥の氷山 → 近い雪の丘 → 降る雪
    ctx.fillStyle = skyGradientIce;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawAurora();
    ctx.fillStyle = "#dff0fb"; // 遠くの星のかわりに、空のきらめき
    for (const s of stars) ctx.fillRect(s.x, s.y, s.size, s.size);
    ctx.filter = "blur(2px)"; // 奥の氷山はぼかして遠近感
    for (const d of farHills) drawIceberg(d);
    ctx.filter = "none";
    for (const d of nearGround) drawSnowHill(d);
    for (const d of snowflakes) drawSnowflake(d);
  } else {
    // 宇宙：漆黒のグラデーション → 星雲 → きらめく星 → 奥の惑星 → 流れ星
    ctx.fillStyle = skyGradientSpace;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawNebula();
    // きらめく星（時間でちらつかせる）
    const tw = performance.now() / 400;
    for (const s of stars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(tw + s.x);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    ctx.filter = "blur(1px)"; // 奥の惑星は少しぼかして遠近感
    for (const d of farHills) drawPlanet(d);
    ctx.filter = "none";
    for (const d of clouds) drawComet(d); // 流れ星
  }
}

// 宇宙：奥でぼんやり広がる星雲（カラフルな光の雲）。ゆっくり色が脈打つ。
function drawNebula(): void {
  const t = performance.now() / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const blobs: [number, number, number, string][] = [
    [WIDTH * 0.3, HEIGHT * 0.25, 150, "rgba(120, 70, 200,"], // 紫
    [WIDTH * 0.7, HEIGHT * 0.45, 170, "rgba(40, 110, 200,"], // 青
    [WIDTH * 0.5, HEIGHT * 0.7, 160, "rgba(200, 60, 140,"], // ピンク
  ];
  for (let i = 0; i < blobs.length; i++) {
    const [bx, by, r, col] = blobs[i];
    const pulse = 0.10 + 0.05 * Math.sin(t * 0.5 + i);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    g.addColorStop(0, col + pulse + ")");
    g.addColorStop(1, col + "0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  ctx.restore();
}

// 宇宙：奥に浮かぶ惑星（リング付きや模様つき）。Deco の x を種類分けに使う。
function drawPlanet(d: Deco): void {
  const r = 14 * d.scale;
  ctx.save();
  ctx.translate(d.x, d.y);
  // 惑星ごとに色を変える（x座標から決める）
  const palette = [
    ["#c97b4a", "#8a4a26"], // 茶（火星風）
    ["#5aa0c8", "#2f6890"], // 青
    ["#c8a85a", "#8a6f2f"], // 黄土（土星風）
  ];
  const pi = Math.floor(d.x) % palette.length;
  const [light, dark] = palette[pi];
  // 本体
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // 土星風のリング（黄土の惑星だけ）
  if (pi === 2) {
    ctx.strokeStyle = "rgba(220, 200, 150, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.7, r * 0.5, -0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// 宇宙：ななめに流れる流れ星（光の尾を引く）。Deco を流用。
function drawComet(d: Deco): void {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.globalCompositeOperation = "lighter";
  // 尾（左上から右下へ）
  const len = 30 * d.scale;
  const g = ctx.createLinearGradient(-len, -len, 0, 0);
  g.addColorStop(0, "rgba(150, 200, 255, 0)");
  g.addColorStop(1, "rgba(200, 230, 255, 0.8)");
  ctx.strokeStyle = g;
  ctx.lineWidth = 2 * d.scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-len, -len);
  ctx.lineTo(0, 0);
  ctx.stroke();
  // 頭の光
  ctx.fillStyle = "#eaf4ff";
  ctx.beginPath();
  ctx.arc(0, 0, 1.8 * d.scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 氷の世界：奥でゆらめくオーロラ（緑〜紫の光のカーテン）
function drawAurora(): void {
  const t = performance.now() / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const colors = ["rgba(90, 230, 170,", "rgba(120, 160, 240,", "rgba(190, 130, 230,"];
  for (let i = 0; i < 3; i++) {
    const baseX = (i + 0.5) * (WIDTH / 3);
    const sway = Math.sin(t * 0.4 + i * 1.2) * 40;
    const alpha = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.6 + i));
    ctx.fillStyle = colors[i] + alpha + ")";
    ctx.beginPath();
    ctx.moveTo(baseX - 50 + sway, 0);
    ctx.quadraticCurveTo(baseX + sway, HEIGHT * 0.3, baseX - 20 + sway, HEIGHT * 0.5);
    ctx.lineTo(baseX + 40 + sway, HEIGHT * 0.5);
    ctx.quadraticCurveTo(baseX + 70 + sway, HEIGHT * 0.3, baseX + 30 + sway, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// 氷の世界：奥に並ぶ氷山のシルエット（青白い三角）
function drawIceberg(d: Deco): void {
  const s = d.scale;
  ctx.fillStyle = "rgba(225, 240, 252, 0.7)";
  ctx.beginPath();
  ctx.moveTo(d.x - 46 * s, d.y + 20 * s);
  ctx.lineTo(d.x, d.y - 26 * s);
  ctx.lineTo(d.x + 46 * s, d.y + 20 * s);
  ctx.closePath();
  ctx.fill();
  // 雪をかぶった明るい頂
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.moveTo(d.x - 16 * s, d.y - 4 * s);
  ctx.lineTo(d.x, d.y - 26 * s);
  ctx.lineTo(d.x + 16 * s, d.y - 4 * s);
  ctx.closePath();
  ctx.fill();
}

// 氷の世界：近い雪の丘（手前を流れる白いふくらみ・ひかえめに）
function drawSnowHill(d: Deco): void {
  const s = d.scale;
  ctx.fillStyle = "rgba(244, 251, 255, 0.4)";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + 34 * s, 56 * s, 24 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 氷の世界：降る雪（1粒）
function drawSnowflake(d: Deco): void {
  const s = d.scale;
  ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + s * 0.3})`;
  ctx.beginPath();
  ctx.arc(d.x, d.y, 1.4 * s, 0, Math.PI * 2);
  ctx.fill();
}

// 海の中：水面から差し込む光のすじ（ゆっくり明滅・移動）
function drawLightRays(): void {
  const t = performance.now() / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    const baseX = (i + 0.5) * (WIDTH / 4);
    const sway = Math.sin(t * 0.3 + i) * 30;
    const alpha = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(t * 0.5 + i * 1.3));
    ctx.fillStyle = `rgba(180, 240, 255, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(baseX - 26 + sway, 0);
    ctx.lineTo(baseX + 26 + sway, 0);
    ctx.lineTo(baseX + 70 + sway, HEIGHT);
    ctx.lineTo(baseX - 70 + sway, HEIGHT);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// 海の中：奥に沈む岩のシルエット（青グレーで控えめに）
function drawSeaRock(d: Deco): void {
  const s = d.scale;
  ctx.fillStyle = "rgba(8, 40, 64, 0.55)";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y, 50 * s, 26 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 海の中：立ちのぼる泡（1粒）
function drawBubble(d: Deco): void {
  const s = d.scale;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(d.x, d.y, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // ハイライト
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.beginPath();
  ctx.arc(d.x - 1.4 * s, d.y - 1.4 * s, 1 * s, 0, Math.PI * 2);
  ctx.fill();
}

// スマホ用の操作ボタン（移動パッド・ショット・ボム）を画面下に描く
function drawTouchControls(): void {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // --- 移動パッド（左下）---
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.30)";
  ctx.beginPath();
  ctx.arc(PAD_CX, PAD_CY, PAD_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 中心の十字（矢印）
  ctx.strokeStyle = "rgba(255, 255, 255, 0.30)";
  ctx.beginPath();
  ctx.moveTo(PAD_CX - PAD_R * 0.5, PAD_CY);
  ctx.lineTo(PAD_CX + PAD_R * 0.5, PAD_CY);
  ctx.moveTo(PAD_CX, PAD_CY - PAD_R * 0.5);
  ctx.lineTo(PAD_CX, PAD_CY + PAD_R * 0.5);
  ctx.stroke();
  // 倒している向きを示すツマミ
  const kx = PAD_CX + touchDirX * PAD_R * 0.55;
  const ky = PAD_CY + touchDirY * PAD_R * 0.55;
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.beginPath();
  ctx.arc(kx, ky, 19, 0, Math.PI * 2);
  ctx.fill();

  // --- ショットボタン（右下）---
  ctx.fillStyle = touchFire ? "rgba(255, 243, 107, 0.5)" : "rgba(255, 243, 107, 0.20)";
  ctx.strokeStyle = "rgba(255, 243, 107, 0.7)";
  ctx.beginPath();
  ctx.arc(SHOT_CX, SHOT_CY, SHOT_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "bold 15px monospace";
  ctx.fillText("ショット", SHOT_CX, SHOT_CY);

  // --- ボムボタン（ショットの左上）---
  const noBomb = player.bombs <= 0;
  ctx.fillStyle = noBomb ? "rgba(120, 120, 120, 0.18)" : "rgba(140, 210, 255, 0.28)";
  ctx.strokeStyle = noBomb ? "rgba(160, 160, 160, 0.4)" : "rgba(140, 210, 255, 0.8)";
  ctx.beginPath();
  ctx.arc(BOMB_CX, BOMB_CY, BOMB_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "bold 13px monospace";
  ctx.fillText("ボム", BOMB_CX, BOMB_CY - 5);
  ctx.font = "11px monospace";
  ctx.fillText(`×${player.bombs}`, BOMB_CX, BOMB_CY + 9);

  ctx.restore();
}

// -------------------------------------------------------------------
// render: 今の状態を画面に描く
// -------------------------------------------------------------------
function render(): void {
  // 「あそびかた」リンクはプレイ中だけ隠す（タイトル・決着では表示）
  if (helpLink) {
    helpLink.style.display =
      gameState === "playing" || gameState === "paused" ? "none" : "";
  }

  // 背景（夜空 or 地球の空。テーマで切り替わる）
  drawBackground();

  // タイトル画面（流れる星の上にタイトルだけ表示）
  if (gameState === "title") {
    // タイトル文字の裏をうっすら暗くする（背景の島や雲に負けず読めるように）
    const vcy = HEIGHT / 2 - 50;
    const vignette = ctx.createRadialGradient(
      WIDTH / 2, vcy, 20,
      WIDTH / 2, vcy, 340
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = "center";
    // タイトル本体（緑のほんのり光るグロー付き）
    ctx.save();
    ctx.shadowColor = "rgba(92, 255, 157, 0.7)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#5cff9d";
    ctx.font = "bold 40px sans-serif";
    // 末尾の句読点（「、」「。」）は字面が左下に寄っていて右に余白ができる。
    // そのぶん右へ少しずらして「見た目の中央」に揃える
    const punctNudge = ctx.measureText("。").width * 0.3;
    ctx.fillText("ゴリラ、", WIDTH / 2 + punctNudge, HEIGHT / 2 - 70);
    ctx.fillText("また来た。", WIDTH / 2 + punctNudge, HEIGHT / 2 - 24);
    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.font = "16px monospace";
    ctx.fillText(`HI-SCORE  ${highScore}`, WIDTH / 2, HEIGHT / 2 + 20);

    // スタート案内をゆっくり点滅させて「押せる感」を出す
    const blink = (Math.sin(performance.now() / 350) + 1) / 2; // 0〜1
    ctx.save();
    ctx.globalAlpha = 0.35 + blink * 0.65;
    ctx.font = "16px monospace";
    ctx.fillText(
      showTouchControls ? "タップでスタート" : "Z / Space でスタート",
      WIDTH / 2,
      HEIGHT / 2 + 60
    );
    ctx.restore();

    ctx.font = "12px monospace";
    if (showTouchControls) {
      ctx.fillText("移動: 左下のパッド   一時停止: 右上のボタン", WIDTH / 2, HEIGHT - 52);
      ctx.fillText("ショット・ボム: 右下のボタン", WIDTH / 2, HEIGHT - 34);
    } else {
      ctx.fillText("移動: 矢印/WASD   ショット: Z/Space", WIDTH / 2, HEIGHT - 52);
      ctx.fillText("ボム: X / Shift   一時停止: P / Esc", WIDTH / 2, HEIGHT - 34);
    }
    ctx.textAlign = "left";
    return; // タイトル中はここで描画終了
  }

  // ここから「ゲーム世界」の描画。被弾の揺れがある間は少しずらして描く。
  // 背景は揺らさず、ここ以降（敵・自機・弾など）だけを揺らす。
  ctx.save();
  if (shakeTime > 0) {
    const k = shakeTime / SHAKE_TIME; // 1 → 0（だんだん収まる）
    const m = SHAKE_MAG * k;
    ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
  }

  // 敵（種類ごとの姿：カタツムリ／蛇／蜘蛛）
  for (const e of enemies) {
    drawEnemy(e);
  }

  // アイテム（キャベツ＝パワーアップ／バナナ＝スピードアップ／ボム＝ボム補充）
  for (const it of items) {
    if (it.kind === "bomb") drawBombItem(it.x, it.y);
    else if (it.kind === "speed") drawBanana(it.x, it.y);
    else drawCabbage(it.x, it.y);
  }

  // ボス（種類に応じた姿）＋ HPバー
  if (boss) {
    if (boss.kind === "machineGorilla") {
      drawMachineGorillaBoss(boss.x, boss.y, boss.walk, boss.enraged);
    } else if (boss.kind === "scubaGorilla") {
      drawScubaGorilla(boss.x, boss.y, boss.walk, boss.enraged);
    } else if (boss.kind === "snowGorilla") {
      drawSnowGorillaBoss(boss.x, boss.y, boss.walk, boss.enraged);
    } else if (boss.kind === "spaceChimp") {
      drawSpaceChimpBoss(boss.x, boss.y, boss.walk, boss.enraged);
    } else if (boss.kind === "motherGorilla") {
      drawMotherGorillaBoss(boss.x, boss.y, boss.walk, boss.enraged);
    } else {
      drawGorillaBoss(boss.x, boss.y, boss.walk, boss.enraged);
    }
    // 画面上部のHPバー（角丸＋ツヤ＋目盛り＋ボス名）
    const hpColor =
      boss.kind === "machineGorilla"
        ? "#5cd6ff"
        : boss.kind === "scubaGorilla"
          ? "#5cffd0"
          : boss.kind === "snowGorilla"
            ? "#bfe8ff"
            : boss.kind === "spaceChimp"
              ? "#7df9ff"
              : boss.kind === "motherGorilla"
                ? "#9fb4ff"
                : "#ff5cc8";
    const ratio = Math.max(0, boss.hp / boss.maxHp);
    const barX = 20;
    const barY = 14;
    const barW = WIDTH - 40;
    const barH = 11;

    ctx.save();
    // 土台（半透明の黒・角丸・うっすらフチ）
    ctx.fillStyle = "rgba(10, 6, 16, 0.8)";
    ctx.beginPath();
    ctx.roundRect(barX - 2, barY - 2, barW + 4, barH + 4, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // 残りHP（ボス色のグラデ＝上が明るくツヤ）
    const fillW = barW * ratio;
    if (fillW > 0) {
      const g = ctx.createLinearGradient(0, barY, 0, barY + barH);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.18, hpColor);
      g.addColorStop(1, hexToRgba(hpColor, 0.65));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(barX, barY, fillW, barH, 4);
      ctx.fill();
      // 上半分に白いツヤ
      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.beginPath();
      ctx.roundRect(barX, barY, fillW, barH * 0.45, 4);
      ctx.fill();
    }

    // 目盛り（10等分の区切り線）
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const sx = barX + (barW * i) / 10;
      ctx.beginPath();
      ctx.moveTo(sx, barY);
      ctx.lineTo(sx, barY + barH);
      ctx.stroke();
    }
    ctx.restore();

    // ボス名（バーの下に中央表示）。中ボス・ラスボスは肩書きつき
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 12px monospace";
    let bossLabel = BOSS_NAME[boss.kind];
    let labelColor = hpColor;
    if (boss.isMid) {
      bossLabel = "中ボス  " + bossLabel;
      labelColor = "#7df9ff";
    } else if (boss.kind === "motherGorilla") {
      bossLabel = "★ラスボス★  " + bossLabel;
      labelColor = "#ffd45c";
    }
    ctx.fillStyle = labelColor;
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 3;
    ctx.fillText(bossLabel, WIDTH / 2, barY + barH + 16);
    ctx.restore();
    ctx.textAlign = "left";
  }

  // 敵の弾（光る危険な弾：色つきオーラ＋白い芯＋ゆっくり脈打つ）
  //   色は弾ごとに持っている（ふつうの敵＝赤／ボス＝ボスごとの色）
  ctx.save();
  const ebTime = performance.now() / 1000;
  for (const eb of enemyBullets) {
    // ゆっくり脈打たせて「生きている弾」感を出す（位置ごとに位相をずらす）
    const pulse = 0.85 + 0.15 * Math.sin(ebTime * 9 + eb.x * 0.3);
    const r = EBULLET_RADIUS * pulse;
    // 外側：ふんわり広がる色つきのグロー
    const grad = ctx.createRadialGradient(eb.x, eb.y, 0, eb.x, eb.y, r * 2.2);
    grad.addColorStop(0, hexToRgba(eb.color, 0.9));
    grad.addColorStop(0.5, hexToRgba(eb.color, 0.45));
    grad.addColorStop(1, hexToRgba(eb.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(eb.x, eb.y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    // 本体：弾の色そのもの
    ctx.fillStyle = eb.color;
    ctx.beginPath();
    ctx.arc(eb.x, eb.y, r, 0, Math.PI * 2);
    ctx.fill();
    // 芯：白く光る中心（少し上にずらしてツヤを表現）
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(eb.x - r * 0.25, eb.y - r * 0.25, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 爆発の破片（丸い火花：寿命とともに縮んで薄くなる＋ふんわり発光）
  ctx.save();
  for (const p of particles) {
    const t = Math.max(0, p.life / p.maxLife); // 1 → 0
    const r = p.size * (0.4 + 0.6 * t); // 消えるにつれ小さく
    ctx.globalAlpha = t;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8 * t;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    // 生まれたては中心が白く熱い
    if (t > 0.5) {
      ctx.globalAlpha = (t - 0.5) * 2;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1; // 透明度を元に戻す

  // アイテム取得などの「光の輪」（パッと広がって薄くなる）
  ctx.save();
  for (const ring of rings) {
    const t = Math.max(0, ring.life / ring.maxLife); // 1 → 0
    const r = ring.maxR * (1 - t) + 4; // 小さい→大きいへ
    ctx.globalAlpha = t;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 3 * t + 0.5;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // 浮かぶ文字（「+100」など）：上に昇りながら薄くなる
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "bold 14px monospace";
  for (const f of floatTexts) {
    const t = Math.max(0, f.life / f.maxLife); // 1 → 0
    ctx.globalAlpha = Math.min(1, t * 1.6); // 最後だけスッと消える
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 3;
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";

  // 自機のショット（光るエネルギー弾：黄色いオーラ＋白い芯）
  ctx.save();
  ctx.shadowColor = "#ffe14d";
  ctx.shadowBlur = 9;
  for (const b of bullets) {
    if (b.laser) {
      // お供の小亀のレーザー：細くて長い水色の光の柱
      ctx.shadowColor = "#7df9ff";
      ctx.fillStyle = "#8bf6ff";
      ctx.beginPath();
      ctx.roundRect(b.x - 2.5, b.y - 16, 5, 30, 2.5);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(b.x - 1, b.y - 14, 2, 26, 1);
      ctx.fill();
      ctx.shadowColor = "#ffe14d"; // 元の黄色いグローに戻す
      continue;
    }
    // 外側：丸みのある黄色いカプセル
    ctx.fillStyle = "#ffd23b";
    ctx.beginPath();
    ctx.roundRect(b.x - 3, b.y - 10, 6, 18, 3);
    ctx.fill();
    // 内側：明るい白の芯
    ctx.fillStyle = "#fffce0";
    ctx.beginPath();
    ctx.roundRect(b.x - 1.5, b.y - 8, 3, 12, 1.5);
    ctx.fill();
  }
  ctx.restore();

  // エンジン噴射の光の軌跡（自機より奥に描く）
  if (gameState !== "gameover") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter"; // 光が重なって明るくなる
    const ex = exhaustColor();
    for (const tr of trails) {
      const t = Math.max(0, tr.life / tr.maxLife); // 1 → 0
      const r = tr.size * (0.5 + 0.5 * t);
      // 外側：テーマ色のオーラ
      ctx.globalAlpha = t * 0.5;
      ctx.fillStyle = ex;
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, r, 0, Math.PI * 2);
      ctx.fill();
      // 芯：白く明るい中心
      ctx.globalAlpha = t * 0.8;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 自機（頭がキリン・体が亀のふしぎな生きもの。上＝進行方向）。
  // 無敵中だけ点滅させ、それ以外は常に表示。ゲームオーバー中は描かない。
  const blinkVisible =
    player.invincible <= 0 || Math.floor(player.invincible * 10) % 2 === 0;
  if (gameState !== "gameover" && blinkVisible) {
    drawPlayerGiraffeTurtle(player.x, player.y, player.lean);
  }

  // お供の小亀（5段階目）。自機の近くにふわっと付き従う
  if (gameState !== "gameover" && optionTurtle.active) {
    drawMiniTurtle(optionTurtle.x, optionTurtle.y);
  }

  // ボムの閃光（自機を中心に水色〜白がまぶしく光る＋太い衝撃波の輪）
  if (bombFlash > 0) {
    const t = bombFlash / BOMB_FLASH_TIME; // 1 → 0 へ
    ctx.save();
    // 自機を中心にした、まぶしい放射状フラッシュ（白い芯→水色→透明）
    const fg = ctx.createRadialGradient(
      player.x, player.y, 10,
      player.x, player.y, Math.max(WIDTH, HEIGHT)
    );
    fg.addColorStop(0, hexToRgba("#ffffff", t * 0.9));
    fg.addColorStop(0.35, hexToRgba("#bfe9ff", t * 0.5));
    fg.addColorStop(1, hexToRgba("#8bd8ff", 0));
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // 太い主リング（勢いよく外へ広がる）
    ctx.globalAlpha = t;
    ctx.strokeStyle = "#e8f7ff";
    ctx.lineWidth = 8 * t + 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, (1 - t) * Math.max(WIDTH, HEIGHT), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ボス撃破の画面フラッシュ（パッと白く光ってスッと消える）
  if (bossDefeatFlash > 0) {
    const t = bossDefeatFlash / BOSS_DEFEAT_FLASH_TIME; // 1 → 0 へ
    ctx.save();
    // 中央（ボスがいた上のほう）ほど強く光る白いフラッシュ
    const fg = ctx.createRadialGradient(
      WIDTH / 2, HEIGHT * 0.32, 20,
      WIDTH / 2, HEIGHT * 0.32, Math.max(WIDTH, HEIGHT)
    );
    fg.addColorStop(0, hexToRgba("#ffffff", t * 0.85));
    fg.addColorStop(0.4, hexToRgba(bossDefeatColor, t * 0.35));
    fg.addColorStop(1, hexToRgba(bossDefeatColor, 0));
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  // ここでゲーム世界の揺れを終了（以降のHUDや決着表示は揺らさない）
  ctx.restore();

  // プレイ中の情報表示（スコア・残機・パワー・ボム）を角丸パネルにまとめる
  // ※ふた回り小さくして、ボス戦などで邪魔にならないように
  const hudX = 8;
  const hudY = 10;
  const hudW = 138;
  const hudH = 92;
  // 半透明の角丸パネル（どんな背景でも読めるように）
  ctx.fillStyle = "rgba(8, 12, 24, 0.55)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(hudX, hudY, hudW, hudH, 8);
  ctx.fill();
  ctx.stroke();

  // 文字に薄い影（明るい空テーマでも読める）
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 3;
  const tx = hudX + 9;

  // SCORE（いちばん目立たせる）
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 15px monospace";
  ctx.fillText(`${score}`, tx, hudY + 21);
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.font = "8px monospace";
  ctx.fillText("SCORE", tx + 1, hudY + 31);
  // HI-SCORE（控えめに右側へ）
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.font = "9px monospace";
  ctx.fillText(`HI ${highScore}`, tx + 62, hudY + 19);

  // 残機（ハート）
  ctx.font = "12px monospace";
  ctx.fillStyle = "#ff5c7a";
  ctx.fillText("♥".repeat(Math.max(0, player.lives)) || "—", tx, hudY + 49);

  // スピード（バナナで上がる小さな2段の印。残機の右側に置く）
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.font = "8px monospace";
  ctx.fillText("SPD", tx + 66, hudY + 49);
  for (let i = 0; i < SPEED_MAX; i++) {
    const bx = tx + 90 + i * 13;
    ctx.fillStyle = i < player.speedLevel ? "#ffd23b" : "rgba(255, 255, 255, 0.18)";
    ctx.beginPath();
    ctx.roundRect(bx, hudY + 43, 10, 7, 2);
    ctx.fill();
  }

  // パワー（3段の小さなバー）
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.font = "8px monospace";
  ctx.fillText("POWER", tx, hudY + 65);
  for (let i = 0; i < POWER_MAX; i++) {
    const bx = tx + 40 + i * 17;
    const filled = i < player.power;
    ctx.fillStyle = filled ? "#7be0ff" : "rgba(255, 255, 255, 0.18)";
    ctx.beginPath();
    ctx.roundRect(bx, hudY + 58, 14, 7, 2);
    ctx.fill();
  }

  // ボム（今ある数だけ黄色い丸。多いときは6個＋数字で表示）
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.font = "8px monospace";
  ctx.fillText("BOMB", tx, hudY + 83);
  const bombDots = Math.min(player.bombs, 6);
  for (let i = 0; i < bombDots; i++) {
    const bx = tx + 40 + i * 11;
    ctx.beginPath();
    ctx.arc(bx + 4, hudY + 80, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd23b";
    ctx.fill();
  }
  if (player.bombs === 0) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.font = "9px monospace";
    ctx.fillText("なし", tx + 40, hudY + 83);
  } else if (player.bombs > 6) {
    ctx.fillStyle = "#ffd23b";
    ctx.font = "9px monospace";
    ctx.fillText(`+${player.bombs - 6}`, tx + 40 + 6 * 11, hudY + 83);
  }

  // ステージ開始時のバナー（「STAGE 2」など）。ボスがいない間だけ表示。
  // スッと横から滑り込み→少し止まって→スッと抜けていく＋飾りライン。
  if (stageBanner > 0 && !boss && gameState !== "paused") {
    const shown = STAGE_BANNER_TIME - stageBanner; // 表示開始からの経過秒
    let slide = 0;
    let alpha = 1;
    if (shown < 0.35) {
      const k = shown / 0.35; // 0→1（左から滑り込む）
      slide = (1 - k) * -120;
      alpha = k;
    } else if (stageBanner < 0.45) {
      const k = stageBanner / 0.45; // 1→0（右へ抜けていく）
      slide = (1 - k) * 120;
      alpha = k;
    }
    // テーマに合わせたアクセント色
    const accent =
      theme === "night" ? "#5cff9d"
      : theme === "sky" ? "#9fe0ff"
      : theme === "sea" ? "#5cffd0"
      : theme === "ice" ? "#bfe8ff"
      : "#c9a8ff"; // space
    const cx = WIDTH / 2 + slide;
    const cy = HEIGHT / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    // 上下の飾りライン
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 95, cy - 27);
    ctx.lineTo(cx + 95, cy - 27);
    ctx.moveTo(cx - 95, cy + 13);
    ctx.lineTo(cx + 95, cy + 13);
    ctx.stroke();
    // ステージ名（白文字＋アクセント色のグロー）
    ctx.shadowColor = accent;
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px monospace";
    ctx.fillText(stage.name, cx, cy);
    ctx.shadowBlur = 0;
    // 小さな「START!」
    ctx.fillStyle = accent;
    ctx.font = "bold 11px monospace";
    ctx.fillText("START!", cx, cy + 30);
    ctx.restore();
    ctx.textAlign = "left";
  }

  // 「WARNING」表示：ボス入場中の演出（赤く点滅する警告バー＋流れるハザード縞）
  if (boss && boss.phase === "enter") {
    ctx.save();
    const wt = performance.now() / 1000;
    const blink = 0.5 + 0.5 * Math.sin(wt * 10); // 速めに点滅
    const bandY = HEIGHT / 2 - 36;
    const bandH = 72;

    // 黒い帯（土台）
    ctx.fillStyle = "rgba(0, 0, 0, 0.74)";
    ctx.fillRect(0, bandY, WIDTH, bandH);

    // 上下のフチに「黄×黒の斜めハザード縞」が流れる（8pxの細い帯だけに表示）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bandY, WIDTH, 8);
    ctx.rect(0, bandY + bandH - 8, WIDTH, 8);
    ctx.clip();
    const off = (wt * 70) % 40;
    ctx.fillStyle = "#ffcf3b";
    for (let x = -bandH; x < WIDTH + 40; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + off, bandY);
      ctx.lineTo(x + off + 18, bandY);
      ctx.lineTo(x + off + 18 - bandH, bandY + bandH);
      ctx.lineTo(x + off - bandH, bandY + bandH);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 赤い上下ライン（点滅）
    ctx.globalAlpha = 0.35 + blink * 0.65;
    ctx.fillStyle = "#ff2a2a";
    ctx.fillRect(0, bandY + 8, WIDTH, 2);
    ctx.fillRect(0, bandY + bandH - 10, WIDTH, 2);

    // 「WARNING」文字（赤く光って点滅）
    ctx.globalAlpha = 0.55 + blink * 0.45;
    ctx.textAlign = "center";
    ctx.shadowColor = "#ff2a2a";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#ff5050";
    ctx.font = "bold 34px monospace";
    ctx.fillText("⚠ WARNING ⚠", WIDTH / 2, HEIGHT / 2 + 4);
    ctx.shadowBlur = 0;

    // サブ文字（常時しっかり表示）
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffd0d0";
    ctx.font = "bold 12px monospace";
    ctx.fillText("BOSS APPROACHING", WIDTH / 2, HEIGHT / 2 + 26);
    ctx.textAlign = "left";
    ctx.restore();
  }

  // 影をリセット（以降の描画に影が残らないように）
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // スマホ用の操作ボタン（プレイ中だけ・タッチ端末で表示）
  if (showTouchControls && gameState === "playing") {
    drawTouchControls();
    // 右上のポーズボタン（一時停止アイコン＝縦2本線）
    ctx.save();
    ctx.fillStyle = "rgba(8, 12, 24, 0.55)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(PAUSE_CX, PAUSE_CY, PAUSE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e8eefc";
    ctx.fillRect(PAUSE_CX - 5, PAUSE_CY - 6, 3.5, 12);
    ctx.fillRect(PAUSE_CX + 1.5, PAUSE_CY - 6, 3.5, 12);
    ctx.restore();
  }

  // ポーズ画面（プレイ中に P / Esc・スマホは右上ボタンで一時停止）
  if (gameState === "paused") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    ctx.save();
    ctx.textAlign = "center";
    // 大きな一時停止アイコン（縦2本線）
    ctx.fillStyle = "#bfe9ff";
    ctx.fillRect(cx - 26, cy - 86, 16, 46);
    ctx.fillRect(cx + 10, cy - 86, 16, 46);
    // 「PAUSE」（水色に光る）
    ctx.shadowColor = "rgba(120, 200, 255, 0.7)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#bfe9ff";
    ctx.font = "bold 36px monospace";
    ctx.fillText("PAUSE", cx, cy);
    ctx.shadowBlur = 0;
    // 再開の案内
    ctx.fillStyle = "#cfd6e2";
    ctx.font = "14px monospace";
    ctx.fillText(showTouchControls ? "タップで再開" : "P / Esc で再開", cx, cy + 34);
    ctx.restore();
    ctx.textAlign = "left";
  }

  // 決着画面（ゲームオーバー / クリア）
  if (gameState === "clear") {
    drawEndingScreen();
  } else if (gameState === "gameover") {
    // 暗い赤みのオーバーレイ（中央ほど赤黒く沈むビネット）
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const vig = ctx.createRadialGradient(
      WIDTH / 2, HEIGHT / 2 - 40, 40,
      WIDTH / 2, HEIGHT / 2 - 40, 320
    );
    vig.addColorStop(0, "rgba(70, 0, 0, 0.55)");
    vig.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    ctx.save();
    ctx.textAlign = "center";
    // GAME OVER（赤くにじむ大きな文字）
    ctx.shadowColor = "rgba(255, 40, 40, 0.9)";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#ff4040";
    ctx.font = "bold 44px monospace";
    ctx.fillText("GAME OVER", cx, cy - 56);
    ctx.shadowBlur = 0;
    // 赤い区切りライン
    ctx.strokeStyle = "rgba(255, 80, 80, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 120, cy - 36);
    ctx.lineTo(cx + 120, cy - 36);
    ctx.stroke();
    // スコア
    ctx.fillStyle = "#ffffff";
    ctx.font = "20px monospace";
    ctx.fillText(`SCORE  ${score}`, cx, cy - 2);
    ctx.fillStyle = "#cfd6e2";
    ctx.font = "15px monospace";
    ctx.fillText(`HI-SCORE  ${highScore}`, cx, cy + 26);
    if (newRecord) {
      // 新記録は金色に点滅
      const blink = 0.5 + 0.5 * Math.sin(performance.now() / 200);
      ctx.globalAlpha = 0.5 + blink * 0.5;
      ctx.fillStyle = "#fff36b";
      ctx.shadowColor = "#fff36b";
      ctx.shadowBlur = 12;
      ctx.font = "bold 18px monospace";
      ctx.fillText("★ NEW RECORD! ★", cx, cy + 56);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "#9aa3b2";
    ctx.font = "14px monospace";
    ctx.fillText(
      showTouchControls ? "タップでタイトルへ" : "Z / Space でタイトルへ",
      cx,
      cy + 92,
    );
    ctx.restore();
    ctx.textAlign = "left";
  }
}

// 全クリアの特別エンディング：これまで倒した5体のゴリラが勢ぞろいするお祝い画面。
function drawEndingScreen(): void {
  const t = performance.now() / 1000;
  // 背景を暗くしてお祝いムードに
  ctx.fillStyle = "rgba(4, 2, 14, 0.78)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";

  // 上：お祝いの大見出し（ふんわり光る）
  ctx.save();
  ctx.shadowColor = "#7dff9d";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#7dff9d";
  ctx.font = "bold 34px monospace";
  ctx.fillText("ゴリラ完全制覇！", WIDTH / 2, 66);
  ctx.restore();
  ctx.fillStyle = "#ffd45c";
  ctx.font = "14px monospace";
  ctx.fillText("ALL BOSSES DEFEATED", WIDTH / 2, 90);

  // 中央：歴代ボス5体の勢ぞろい（小さく描いて横一列）
  const lineup: ((cx: number, cy: number, walk: number, enraged?: boolean) => void)[] = [
    drawGorillaBoss,
    drawMachineGorillaBoss,
    drawScubaGorilla,
    drawSnowGorillaBoss,
    drawMotherGorillaBoss,
  ];
  const rowY = 200;
  const scale = 0.42;
  for (let i = 0; i < lineup.length; i++) {
    const x = WIDTH * ((i + 0.5) / lineup.length);
    // 一体ずつ少し時間差でぴょこぴょこ（お祝いで体を揺らす）
    const walk = t * 3 + i * 1.2;
    ctx.save();
    ctx.translate(x, rowY + Math.sin(t * 2 + i) * 3);
    ctx.scale(scale, scale);
    lineup[i](0, 0, walk, false);
    ctx.restore();
    // ステージ番号のラベル
    ctx.fillStyle = "#9fb0c8";
    ctx.font = "11px monospace";
    ctx.fillText(`${i + 1}`, x, rowY + 52);
  }

  // ひとことネタ
  ctx.fillStyle = "#cfd6e2";
  ctx.font = "13px monospace";
  ctx.fillText("…ぜんぶゴリラだった。", WIDTH / 2, 280);

  // 下：スコア
  ctx.fillStyle = "#ffffff";
  ctx.font = "20px monospace";
  ctx.fillText(`SCORE  ${score}`, WIDTH / 2, 340);
  ctx.font = "16px monospace";
  ctx.fillText(`HI-SCORE  ${highScore}`, WIDTH / 2, 366);
  // 残機ぶんの減点があれば理由を表示
  if (clearLifePenalty > 0) {
    ctx.fillStyle = "#ff9a9a";
    ctx.font = "13px monospace";
    ctx.fillText(`残機減点  -${clearLifePenalty}`, WIDTH / 2, 390);
  }
  if (newRecord) {
    ctx.fillStyle = "#fff36b";
    ctx.font = "18px monospace";
    ctx.fillText("NEW RECORD!", WIDTH / 2, 418);
  }
  // 点滅する案内
  if (Math.floor(t * 2) % 2 === 0) {
    ctx.fillStyle = "#bbbbbb";
    ctx.font = "14px monospace";
    ctx.fillText(
      showTouchControls ? "タップでタイトルへ" : "Z / Space でタイトルへ",
      WIDTH / 2,
      HEIGHT - 60,
    );
  }
  ctx.textAlign = "left";
}

// -------------------------------------------------------------------
// ポーズ（一時停止）／再開。ポーズ中は音楽も止める。
// -------------------------------------------------------------------
function pauseGame(): void {
  gameState = "paused";
  setMusic(null); // ポーズ中はBGMを止める
}
function resumeGame(): void {
  gameState = "playing";
  // 再開したら、今の場面に合ったBGMを鳴らし直す（ボス戦中ならボス曲）
  setMusic(boss ? stage.bossMusic : stage.normalMusic);
}

// -------------------------------------------------------------------
// メインループ：固定タイムステップ（accumulator方式）
// -------------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;

function frame(now: number): void {
  let elapsed = (now - lastTime) / 1000;
  lastTime = now;
  if (elapsed > 0.25) elapsed = 0.25;

  // ヒットストップ中はゲームの進行を止め、描画だけ続ける（被弾の「ため」）
  if (hitStop > 0) {
    hitStop -= elapsed;
    render();
    requestAnimationFrame(frame);
    return;
  }

  // ポーズ中はゲームを進めず、描画だけ続ける（再開時にまとめて進まないよう時間も貯めない）
  if (gameState === "paused") {
    accumulator = 0;
    render();
    requestAnimationFrame(frame);
    return;
  }

  accumulator += elapsed;
  while (accumulator >= STEP) {
    update(STEP);
    accumulator -= STEP;
  }

  render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
