// ===================================================================
// ステップ9: 効果音と爆発エフェクト（演出）
//   - ショット／爆発／被弾の効果音（Web Audioで生成）
//   - 敵やボスを倒したときに破片が飛び散るエフェクト
// ===================================================================

import { STAGE_TIMELINE, STAGE_DURATION, type EnemyKind } from "./stage";
import { initAudio, playShot, playExplosion, playHit, playBossHit, playBossExplosion, playBomb, setMusic } from "./audio";

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
  initAudio(); // 最初のキー操作で音を有効化（ブラウザの制限対策）
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
const nearGround = makeLayer(5, 60, 95, 1.0, 1.9); // 近い地面（いちばん速い）

// 夜空のグラデーション（上＝濃い闇、下＝少し明るい地平線）。一度だけ作る。
const skyGradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
skyGradient.addColorStop(0, "#05050f");
skyGradient.addColorStop(0.7, "#070a18");
skyGradient.addColorStop(1, "#0d1226");

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
const PLAYER_SPEED = 260; // 1秒あたりに動くピクセル数
const PLAYER_RADIUS = 11; // 見た目／画面端で止まるときの半径

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
};
const particles: Particle[] = [];

// 指定位置で破片をまき散らす
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
    });
  }
}

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

// 怒りモード：HPがこの割合以下になると攻撃が激しくなる
const BOSS_ENRAGE_RATIO = 0.5; // 半分以下で発動
const BOSS_SWAY_SPEED_ENRAGED = 105; // 怒り時の左右移動の速さ
const BOSS_FIRE_INTERVAL_ENRAGED = 0.75; // 怒り時の攻撃間隔（短い＝激しい）

// phase … "enter"=入場中, "fight"=戦闘中
type Boss = {
  x: number;
  y: number;
  hp: number;
  phase: "enter" | "fight";
  dir: number; // 左右移動の向き（+1 か -1）
  fireTimer: number; // 次の攻撃までの残り秒
  patternIndex: number; // 次に使う攻撃パターン番号
  walk: number; // 歩行アニメの位相（増えるほど腕足が振れる）
  enraged: boolean; // 怒りモードに入ったか（HP半分以下で true）
};
let boss: Boss | null = null;
let bossSpawned = false; // このプレイで既にボスを出したか

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

// 種類ごとの爆発の色（撃破エフェクト用）
const ENEMY_EXPLOSION_COLOR: Record<EnemyKind, string> = {
  snail: "#e8c98f", // カタツムリ＝クリーム色
  snake: "#6cc456", // 蛇＝緑
  spider: "#d2453f", // 蜘蛛＝赤
};

// kind … 敵の種類、baseX … 揺れの基準になる横位置、age … 出現からの経過秒
// fireTimer … 次に弾を撃つまでの残り秒（蛇だけが使う）
type Enemy = {
  x: number;
  y: number;
  hp: number;
  kind: EnemyKind;
  baseX: number;
  age: number;
  fireTimer: number;
};
const enemies: Enemy[] = [];

// タイムライン進行用：ステージ開始からの経過秒と、次に処理するイベント番号
let stageTime = 0;
let nextEventIndex = 0;

// 敵を1体作る
function spawnEnemy(kind: EnemyKind, xRatio: number): void {
  const x = xRatio * WIDTH;
  // 蛇の発射タイミングを少しずらして、全部が同時に撃たないようにする
  const fireTimer = SNAKE_FIRE_INTERVAL * (0.6 + Math.random() * 0.8);
  enemies.push({ x, y: -ENEMY_RADIUS, hp: ENEMY_HP, kind, baseX: x, age: 0, fireTimer });
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
    walk: 0,
    enraged: false,
  };
  bossSpawned = true;
  setMusic("boss"); // ボス登場でBGMを切り替え
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

