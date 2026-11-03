# チェーン店クエスト

地図上のチェーン店をつないでルートを描く Web アプリです。

## ローカル起動

```bash
python -m http.server 8080
```

[http://localhost:8080](http://localhost:8080)

## ページ

- `/` — メイン
- `/howto.html` — 遊び方
- `/privacy.html` — プライバシーポリシー

## 技術

- Leaflet + OpenStreetMap（Nominatim / Overpass）
- 静的ホスト（Vercel 想定）
