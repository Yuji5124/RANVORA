# RANVORA 開発ルール

RANVORA の核は「開発者にも予想できない発見が生まれる世界」です。
同じシードと同じ操作履歴から、同じ現象を再現・検証できることが研究の土台です。
このファイルのルールは、その土台を守るためのものです。

## 絶対に守る条件

- 乱数は `src/core/rng.ts` の `Rng.stream(seed, '<系統名>')` を使う。系統ごとに別のストリームを作り、既存のストリーム（`world` `sim` `plants` `pickups` `drops` `player`）の消費順を変えない。
- `Math.random()` と `Date.now()` を、ゲーム内の決定的な状態の生成や ID の生成に使わない（演出・計測・UI の時刻表示は可）。
- ID は `shortId(prefix, hash)` で作る（例 `ITM-3F9A2C`）。hash は `hashInts` / `hashString` で、シードと入力から決める。
- 1 ワールド単位 = 1 タイル。
- 向きの基準は 0 = +X、π/2 = +Z（`Player.dir` と同じ。前方ベクトルは `(cos dir, sin dir)`）。他の規約のコードは境界で一度だけ変換する（`src/combat/facing.ts`）。
- 生態系の状態は `src/sim/` だけが持つ。描画（`src/render/`）と UI は生態系の状態を読むだけで、変更しない。
- `src/sim/` と `src/world/` は Three.js・DOM・`src/game/` に依存しない（描画なしの早回し `npm run sim` が動くこと）。
- 既存の「レシピのない合成」（`src/items/synthesis.ts`）を置き換えない。特別な合成は別の仕組みとして足す。
- 他のプロジェクト（lowpoly-starter など）のコード・座標・道路・建物を持ち込まない。参考にした技術は出典を docs/ に書く。
- 既存のテストと GitHub Pages の公開を壊さない。`main` に直接 push しない。

## 属性の扱い

| 種類 | 値 | 場所 |
|---|---|---|
| 魔法属性 | 火・水・風・雷・土（`fire` `water` `wind` `thunder` `earth`、無属性 `none`） | `src/items/synthesis.ts` の `Element` |
| 生物・素材の系統 | 植物・鉱物・水生・獣（`flora` `mineral` `aqua` `beast`） | `src/progression/lineage.ts` の `Lineage` |

2 つは別の軸です。武器の進化は系統で決まり、魔法の効果は魔法属性で決まります。

## フォルダ

```
src/core/         乱数・イベントログ
src/world/        世界生成（描画なし）
src/sim/          自律生態系（描画なし・決定的）
src/items/        素材・レシピのない合成・持ち物
src/progression/  武器の成長（経験値・レベル・限界突破・系統による進化・武器合成）。描画なし・決定的
src/combat/       戦闘の共通処理（相性・扇形の当たり判定・ダメージ・ドロップ抽選）。描画なし
src/codex/ src/render/ src/game/ src/ui/   図鑑・描画・ゲームループ・UI
tools/blender/    Blender での GLB 生成
tests/unit tests/e2e
```

## 作業の進め方

- 1 つの変更ごとに `npm test` と `npm run build` を通してからコミットする。描画に関わる変更は `npm run test:e2e` も通す。
- ブラウザテストは固定時間で待たず、`window.__RANVORA` の状態を見て待つ（描画の遅い環境でも同じ結果になるように）。
- 既存の設計と矛盾するときは、勝手に大規模な変更をせず、理由と選択肢を報告する。
- 生態系を変える変更では、`npm run sim -- <seed> <分>` の結果と `fingerprint()` の変化を記録する。
