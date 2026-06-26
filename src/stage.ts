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
//   "snail"  … カタツムリ。ほとんど動かず、ゆっくり這うように下りてくる
//   "snake"  … 蛇。左右にくねくね横移動しながら下りてくる
//   "spider" … 蜘蛛。糸で上下にビヨンと伸び縮みしながら（縦に動いて）下りてくる
//   "eagle"  … 鷲。ランダムにふらふら動き回りながら、自機へ弾を撃ってくる
export type EnemyKind = "snail" | "snake" | "spider" | "eagle";

// ボスの種類
//   "gorilla"        … ゴリラ（ステージ1）。腕足が動く
//   "machineGorilla" … 機械のゴリラ（ステージ2）。攻撃が多彩で硬い
export type BossKind = "gorilla" | "machineGorilla";

// 背景のテーマ
//   "night" … 夜空（星・遠い山・暗い島）
//   "sky"   … 地球の空（水色・白い雲・海・緑の島）
export type StageTheme = "night" | "sky";

// 1回の出現イベント
//   time … ステージ開始からの秒数
//   kind … 敵の種類
//   x    … 横位置（0.0 = 左端、0.5 = 中央、1.0 = 右端）
export type SpawnEvent = { time: number; kind: EnemyKind; x: number };

// 1つのステージのまとまり
//   name     … 画面に出すステージ名
//   theme    … 背景テーマ
//   boss     … 最後に出るボスの種類
//   duration … 道中の長さ（秒）。これを過ぎ、雑魚を片付けたらボス登場
//   timeline … 敵の出現データ（time の昇順に並べる）
export type Stage = {
  name: string;
  theme: StageTheme;
  boss: BossKind;
  duration: number;
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
  timeline: [
    // 序盤：ゆっくりなカタツムリで肩慣らし
    { time: 1.0, kind: "snail", x: 0.5 },
    { time: 1.8, kind: "snail", x: 0.35 },
    { time: 1.8, kind: "snail", x: 0.65 },
    { time: 3.0, kind: "snail", x: 0.2 },
    { time: 3.4, kind: "snail", x: 0.4 },
    { time: 3.8, kind: "snail", x: 0.6 },
    { time: 4.2, kind: "snail", x: 0.8 },

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

    // 中盤：混ぜる
    { time: 9.5, kind: "snake", x: 0.4 },
    { time: 9.5, kind: "snake", x: 0.6 },
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

// プレイする順番にステージを並べる（先頭から順に連戦）
export const STAGES: Stage[] = [STAGE1, STAGE2];
