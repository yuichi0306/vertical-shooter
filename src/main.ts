// ===================================================================
// ステップ5: 自機の被弾（残機・無敵時間・ゲームオーバー）
//   - 敵に触れると1機減り、しばらく無敵（点滅）で復活
//   - 残機0でゲームオーバー → キーでリスタート
// ===================================================================

import { STAGE_TIMELINE, STAGE_DURATION, type EnemyKind } from "./stage";

// ゲーム内部の解像度（座標はすべてこのサイズを基準に書く）
const WIDTH = 480;
const HEIGHT = 640;

// 1秒間に何回「更新」するか（60回 = なめらか）
const FPS = 60;
const STEP = 1 / FPS; // 1回の更新が進める時間（秒）

// canvas（絵を描く領域）を取得
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// -------------------------------------------------------------------
// キーボード入力：今どのキーが押されているかを覚えておく
// -------------------------------------------------------------------
const keys = new Set<string>();

window.addEventListener("keydown", (e) => {
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
// 自機
// -------------------------------------------------------------------
const PLAYER_SPEED = 260; // 1秒あたりに動くピクセル数
const PLAYER_RADIUS = 11; // 見た目／画面端で止まるときの半径

const START_LIVES = 3; // 開始時の残機
const INVINCIBLE_TIME = 2.0; // 被弾後の無敵時間（秒）

const player = {
  x: WIDTH / 2,
  y: HEIGHT - 90,
  fireCooldown: 0, // 次に撃てるようになるまでの残り時間（秒）
  lives: START_LIVES, // 残機
  invincible: 0, // 残りの無敵時間（秒）。0より大きい間は無敵
};

// ゲーム全体の状態。今は「プレイ中」と「ゲームオーバー」の2つ。
// （タイトル画面はステップ8で追加します）
type GameState = "playing" | "gameover";
let gameState: GameState = "playing";
let gameoverLock = 0; // ゲームオーバー直後、リスタート入力を受け付けない時間（秒）

// -------------------------------------------------------------------
// 自機のショット（弾）
// -------------------------------------------------------------------
const BULLET_SPEED = 560; // 上へ進む速さ（px/秒）
const FIRE_INTERVAL = 0.12; // 連射の間隔（秒）。小さいほど速く撃てる

const BULLET_RADIUS = 4; // 当たり判定用の半径
type Bullet = { x: number; y: number };
const bullets: Bullet[] = [];

// -------------------------------------------------------------------
// 敵
// -------------------------------------------------------------------
const ENEMY_RADIUS = 16; // 見た目／当たり判定の半径
const ENEMY_SPEED = 110; // 下りてくる速さ（px/秒）
const ENEMY_HP = 1; // 倒すのに必要な被弾数
const ZIGZAG_AMPLITUDE = 70; // 「揺れる敵」が左右に動く幅（px）
const ZIGZAG_FREQ = 1.8; // 「揺れる敵」の揺れの速さ

// kind … 敵の種類、baseX … 揺れの基準になる横位置、age … 出現からの経過秒
type Enemy = {
  x: number;
  y: number;
  hp: number;
  kind: EnemyKind;
  baseX: number;
  age: number;
};
const enemies: Enemy[] = [];

// タイムライン進行用：ステージ開始からの経過秒と、次に処理するイベント番号
let stageTime = 0;
let nextEventIndex = 0;

// 敵を1体作る
function spawnEnemy(kind: EnemyKind, xRatio: number): void {
  const x = xRatio * WIDTH;
  enemies.push({ x, y: -ENEMY_RADIUS, hp: ENEMY_HP, kind, baseX: x, age: 0 });
}

// ゲームを最初の状態に戻す（開始時とリスタート時に呼ぶ）
function resetGame(): void {
  player.x = WIDTH / 2;
  player.y = HEIGHT - 90;
  player.fireCooldown = 0;
  player.lives = START_LIVES;
  player.invincible = 0;
  bullets.length = 0;
  enemies.length = 0;
  stageTime = 0;
  nextEventIndex = 0;
  defeated = 0;
  gameState = "playing";
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

// FPS計測用
let fps = 0;
let fpsTimer = 0;
let fpsCount = 0;

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

  // ゲームオーバー中は、キー入力でのリスタートだけ受け付ける
  if (gameState === "gameover") {
    if (gameoverLock > 0) gameoverLock -= dt;
    else if (isDown("KeyZ", "Space", "Enter")) resetGame();
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

  player.x += dx * PLAYER_SPEED * dt;
  player.y += dy * PLAYER_SPEED * dt;

  // 画面の外に出ないように位置を制限する
  player.x = Math.max(PLAYER_RADIUS, Math.min(WIDTH - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(HEIGHT - PLAYER_RADIUS, player.y));

  // --- ショット ---
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (isDown("KeyZ", "Space") && player.fireCooldown <= 0) {
    bullets.push({ x: player.x, y: player.y - 16 });
    player.fireCooldown = FIRE_INTERVAL;
  }

  // 弾を上へ進める
  for (const b of bullets) {
    b.y -= BULLET_SPEED * dt;
  }
  // 画面の上に出た弾を消す（残し続けると重くなるため）
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (bullets[i].y < -10) bullets.splice(i, 1);
  }

  // --- 敵の出現（データ駆動タイムライン）---
  stageTime += dt;
  // 「今の時刻」に達したイベントを順番に処理する
  while (
    nextEventIndex < STAGE_TIMELINE.length &&
    STAGE_TIMELINE[nextEventIndex].time <= stageTime
  ) {
    const ev = STAGE_TIMELINE[nextEventIndex];
    spawnEnemy(ev.kind, ev.x);
    nextEventIndex += 1;
  }

  // --- 敵の移動 ---
  for (const e of enemies) {
    e.age += dt;
    e.y += ENEMY_SPEED * dt;
    if (e.kind === "zigzag") {
      // 基準位置を中心に、サイン波で左右に揺らす
      e.x = e.baseX + Math.sin(e.age * ZIGZAG_FREQ) * ZIGZAG_AMPLITUDE;
    }
  }

  // --- 当たり判定：自分の弾 × 敵 ---
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (hit(b.x, b.y, BULLET_RADIUS, e.x, e.y, ENEMY_RADIUS)) {
        bullets.splice(bi, 1); // 弾は消える
        e.hp -= 1;
        if (e.hp <= 0) {
          enemies.splice(ei, 1); // 敵を倒した
          defeated += 1;
        }
        break; // この弾はもう消えたので、次の弾へ
      }
    }
  }

  // --- 当たり判定：敵 × 自機（無敵中は当たらない）---
  if (player.invincible <= 0) {
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (hit(player.x, player.y, PLAYER_RADIUS, e.x, e.y, ENEMY_RADIUS)) {
        enemies.splice(ei, 1); // ぶつかった敵は壊れる
        player.lives -= 1; // 残機を1減らす
        if (player.lives <= 0) {
          gameState = "gameover";
          gameoverLock = 0.8; // 0.8秒は入力を無視（誤リスタート防止）
        } else {
          player.invincible = INVINCIBLE_TIME; // しばらく無敵で復活
        }
        break;
      }
    }
  }

  // --- 画面の下に出た敵を消す ---
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].y > HEIGHT + ENEMY_RADIUS) enemies.splice(i, 1);
  }
}

