import { defineConfig } from "vite";

// GitHub Pages の公開URLは
//   https://<ユーザー名>.github.io/vertical-shooter/
// なので、本番ビルド時だけ base をリポジトリ名に合わせます。
// （ローカル開発 npm run dev では "/" のままで快適に動きます）
//
// ※リポジトリ名を変えたら、下の "/vertical-shooter/" も合わせて変更してください。
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/vertical-shooter/" : "/",
}));