// ボム発動：画面全体を攻撃し、敵弾を消し、しばらく無敵になる
function useBomb(): void {
  player.bombs -= 1;
  bombFlash = BOMB_FLASH_TIME;
  player.invincible = Math.max(player.invincible, BOMB_INVINCIBLE_TIME);
  playBomb();

  // 画面内の雑魚を全部倒す（爆発と得点つき。アイテムは出ない）
  for (const e of enemies) {
    spawnExplosion(e.x, e.y, ENEMY_EXPLOSION_COLOR[e.kind], 14);
    score += SCORE_ENEMY;
    defeated += 1;
  }
  enemies.length = 0;

  // 飛んでいる敵弾を全部消す（緊急回避）
  enemyBullets.length = 0;

  // ボスがいれば大ダメージ
  if (boss) {
    boss.hp -= BOSS_BOMB_DAMAGE;
    spawnExplosion(boss.x, boss.y, "#ffffff", 20);
    if (boss.hp <= 0) {
      spawnExplosion(boss.x, boss.y, "#b15cff", 60);
      playBossExplosion();
      boss = null;
      score += SCORE_BOSS;
      gameState = "clear";
      resultLock = 0.8;
      saveHighScoreIfNeeded();
      setMusic(null);
    } else {
      playBossHit();
    }
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
  player.lean = 0;
  player.bombs = START_BOMBS;
  bombFlash = 0;
  bombKeyWasDown = false;
  shakeTime = 0;
  hitStop = 0;
  bullets.length = 0;
  enemies.length = 0;
  items.length = 0;
  enemyBullets.length = 0;
  particles.length = 0;
  boss = null;
  bossSpawned = false;
  stageTime = 0;
  nextEventIndex = 0;
  defeated = 0;
  score = 0;
  newRecord = false;
  gameState = "playing";
  setMusic("normal"); // 道中は通常BGM
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

  // ボムの閃光・画面の揺れを時間で弱めていく（どの状態でも進める）
  if (bombFlash > 0) bombFlash -= dt;
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

  // 首の傾きを、今の左右入力（-1/0/+1）へなめらかに近づける
  const leanTarget = Math.sign(dx);
  player.lean += (leanTarget - player.lean) * Math.min(1, dt * 12);

  // 画面の外に出ないように位置を制限する
  player.x = Math.max(PLAYER_RADIUS, Math.min(WIDTH - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(HEIGHT - PLAYER_RADIUS, player.y));

  // --- ショット ---
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (isDown("KeyZ", "Space") && player.fireCooldown <= 0) {
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

  // --- 敵の移動（種類ごとに動きが違う）---
  for (const e of enemies) {
    e.age += dt;
    if (e.kind === "snail") {
      // カタツムリ：ほとんど動かず、ゆっくり下りるだけ
      e.y += SNAIL_SPEED * dt;
    } else if (e.kind === "snake") {
      // 蛇：基準位置を中心に、サイン波で左右にくねりながら下りる
      e.y += ENEMY_SPEED * dt;
      e.x = e.baseX + Math.sin(e.age * SNAKE_FREQ) * SNAKE_AMPLITUDE;
      // 蛇だけ、画面内にいる間はたまに自機へ弾を撃つ
      e.fireTimer -= dt;
      if (e.fireTimer <= 0 && e.y > 0 && e.y < HEIGHT - 80) {
        const angle = Math.atan2(player.y - e.y, player.x - e.x);
        fireEnemyBullet(e.x, e.y, angle);
        e.fireTimer = SNAKE_FIRE_INTERVAL;
      }
    } else {
      // 蜘蛛：糸で上下に伸び縮みしながら（縦に動いて）下りる。
      // 速さをサイン波で増減させ、時には少し上に戻る＝縦のビヨンビヨン感を出す
      e.y += SPIDER_SPEED * (0.6 + Math.sin(e.age * SPIDER_FREQ)) * dt;
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
          spawnExplosion(e.x, e.y, ENEMY_EXPLOSION_COLOR[e.kind], 14);
          playExplosion();
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
    boss.walk += dt * 9; // 移動中ずっと腕と足を振り続ける

    // HPが半分以下になった瞬間、一度だけ怒りモードに入る
    if (!boss.enraged && boss.hp <= BOSS_MAX_HP * BOSS_ENRAGE_RATIO) {
      boss.enraged = true;
      spawnExplosion(boss.x, boss.y, "#ff3b3b", 30); // 赤い怒りの演出
      playBossHit();
    }

    if (boss.phase === "enter") {
      // 所定の高さまで下りてくる
      boss.y += BOSS_ENTER_SPEED * dt;
      if (boss.y >= BOSS_Y_TARGET) {
        boss.y = BOSS_Y_TARGET;
        boss.phase = "fight";
      }
    } else {
      // 怒りモードなら、左右移動も攻撃も激しくなる
      const swaySpeed = boss.enraged ? BOSS_SWAY_SPEED_ENRAGED : BOSS_SWAY_SPEED;
      const fireInterval = boss.enraged ? BOSS_FIRE_INTERVAL_ENRAGED : BOSS_FIRE_INTERVAL;

      // 左右に往復しながら、一定間隔で攻撃パターンを撃つ
      boss.x += boss.dir * swaySpeed * dt;
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
        // 怒り時は、通常の技に加えて自機を狙う弾も撃つ
        if (boss.enraged) bossPatternAimed(boss);
        boss.fireTimer = fireInterval;
      }
    }

    // 自分の弾 × ボス
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      if (hit(b.x, b.y, BULLET_RADIUS, boss.x, boss.y, BOSS_RADIUS)) {
        bullets.splice(bi, 1);
        boss.hp -= 1;
        if (boss.hp <= 0) {
          spawnExplosion(boss.x, boss.y, "#b15cff", 60); // 大きな爆発
          playBossExplosion();
          boss = null;
          score += SCORE_BOSS;
          gameState = "clear";
          resultLock = 0.8;
          saveHighScoreIfNeeded();
          setMusic(null); // クリアでBGMを止める
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
// 敵その1：カタツムリ（動かない敵）。(cx, cy) が中心。
// -------------------------------------------------------------------
function drawSnail(cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // 這う体（クリーム色）
  ctx.fillStyle = "#e8c98f";
  ctx.beginPath();
  ctx.ellipse(-1, 9, 15, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 頭（右前方）
  ctx.beginPath();
  ctx.ellipse(11, 3, 6, 6, 0, 0, Math.PI * 2);
  ctx.fill();

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

  // 触角2本＋先っぽの目
  ctx.strokeStyle = "#e8c98f";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(13, -1);
  ctx.lineTo(16, -8);
  ctx.moveTo(10, -2);
  ctx.lineTo(11, -9);
  ctx.stroke();
  ctx.fillStyle = "#1c1208";
  ctx.beginPath();
  ctx.arc(16, -8, 1.4, 0, Math.PI * 2);
  ctx.arc(11, -9, 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その2：蛇（横に動く敵）。(cx, cy) が中心。
// -------------------------------------------------------------------
function drawSnake(cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // くねった胴体（S字）
  ctx.strokeStyle = "#5fb84a";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-13, 11);
  ctx.quadraticCurveTo(3, 7, -3, -1);
  ctx.quadraticCurveTo(-8, -8, 7, -12);
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

  // 頭
  ctx.fillStyle = "#6cc456";
  ctx.beginPath();
  ctx.ellipse(8, -13, 6.5, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // 目
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(10, -15, 1.3, 0, Math.PI * 2);
  ctx.fill();
  // 舌（赤いちょろ）
  ctx.strokeStyle = "#e0506a";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(13, -14);
  ctx.lineTo(18, -15);
  ctx.moveTo(18, -15);
  ctx.lineTo(20, -16.5);
  ctx.moveTo(18, -15);
  ctx.lineTo(20, -13.5);
  ctx.stroke();

  ctx.restore();
}

// -------------------------------------------------------------------
// 敵その3：蜘蛛（縦に動く敵）。(cx, cy) が中心。上に糸が伸びる。
// -------------------------------------------------------------------
function drawSpider(cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // 上に伸びる糸
  ctx.strokeStyle = "rgba(210, 210, 220, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(0, -42);
  ctx.stroke();

  // 8本の脚（左右4本ずつ、ひざで折れる）
  ctx.strokeStyle = "#2b2b33";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const ly = -6 + i * 4.5;
      ctx.beginPath();
      ctx.moveTo(side * 4, ly);
      ctx.lineTo(side * 11, ly - 3);
      ctx.lineTo(side * 16, ly + 4);
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

// 敵を種類に応じた姿で描く
function drawEnemy(e: Enemy): void {
  if (e.kind === "snail") drawSnail(e.x, e.y);
  else if (e.kind === "snake") drawSnake(e.x, e.y);
  else drawSpider(e.x, e.y);
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

// 近い地面（暗い緑の島。ふちをうっすら明るく）
function drawGround(d: Deco): void {
  const s = d.scale;
  ctx.fillStyle = "#102219";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y, 50 * s, 30 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(95, 165, 115, 0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

// -------------------------------------------------------------------
// render: 今の状態を画面に描く
// -------------------------------------------------------------------
function render(): void {
  // 背景の夜空（グラデーション）
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // いちばん奥：遠い山
  for (const d of farHills) drawHill(d);

  // 星
  ctx.fillStyle = "#aab4ff";
  for (const s of stars) {
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }

  // 中間：流れる雲
  for (const d of clouds) drawCloud(d);

  // 手前：近い地面の島
  for (const d of nearGround) drawGround(d);

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
    ctx.fillText("移動: 矢印/WASD   ショット: Z/Space", WIDTH / 2, HEIGHT - 52);
    ctx.fillText("ボム（緊急回避）: X / Shift", WIDTH / 2, HEIGHT - 34);
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

  // パワーアップアイテム（キャベツ）
  for (const it of items) {
    drawCabbage(it.x, it.y);
  }

  // ボス（腕と足が動くゴリラ）＋ HPバー
  if (boss) {
    drawGorillaBoss(boss.x, boss.y, boss.walk, boss.enraged);
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

  // 爆発の破片（寿命に応じてだんだん透明に）
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1; // 透明度を元に戻す

  // 自機のショット
  ctx.fillStyle = "#fff36b";
  for (const b of bullets) {
    ctx.fillRect(b.x - 2, b.y - 8, 4, 12);
  }

  // 自機（頭がキリン・体が亀のふしぎな生きもの。上＝進行方向）。
  // 無敵中だけ点滅させ、それ以外は常に表示。ゲームオーバー中は描かない。
  const blinkVisible =
    player.invincible <= 0 || Math.floor(player.invincible * 10) % 2 === 0;
  if (gameState !== "gameover" && blinkVisible) {
    drawPlayerGiraffeTurtle(player.x, player.y, player.lean);
  }

  // ボムの閃光（画面全体が白く光り、衝撃波の輪が広がる）
  if (bombFlash > 0) {
    const t = bombFlash / BOMB_FLASH_TIME; // 1 → 0 へ
    ctx.save();
    ctx.globalAlpha = t * 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = t;
    ctx.strokeStyle = "#bfe9ff";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(player.x, player.y, (1 - t) * Math.max(WIDTH, HEIGHT), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ここでゲーム世界の揺れを終了（以降のHUDや決着表示は揺らさない）
  ctx.restore();

  // プレイ中の情報表示（スコア・残機・パワー）
  ctx.fillStyle = "#ffffff";
  ctx.font = "14px monospace";
  ctx.fillText(`SCORE ${score}`, 10, 38);
  ctx.fillText(`HI ${highScore}`, 10, 56);
  ctx.fillText(`Lives: ${"▲".repeat(Math.max(0, player.lives))}`, 10, 74);
  ctx.fillText(`Power: ${player.power} / ${POWER_MAX}`, 10, 92);
  ctx.fillText(`Bomb: ${player.bombs > 0 ? "●".repeat(player.bombs) : "なし"}`, 10, 110);

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

  // ヒットストップ中はゲームの進行を止め、描画だけ続ける（被弾の「ため」）
  if (hitStop > 0) {
    hitStop -= elapsed;
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