// -------------------------------------------------------------------
// render: 今の状態を画面に描く
// -------------------------------------------------------------------
function render(): void {
  // 背景
  ctx.fillStyle = "#05050f";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 星
  ctx.fillStyle = "#aab4ff";
  for (const s of stars) {
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }

  // 敵（種類で色分け：まっすぐ=赤、揺れる=オレンジ）
  for (const e of enemies) {
    ctx.fillStyle = e.kind === "zigzag" ? "#ff9f43" : "#ff5c7a";
    ctx.fillRect(
      e.x - ENEMY_RADIUS,
      e.y - ENEMY_RADIUS,
      ENEMY_RADIUS * 2,
      ENEMY_RADIUS * 2,
    );
  }

  // 自機のショット
  ctx.fillStyle = "#fff36b";
  for (const b of bullets) {
    ctx.fillRect(b.x - 2, b.y - 8, 4, 12);
  }

  // 自機（上向きの三角形）。無敵中だけ点滅させ、それ以外は常に表示。
  // ゲームオーバー中は自機を描かない。
  const blinkVisible =
    player.invincible <= 0 || Math.floor(player.invincible * 10) % 2 === 0;
  if (gameState !== "gameover" && blinkVisible) {
    ctx.fillStyle = "#5cff9d";
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - 14);
    ctx.lineTo(player.x - 11, player.y + 12);
    ctx.lineTo(player.x + 11, player.y + 12);
    ctx.closePath();
    ctx.fill();
  }

  // 動作確認用の文字
  ctx.fillStyle = "#ffffff";
  ctx.font = "14px monospace";
  ctx.fillText(`FPS: ${fps}`, 10, 22);
  ctx.fillText(`Defeated: ${defeated}`, 10, 42);
  ctx.fillText(`Lives: ${"▲".repeat(Math.max(0, player.lives))}`, 10, 62);
  ctx.fillText("Move: Arrow/WASD   Shot: Z/Space", 10, 82);

  // 道中が終わり、敵も全部いなくなったら表示（ボスはステップ7で接続）
  if (
    gameState === "playing" &&
    stageTime >= STAGE_DURATION &&
    enemies.length === 0
  ) {
    ctx.textAlign = "center";
    ctx.font = "28px monospace";
    ctx.fillText("STAGE CLEAR (道中)", WIDTH / 2, HEIGHT / 2);
    ctx.font = "14px monospace";
    ctx.fillText("ボスはステップ7で登場します", WIDTH / 2, HEIGHT / 2 + 28);
    ctx.textAlign = "left";
  }

  // ゲームオーバー画面
  if (gameState === "gameover") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "40px monospace";
    ctx.fillText("GAME OVER", WIDTH / 2, HEIGHT / 2 - 20);
    ctx.font = "16px monospace";
    ctx.fillText(`Defeated: ${defeated}`, WIDTH / 2, HEIGHT / 2 + 20);
    ctx.fillText("Z / Space でリスタート", WIDTH / 2, HEIGHT / 2 + 50);
    ctx.textAlign = "left";
  }
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

  accumulator += elapsed;
  while (accumulator >= STEP) {
    update(STEP);
    accumulator -= STEP;
  }

  render();

  fpsCount++;
  fpsTimer += elapsed;
  if (fpsTimer >= 1) {
    fps = fpsCount;
    fpsCount = 0;
    fpsTimer -= 1;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
