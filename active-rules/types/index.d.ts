// ペインが読む値の型。$.state に置く値は、ここで宣言したものだけ使える。

// ルールのフォルダーにある .md 1本
export type RuleFile = {
  // ファイル名から .md を除いたもの（例「【見た目】_04_P_アーティファクトはシンプルに」）
  name: string
  // 絶対パス
  path: string
  // 【 】の中の分類（例「見た目」）。無ければ空
  category: string
  // 分類の次の番号（例「04」）。無ければ空
  number: string
  // 先頭の paths でファイルの場所を限定しているか（限定していれば、対象のファイルを触ったときだけ読み込まれる）
  isPathScoped: boolean
  // paths の条件（glob）。常時のルールは空
  paths: string[]
  // いま文脈に読み込まれているか（$.session.usage の memoryFiles にあるか）
  isLoaded: boolean
  // ファイルの行数と文字数
  lines: number
  chars: number
  // 読み込まれているときの推定トークン数（memoryFiles の値）。無ければ null
  tokens: number | null
}

export type Snapshot = {
  rules: RuleFile[]
  rulesDir: string
  updatedAt: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'active-rules': {
      snapshot: Snapshot
      // ペインを開いておきたいか（/rules で true、手で閉じたら false）
      paneWanted: boolean
    }
  }
}
