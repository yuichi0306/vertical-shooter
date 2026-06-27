// ===================================================================
// ステージ構成データ（ロジックとは分離）
//
// 「ステージ開始から何秒後に・どんな敵を・横のどの位置に出すか」を
// 一覧で書きます。ここの数字を変えるだけで道中を調整できます。
// （ゲーム本体 main.ts を触る必要はありません）
//
// このゲームは複数ステージの「連戦」です。
//   STAGES に並べた順番でプレイし、各ステージの最後にボスが出ます。
//   ボスを倒すと次のステージへ。最後のステージのボスを倒すとクリア。
// ===================================================================

// 敵の種類
//   "snail"     … カタツムリ。ほとんど動かず、ゆっくり這うように下りてくる
//   "snake"     … 蛇。左右にくねくね横移動しながら下りてくる
//   "spider"    … 蜘蛛。糸で上下にビヨンと伸び縮みしながら（縦に動いて）下りてくる
//   "eagle"     … 鷲。ランダムにふらふら動き回りながら、自機へ弾を撃ってくる
//   "goldpig"   … 黄金の豚（レア）。1ステージに1匹だけ。画面を横切るように飛ぶ。
//                 少し硬く、倒すとボムを落とし、得点は通常の2倍
//   "jellyfish" … クラゲ（ステージ3）。蛇と同じ動き（くねりながら弾を撃つ）
//   "tuna"      … マグロ（ステージ3）。まっすぐしか進まないが速い（黄金の豚の2倍速）
//   "squid"     … イカ（ステージ3）。鷲と同じ動き（ふらふら動いて弾を撃つ）
//   "angel"     … エンジェル（お助けキャラ／ステージ2）。黄金の豚＋上下の動きで横切る。
//                 倒す相手ではなく、触れると残機(ハート)が1増える
export type EnemyKind =
  | "snail"
  | "snake"
  | "spider"
  | "eagle"
  | "goldpig"
  | "jellyfish"
  | "tuna"
  | "squid"
  | "angel";

// ボスの種類
//   "gorilla"        … ゴリラ（ステージ1）。腕足が動く
//   "machineGorilla" … 機械のゴリラ（ステージ2）。攻撃が多彩で硬い
//   "scubaGorilla"   … 酸素ボンベのゴリラ（ステージ3）。機械ゴリラの動き＋たまに突進
export type BossKind = "gorilla" | "machineGorilla" | "scubaGorilla";

// 背景のテーマ
//   "night" … 夜空（星・遠い山・暗い島）
//   "sky"   … 地球の空（水色・白い雲・海・緑の島）
//   "sea"   … 海の中（青い水・泡・差し込む光・海藻）
export type StageTheme = "night" | "sky" | "sea";

// BGMの種類（実体は audio.ts。ここでは型だけ借りる）
import type { MusicTrack } from "./audio";

// 1回の出現イベント
//   time … ステージ開始からの秒数
//   kind … 敵の種類
//   x    … 横位置（0.0 = 左端、0.5 = 中央、1.0 = 右端）
export type SpawnEvent = { time: number; kind: EnemyKind; x: number };

// 1つのステージのまとまり
//   name     … 画面に出すステージ名
//   theme    … 背景テーマ
//   boss     … 最後に出るボスの種類
//   duration    … 道中の長さ（秒）。これを過ぎ、雑魚を片付けたらボス登場
//   normalMusic … 道中のBGM、bossMusic … ボス戦のBGM（曲は audio.ts）
//   timeline    … 敵の出現データ（time の昇順に並べる）
export type Stage = {
  name: string;
  theme: StageTheme;
  boss: BossKind;
  duration: number;
  normalMusic: MusicTrack;
  bossMusic: MusicTrack;
  timeline: SpawnEvent[];
};

// -------------------------------------------------------------------
// ステージ1：夜空。カタツムリ・蛇・蜘蛛 ＋ ゴリラのボス
// -------------------------------------------------------------------
const STAGE1: Stage = {
  name: "STAGE 1",
  theme: "night",
  boss: "gorilla",
  duration: 16.0,
  normalMusic: "normal",
  bossMusic: "boss",
  timeline: [
    // 序盤：ゆっくりなカタツムリで肩慣らし
    { time: 1.0, kind: "snail", x: 0.5 },
    { time: 1.8, kind: "snail", x: 0.35 },
    { time: 1.8, kind: "snail", x: 0.65 },
    { time: 3.0, kind: "snail", x: 0.2 },
    { time: 3.4, kind: "snail", x: 0.4 },
    { time: 3.8, kind: "snail", x: 0.6 },
    { time: 4.2, kind: "snail", x: 0.8 },

    // レアな黄金の豚（このステージに1匹だけ。左から飛んでくる）
    { time: 5.0, kind: "goldpig", x: 0.0 },

    // 中盤：横にくねる蛇を混ぜる
    { time: 6.0, kind: "snake", x: 0.25 },
    { time: 6.0, kind: "snake", x: 0.75 },
    { time: 8.0, kind: "snake", x: 0.5 },
    { time: 9.0, kind: "snail", x: 0.15 },
    { time: 9.0, kind: "snail", x: 0.85 },

    // 縦に動く蜘蛛が登場
    { time: 10.5, kind: "spider", x: 0.35 },
    { time: 10.5, kind: "spider", x: 0.65 },

    // 終盤：3種をまぜて山場を作る
    { time: 11.0, kind: "snake", x: 0.2 },
    { time: 11.4, kind: "spider", x: 0.5 },
    { time: 11.8, kind: "snake", x: 0.8 },
    { time: 12.2, kind: "spider", x: 0.4 },
    { time: 12.2, kind: "spider", x: 0.6 },
    { time: 13.5, kind: "snail", x: 0.3 },
    { time: 13.5, kind: "snake", x: 0.5 },
    { time: 13.5, kind: "spider", x: 0.7 },
  ],
};

