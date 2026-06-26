// ===================================================================
// ステップ2: 自機の操作（移動とショット）
//   - 矢印キー / WASD で移動
//   - Z または スペース でショット
// ===================================================================

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

const player = {
  x: WIDTH / 2,
  y: HEIGHT - 90,
  fireCooldown: 0, // 次に撃てるようになるまでの残り時間（秒）
};

// -------------------------------------------------------------------
// 自機のショット（弾）
// -------------------------------------------------------------------
const BULLET_SPEED = 560; // 上へ進む速さ（px/秒）
const FIRE_INTERVAL = 0.12; // 連射の間隔（秒）。小さいほど速く撃てる

type Bullet = { x: number; y: number };
const bullets: Bullet[] = [];

// FPS計測用
let fps = 0;
let fpsTimer = 0;
let fpsCount = 0;

// -------------------------------------------------------------------
// update: ゲームの状態を「STEP秒ぶん」進める（固定タイムステップ）
// -------------------------------------------------------------------
function update(dt: number): void {
  // --- 背景の星 ---
  for (const s of stars) {
    s.y += s.speed * dt;
    if (s.y > HEIGHT) {
      s.y -= HEIGHT;
      s.x = Math.random() * WIDTH;
    }
  }

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

  // 自機のショット
  ctx.fillStyle = "#fff36b";
  for (const b of bullets) {
    ctx.fillRect(b.x - 2, b.y - 8, 4, 12);
  }

  // 自機（上向きの三角形）
  ctx.fillStyle = "#5cff9d";
  ctx.beginPath();
  ctx.moveTo(player.x, player.y - 14);
  ctx.lineTo(player.x - 11, player.y + 12);
  ctx.lineTo(player.x + 11, player.y + 12);
  ctx.closePath();
  ctx.fill();

  // 動作確認用の文字
  ctx.fillStyle = "#ffffff";
  ctx.font = "14px monospace";
  ctx.fillText(`FPS: ${fps}`, 10, 22);
  ctx.fillText("Move: Arrow/WASD   Shot: Z/Space", 10, 42);
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
