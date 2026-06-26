import { defineConfig } from "vite";

// GitHub Pages で公開するときは、リポジトリ名に合わせて base を変更します。
// 例: リポジトリ名が "vertical-shooter" なら base: "/vertical-shooter/"
// ローカル開発中は "/" のままでOK。
export default defineConfig({
  base: "/",
});
