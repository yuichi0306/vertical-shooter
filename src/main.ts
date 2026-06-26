// ===================================================================
// ステップ8: タイトル画面・スコア・ハイスコア保存
//   - タイトル → ゲーム → 決着 → タイトル の流れ
//   - スコアを加算、ハイスコアをブラウザ(localStorage)に保存
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
  power: 1, // ショットの強化段階（1〜POWER_MAX）
};

// ゲーム全体の状態。
type GameState = "title" | "playing" | "gameover" | "clear";
let gameState: GameState = "title"; // 起動時はタイトル画面から
let resultLock = 0; // 決着直後、入力を受け付けない時間（秒）
let titleLock = 0; // タイトルに戻った直後、入力を受け付けない時間（秒）

// スコア
const SCORE_ENEMY = 100; // 雑魚1体撃破
const SCORE_BOSS = 5000; // ボス撃破
let score = 0;

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
type Bullet = { x: number; y: number; vx: number; vy: number };
const bullets: Bullet[] = [];

// パワーアップ
const POWER_MAX = 3; // 最大強化段階
const ITEM_DROP_RATE = 0.15; // 敵撃破時にアイテムが出る確率（0.15 = 15%）
const ITEM_RADIUS = 10; // アイテムの大きさ／当たり判定
const ITEM_SPEED = 90; // アイテムが下りる速さ（px/秒）

type Item = { x: number; y: number };
const items: Item[] = [];

// -------------------------------------------------------------------
// 敵の弾（ボスが撃ってくる弾。自機に当たる）
// -------------------------------------------------------------------
const EBULLET_RADIUS = 6;
type EnemyBullet = { x: number; y: number; vx: number; vy: number };
const enemyBullets: EnemyBullet[] = [];

// -------------------------------------------------------------------
// ボス
// -------------------------------------------------------------------
const BOSS_MAX_HP = 80; // ボスの体力
const BOSS_RADIUS = 38; // 見た目／当たり判定
const BOSS_Y_TARGET = 110; // 入場後に留まる高さ
const BOSS_ENTER_SPEED = 70; // 入場で下りてくる速さ
const BOSS_SWAY_SPEED = 60; // 戦闘中に左右へ動く速さ
const BOSS_FIRE_INTERVAL = 1.4; // 攻撃と攻撃の間隔（秒）
const EBULLET_SPEED = 190; // 敵弾の速さ

// phase … "enter"=入場中, "fight"=戦闘中
type Boss = {
  x: number;
  y: number;
  hp: number;
  phase: "enter" | "fight";
  dir: number; // 左右移動の向き（+1 か -1）
  fireTimer: number; // 次の攻撃までの残り秒
  patternIndex: number; // 次に使う攻撃パターン番号
};
let boss: Boss | null = null;
let bossSpawned = false; // このプレイで既にボスを出したか

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

