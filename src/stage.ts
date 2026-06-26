// ===================================================================
// ステージ構成データ（ロジックとは分離）
//
// 「ステージ開始から何秒後に・どんな敵を・横のどの位置に出すか」を
// 一覧で書きます。ここの数字を変えるだけで道中を調整できます。
// （ゲーム本体 main.ts を触る必要はありません）
// ===================================================================

// 敵の種類
//   "snail"  … カタツムリ。ほとんど動かず、ゆっくり這うように下りてくる
//   "snake"  … 蛇。左右にくねくね横移動しながら下りてくる
//   "spider" … 蜘蛛。糸で上下にビヨンと伸び縮みしながら（縦に動いて）下りてくる
export type EnemyKind = "snail" | "snake" | "spider";

// 1回の出現イベント
//   time … ステージ開始からの秒数
//   kind … 敵の種類
//   x    … 横位置（0.0 = 左端、0.5 = 中央、1.0 = 右端）
export type SpawnEvent = { time: number; kind: EnemyKind; x: number };

// ステージのタイムライン（time の昇順に並べておく）
export const STAGE_TIMELINE: SpawnEvent[] = [
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
];

// このステージの道中の長さ（秒）。これを過ぎたら道中終了。
// ※ボスはステップ7でこの後ろに繋げます。
export const STAGE_DURATION = 16.0;
