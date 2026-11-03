# チェーン店クエスト

地図上のチェーン店をつないでルートを描く Web アプリです。

## 公開 URL

- GitHub: https://github.com/harunaka726-coder/chain-store-quest
- GitHub Pages: https://harunaka726-coder.github.io/chain-store-quest/
- Vercel: リポジトリを Import するか、`npx vercel login` 後に `npx vercel --prod` で本番デプロイ

## ローカル起動

```bash
python -m http.server 8080
```

## ページ

- `/` — メイン
- `/howto.html` — 遊び方
- `/privacy.html` — プライバシーポリシー

## 技術

- Leaflet + OpenStreetMap（Nominatim / Overpass）
- 静的ホスト（GitHub Pages / Vercel）