// 自機のショットを撃つ。強化段階で弾の数と広がりが変わる。
function fireShot(): void {
  const y = player.y - 16;
  if (player.power >= 3) {
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
}

// ボスを登場させる
function spawnBoss(): void {
  boss = {
    x: WIDTH / 2,
    y: -BOSS_RADIUS,
    hp: BOSS_MAX_HP,
    phase: "enter",
    dir: 1,
    fireTimer: BOSS_FIRE_INTERVAL,
    patternIndex: 0,
  };
  bossSpawned = true;
}

// 敵弾を1発、指定の向き（角度ラジアン）に撃つ
function fireEnemyBullet(x: number, y: number, angle: number): void {
  enemyBullets.push({
    x,
    y,
    vx: Math.cos(angle) * EBULLET_SPEED,
    vy: Math.sin(angle) * EBULLET_SPEED,
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

// 攻撃パターンの一覧（ここに足せば技が増える）
const BOSS_PATTERNS = [bossPatternAimed, bossPatternFan];

// 自機がダメージを受けたときの共通処理（敵との接触・敵弾の両方から呼ぶ）
function damagePlayer(): void {
  player.lives -= 1;
  player.power = Math.max(1, player.power - 1); // 被弾で1段階ダウン
  if (player.lives <= 0) {
    gameState = "gameover";
    resultLock = 0.8; // 誤リスタート防止
    saveHighScoreIfNeeded();
  } else {
    player.invincible = INVINCIBLE_TIME; // しばらく無敵で復活
  }
}

// ゲームを最初の状態に戻す（開始時とリスタート時に呼ぶ）
function resetGame(): void {
  player.x = WIDTH / 2;
  player.y = HEIGHT - 90;
  player.fireCooldown = 0;
  player.lives = START_LIVES;
  player.invincible = 0;
  player.power = 1;
  bullets.length = 0;
  enemies.length = 0;
  items.length = 0;
  enemyBullets.length = 0;
  boss = null;
  bossSpawned = false;
  stageTime = 0;
  nextEventIndex = 0;
  defeated = 0;
  score = 0;
  newRecord = false;
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

  // タイトル画面：キーでゲーム開始
  if (gameState === "title") {
    if (titleLock > 0) titleLock -= dt;
    else if (isDown("KeyZ", "Space", "Enter")) resetGame();
    return;
  }

  // 決着後（ゲームオーバー / クリア）は、キーでタイトルへ戻る
  if (gameState === "gameover" || gameState === "clear") {
    if (resultLock > 0) resultLock -= dt;
    else if (isDown("KeyZ", "Space", "Enter")) {
      gameState = "title";
      titleLock = 0.4; // 押しっぱなしで即スタートしないように
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

  player.x += dx * PLAYER_SPEED * dt;
  player.y += dy * PLAYER_SPEED * dt;

  // 画面の外に出ないように位置を制限する
  player.x = Math.max(PLAYER_RADIUS, Math.min(WIDTH - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(HEIGHT - PLAYER_RADIUS, player.y));

  // --- ショット ---
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (isDown("KeyZ", "Space") && player.fireCooldown <= 0) {
    fireShot();
    player.fireCooldown = FIRE_INTERVAL;
  }

  // 弾を向きに沿って進める
  for (const b of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  // 画面の外（上・左右）に出た弾を消す
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (b.y < -10 || b.x < -10 || b.x > WIDTH + 10) bullets.splice(i, 1);
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
          score += SCORE_ENEMY;
          // 一定確率でパワーアップアイテムを落とす
          if (Math.random() < ITEM_DROP_RATE) {
            items.push({ x: e.x, y: e.y });
          }
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
      player.power = Math.min(POWER_MAX, player.power + 1); // 1段階アップ
    } else if (it.y > HEIGHT + ITEM_RADIUS) {
      items.splice(i, 1); // 拾えず画面下へ
    }
  }

  // --- 当たり判定：敵 × 自機（無敵中は当たらない）---
  if (player.invincible <= 0) {
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (hit(player.x, player.y, PLAYER_RADIUS, e.x, e.y, ENEMY_RADIUS)) {
        enemies.splice(ei, 1); // ぶつかった敵は壊れる
        damagePlayer();
        break;
      }
    }
  }

  // --- 画面の下に出た敵を消す ---
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].y > HEIGHT + ENEMY_RADIUS) enemies.splice(i, 1);
  }

  // --- ボスの登場：道中が終わり、雑魚を全部片付けたら出現 ---
  if (!bossSpawned && stageTime >= STAGE_DURATION && enemies.length === 0) {
    spawnBoss();
  }

  // --- ボスの行動 ---
  if (boss) {
    if (boss.phase === "enter") {
      // 所定の高さまで下りてくる
      boss.y += BOSS_ENTER_SPEED * dt;
      if (boss.y >= BOSS_Y_TARGET) {
        boss.y = BOSS_Y_TARGET;
        boss.phase = "fight";
      }
    } else {
      // 左右に往復しながら、一定間隔で攻撃パターンを撃つ
      boss.x += boss.dir * BOSS_SWAY_SPEED * dt;
      if (boss.x < BOSS_RADIUS) {
        boss.x = BOSS_RADIUS;
        boss.dir = 1;
      } else if (boss.x > WIDTH - BOSS_RADIUS) {
        boss.x = WIDTH - BOSS_RADIUS;
        boss.dir = -1;
      }

      boss.fireTimer -= dt;
      if (boss.fireTimer <= 0) {
        BOSS_PATTERNS[boss.patternIndex](boss);
        boss.patternIndex = (boss.patternIndex + 1) % BOSS_PATTERNS.length;
        boss.fireTimer = BOSS_FIRE_INTERVAL;
      }
    }

    // 自分の弾 × ボス
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      if (hit(b.x, b.y, BULLET_RADIUS, boss.x, boss.y, BOSS_RADIUS)) {
        bullets.splice(bi, 1);
        boss.hp -= 1;
        if (boss.hp <= 0) {
          boss = null;
          score += SCORE_BOSS;
          gameState = "clear";
          resultLock = 0.8;
          saveHighScoreIfNeeded();
          break;
        }
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

  // タイトル画面（流れる星の上にタイトルだけ表示）
  if (gameState === "title") {
    ctx.textAlign = "center";
    ctx.fillStyle = "#5cff9d";
    ctx.font = "bold 34px monospace";
    ctx.fillText("VERTICAL", WIDTH / 2, HEIGHT / 2 - 70);
    ctx.fillText("SHOOTER", WIDTH / 2, HEIGHT / 2 - 30);
    ctx.fillStyle = "#ffffff";
    ctx.font = "16px monospace";
    ctx.fillText(`HI-SCORE  ${highScore}`, WIDTH / 2, HEIGHT / 2 + 20);
    ctx.fillText("Z / Space でスタート", WIDTH / 2, HEIGHT / 2 + 60);
    ctx.font = "12px monospace";
    ctx.fillText("移動: 矢印/WASD   ショット: Z/Space", WIDTH / 2, HEIGHT - 40);
    ctx.textAlign = "left";
    return; // タイトル中はここで描画終了
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

  // パワーアップアイテム（青い四角に P）
  for (const it of items) {
    ctx.fillStyle = "#3da9ff";
    ctx.fillRect(it.x - ITEM_RADIUS, it.y - ITEM_RADIUS, ITEM_RADIUS * 2, ITEM_RADIUS * 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("P", it.x, it.y + 5);
    ctx.textAlign = "left";
  }

  // ボス（紫の大きな四角）＋ HPバー
  if (boss) {
    ctx.fillStyle = "#b15cff";
    ctx.fillRect(
      boss.x - BOSS_RADIUS,
      boss.y - BOSS_RADIUS,
      BOSS_RADIUS * 2,
      BOSS_RADIUS * 2,
    );
    // 画面上部のHPバー
    const barW = WIDTH - 40;
    const ratio = Math.max(0, boss.hp / BOSS_MAX_HP);
    ctx.fillStyle = "#3a1a3a";
    ctx.fillRect(20, 12, barW, 10);
    ctx.fillStyle = "#ff5cc8";
    ctx.fillRect(20, 12, barW * ratio, 10);
  }

  // 敵の弾（赤いまる）
  ctx.fillStyle = "#ff4d4d";
  for (const eb of enemyBullets) {
    ctx.beginPath();
    ctx.arc(eb.x, eb.y, EBULLET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
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

  // プレイ中の情報表示（スコア・残機・パワー）
  ctx.fillStyle = "#ffffff";
  ctx.font = "14px monospace";
  ctx.fillText(`SCORE ${score}`, 10, 38);
  ctx.fillText(`HI ${highScore}`, 10, 56);
  ctx.fillText(`Lives: ${"▲".repeat(Math.max(0, player.lives))}`, 10, 74);
  ctx.fillText(`Power: ${player.power} / ${POWER_MAX}`, 10, 92);

  // 「WARNING」表示：ボス入場中の演出
  if (boss && boss.phase === "enter") {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff5cc8";
    ctx.font = "bold 30px monospace";
    ctx.fillText("WARNING", WIDTH / 2, HEIGHT / 2);
    ctx.textAlign = "left";
  }

  // 決着画面（ゲームオーバー / クリア）
  if (gameState === "gameover" || gameState === "clear") {
    const cleared = gameState === "clear";
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = "center";
    ctx.fillStyle = cleared ? "#7dff9d" : "#ffffff";
    ctx.font = "40px monospace";
    ctx.fillText(cleared ? "STAGE CLEAR!" : "GAME OVER", WIDTH / 2, HEIGHT / 2 - 50);
    ctx.fillStyle = "#ffffff";
    ctx.font = "18px monospace";
    ctx.fillText(`SCORE  ${score}`, WIDTH / 2, HEIGHT / 2);
    ctx.fillText(`HI-SCORE  ${highScore}`, WIDTH / 2, HEIGHT / 2 + 26);
    if (newRecord) {
      ctx.fillStyle = "#fff36b";
      ctx.fillText("NEW RECORD!", WIDTH / 2, HEIGHT / 2 + 54);
    }
    ctx.fillStyle = "#bbbbbb";
    ctx.font = "14px monospace";
    ctx.fillText("Z / Space でタイトルへ", WIDTH / 2, HEIGHT / 2 + 90);
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

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
