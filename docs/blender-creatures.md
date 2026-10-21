# 生き物モデルの作り方（Blender → GLB）

ボーンとアニメーションを持つ生き物のモデルは、Blender のスクリプトで作ります。
手でモデリングする必要はなく、データとレシピを直してコマンドを実行すれば作り直せます。

## 2 つの仕組み

| 仕組み | 対象 | 定義 | コマンド |
|---|---|---|---|
| 静的モデル | 主人公・スライム・シカ・オオカミ・木・家など 18 種 | `src/render/modelSpecs.json` | `npm run models` |
| ボーンつき生き物 | モスリング・シャードゴーレム・ドリフトジェリー・ホーンファング | `tools/blender/creatures/` | `npm run creatures` |

`modelSpecs.json` には新しい 4 種の項目もありますが、それは GLB が読めなかったときに
ゲームが使う代わりの形（プリミティブ）です。`build_models.py` はボーンつきの 4 種を
書き出さないので、`npm run models` で GLB が上書きされることはありません。

## 流れ

```
creatures.json（種ごとの設定）
  → creatures/<recipe>.py（形・ボーン・ウェイト・クリップ）
  → Blender の中で検査（三角形数・ボーン数・クリップ・ウェイトのない頂点）
  → public/models/<key>.glb
  → validate.ts（Three.js で読み込んで検査）
```

1. `npm run creatures` を実行する（Blender 4.2 以降。場所は `BLENDER_PATH` で指定できる）。
   - 一部だけ作るとき：`node tools/blender/run-blender.mjs build_creatures.py -- --only hornfang`
2. 生成ログは `tools/blender/out/build-creatures.json` に出る。失敗した種は原因（例外のメッセージと場所）が表示され、ほかの種は作られる。
3. 続けて `npm run models:check` が動き、`tools/blender/out/validate-report.json` に結果を書く。1 つでも失敗すると終了コード 1。
4. `npm test` にも同じ検査（`tests/unit/models.test.ts`）が入っているので、コミットした GLB が壊れていれば CI で止まる。

## 決まりごと

- 1 単位 = 1 タイル。原点は足元の中心。前は glTF の +Z（Blender の -Y）。
- 大きさは `creatures.json` の `scale` で決め、アーマチュアのスケールとして GLB に入る。ゲーム側で大きさを掛け直さない（`src/sim/species.ts` の `model` に scale はない）。
- `top` は検査で許す「頭のてっぺんの高さ」（タイル）。`floats: true` は宙に浮く種（足元が地面から離れていてよい）。
- クリップ名は `Idle` `Move` `Attack` `Hit` `Die` の 5 つ（`creatures.json` の `clips`）。
- 向きの目印として、`rigkit.py` が `root` の下に変形しないボーン `facing` を自動で付ける。検査はこのボーンが +Z を向いているかを見る。

## 検査の内容（`tools/blender/validate.ts`）

| 項目 | 内容 |
|---|---|
| 読み込み | GLTFLoader で読めるか |
| メッシュ | すべてのメッシュが 1 つのアーマチュアにスキンされているか（材質ごとに分かれたメッシュは同じスケルトンを共有） |
| ボーン | 数が `maxJoints` 以下か |
| 三角形 | 数が `maxTriangles` 以下か（ローポリの上限） |
| ウェイト | すべての頂点のウェイトの合計が 1 か |
| 大きさ | 待機姿勢での頭の高さが `top` の範囲か |
| 原点 | 足元が y = 0 か（浮く種は地面より下に出ないか）、中心が x・z の原点にあるか |
| 向き | `facing` ボーンが +Z を向いているか |
| クリップ | 5 つのクリップがあり、長さがあり、存在しないノードを動かしていないか |

## 種を足すとき

1. `src/sim/species.ts` に種のデータを足す（`model.key` = GLB の名前）。
2. `tools/blender/creatures/<名前>.py` にレシピを書く（`from rigkit import *` と `def build(): ... return rig`）。
3. `creatures.json` に項目を足す。
4. `src/render/models.ts` の `MODEL_KEYS` と `modelSpecs.json`（代わりの形）に足す。
5. `npm run creatures` → `npm test`。

## アニメーションと生態系の関係

アニメーションは生態系の状態を見せるだけです。`src/render/creatureView.ts` は毎フレーム、
個体の状態（移動中か、直前に攻撃したか、攻撃を受けたか、死んだか）からクリップを選びます。
クリップの終了やミキサーのイベントが生態系の結果を決めることはありません。

## 出典

- `rigkit.py` と 4 種のレシピは、このプロジェクト用に作った ranvora-kit（Blender 用のリグ作成ヘルパー）を移植したもの。
- ボーンつきメッシュの複製には Three.js の `SkeletonUtils.clone` を使う（ふつうの `clone()` ではボーンが共有されて壊れる）。