// -------------------------------------------------------------------
// ステージ2：地球の空。カタツムリ無し・蛇・蜘蛛・鷲 ＋ 機械ゴリラのボス
// -------------------------------------------------------------------
const STAGE2: Stage = {
  name: "STAGE 2",
  theme: "sky",
  boss: "machineGorilla",
  duration: 18.0,
  normalMusic: "normal2", // 颯爽とした疾走感のBGM
  bossMusic: "boss2", // 颯爽・勇ましいボスBGM
  timeline: [
    // 序盤：蛇と蜘蛛で
    { time: 1.0, kind: "snake", x: 0.3 },
    { time: 1.0, kind: "snake", x: 0.7 },
    { time: 2.5, kind: "spider", x: 0.5 },
    { time: 3.5, kind: "snake", x: 0.2 },
    { time: 3.5, kind: "snake", x: 0.8 },

    // 鷲が登場（ふらふら動いて弾を撃つ）
    { time: 5.0, kind: "eagle", x: 0.5 },
    { time: 6.5, kind: "spider", x: 0.3 },
    { time: 6.5, kind: "spider", x: 0.7 },
    { time: 7.5, kind: "eagle", x: 0.2 },
    { time: 8.0, kind: "eagle", x: 0.8 },

    // レアな黄金の豚（このステージに1匹だけ。右から飛んでくる）
    { time: 9.0, kind: "goldpig", x: 1.0 },

    // 中盤：混ぜる
    { time: 9.5, kind: "snake", x: 0.4 },
    { time: 9.5, kind: "snake", x: 0.6 },

    // お助けキャラ「エンジェル」（左から登場。触れると残機+1）
    { time: 10.0, kind: "angel", x: 0.0 },

    { time: 11.0, kind: "eagle", x: 0.5 },
    { time: 11.0, kind: "spider", x: 0.5 },

    // 終盤：山場
    { time: 12.5, kind: "snake", x: 0.2 },
    { time: 12.8, kind: "eagle", x: 0.5 },
    { time: 13.1, kind: "snake", x: 0.8 },
    { time: 14.0, kind: "spider", x: 0.3 },
    { time: 14.0, kind: "spider", x: 0.7 },
    { time: 14.5, kind: "eagle", x: 0.5 },
    { time: 15.5, kind: "eagle", x: 0.25 },
    { time: 15.5, kind: "eagle", x: 0.75 },
    { time: 16.0, kind: "snake", x: 0.5 },
  ],
};

// -------------------------------------------------------------------
// ステージ3：海の中。クラゲ・マグロ・イカ ＋ 酸素ボンベのゴリラのボス
// -------------------------------------------------------------------
const STAGE3: Stage = {
  name: "STAGE 3",
  theme: "sea",
  boss: "scubaGorilla",
  duration: 19.0,
  normalMusic: "normal3", // 優雅でゆったりした道中曲
  bossMusic: "boss3", // コミカルで弾むボス曲
  timeline: [
    // 序盤：クラゲ（くねりながら撃つ）で肩慣らし
    { time: 1.0, kind: "jellyfish", x: 0.3 },
    { time: 1.0, kind: "jellyfish", x: 0.7 },
    { time: 2.5, kind: "jellyfish", x: 0.5 },

    // 速いマグロが突っ込んでくる（まっすぐ・高速）
    { time: 3.5, kind: "tuna", x: 0.5 },
    { time: 4.5, kind: "tuna", x: 0.25 },
    { time: 4.8, kind: "tuna", x: 0.75 },

    // イカ登場（ふらふら動いて撃つ）
    { time: 6.0, kind: "squid", x: 0.5 },
    { time: 7.0, kind: "jellyfish", x: 0.2 },
    { time: 7.0, kind: "jellyfish", x: 0.8 },

    // レアな黄金の豚（このステージに1匹だけ。右から飛んでくる）
    { time: 8.5, kind: "goldpig", x: 1.0 },
    { time: 9.0, kind: "tuna", x: 0.4 },
    { time: 9.3, kind: "tuna", x: 0.6 },
    { time: 10.5, kind: "squid", x: 0.3 },
    { time: 10.5, kind: "squid", x: 0.7 },

    // 中盤〜終盤：3種を混ぜて山場へ
    { time: 12.0, kind: "jellyfish", x: 0.5 },
    { time: 12.5, kind: "tuna", x: 0.2 },
    { time: 12.8, kind: "tuna", x: 0.8 },
    { time: 13.5, kind: "squid", x: 0.5 },
    { time: 14.5, kind: "jellyfish", x: 0.3 },
    { time: 14.5, kind: "jellyfish", x: 0.7 },
    { time: 15.5, kind: "tuna", x: 0.5 },
    { time: 16.0, kind: "squid", x: 0.25 },
    { time: 16.0, kind: "squid", x: 0.75 },
    { time: 17.0, kind: "tuna", x: 0.35 },
    { time: 17.0, kind: "tuna", x: 0.65 },
  ],
};

// プレイする順番にステージを並べる（先頭から順に連戦）
export const STAGES: Stage[] = [STAGE1, STAGE2, STAGE3];
