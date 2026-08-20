# 「ゴリラ、また来た。」（縦スクロール・シューティング／開発終了）

> **⚠️ 2026-08-21 に開発終了。** 公開サイト（GitHub Pages）はそのまま残っている。

ブラウザで遊べる縦スクロール・シューティングゲーム。ポートフォリオとして公開するのがゴールだった。
各ステージのボスが全部ゴリラなのをネタにしたタイトル。

| | |
|---|---|
| 公開URL | https://yuichi0306.github.io/vertical-shooter/ |
| GitHub | `yuichi0306/vertical-shooter` |

## 動かし方

```bash
npm run dev     # http://localhost:5173/ 保存すると自動反映。止めるのは Ctrl+C
npm run build   # 公開用ビルド（型チェックも兼ねる）
```

技術：TypeScript + Vite。

## 公開の流れ

1. コードを直す
2. **`npm run build` を通してからコミットする**（エラーが無いことの確認）
3. コミットメッセージは日本語、先頭に `feat:` / `fix:`
4. **push すると GitHub Pages に自動反映**（1分ほど）。⚠️ push は指示があったときだけ

## ハマりどころ・ルール

- **当たり判定の定数（`PLAYER_RADIUS` など）は触らない。** 見た目を変えても遊びごこちが変わらないように
- `node_modules` と `dist` は Git に入れない（`.gitignore` 済み）
- **`public/`（`manual.html` / `manual.pdf`）は Git に入れる**（公開サイトで配るため）
- `引き継ぎ書.md` と `説明書.md` は手元メモなので Git 未登録のまま

## 詳細

ファイルの中身・実装の経緯・アップデート候補は **`引き継ぎ書.md`**（約27,000字）。
必要になったときに読む。
