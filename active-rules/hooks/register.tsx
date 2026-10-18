import { atom, read, update } from 'claude-code'
import type { EngineInterface, FsEntry, Register } from 'claude-code'

import type { RuleFile, Snapshot } from '../types'

// ペインの名前（id は英数字だけ。題名は日本語でよい）
const PANE = 'active-rules'
// 版。/rules の出力と起動記録.txt に出し、どの中身が動いているかを確かめるのに使う
const VERSION = '0.3.7'
const TITLE = 'いま効いているルール'
const COMMAND = 'rules'

// 読み込み状態（文脈の内訳）は、ペインを開いている間 5秒ごとに読み直す。ルールのフォルダーは 60秒ごとに見直す
const REFRESH_MS = 5000
const LIST_EVERY_MS = 60 * 1000
// 同じ組み合わせの toast は 10分に1回まで
const TOAST_GAP_MS = 10 * 60 * 1000
const TOAST_MS = 6000
// ファイルを触る道具。これらの path を見て、対象の場所限定ルールを判定する
const TOUCH_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// 色（白い背景に黒い文字。見出しの行は薄い水色。赤は失敗だけ）
const BLACK = '#000000'
const RED = '#c00000'
const WHITE = '#ffffff'
const HEAD_BG = '#eaf6fc'

// 表の列の幅（セル数）。分類と名前の列は、中身に合わせて決める
const W_NUM = 4
const W_P = 1
const W_LINES = 5
const W_CHARS = 7
const W_TOKENS = 8
// 表の列の見出し（ファイル名を 分類・番号・P・名前 に分ける）
const HEADS = ['分類', '番号', 'P', '名前', '行数', '文字数', 'トークン']
// ペインを置けない画面の文字の表の下に出す、短い補足。出典は Claude Code 公式の文書 https://code.claude.com/docs/en/memory
// （「target under 200 lines per CLAUDE.md file」「Each file should cover one topic」）
const NOTE = 'Anthropic の推奨　1ファイル200行未満（CLAUDE.md の目安。ルールは1ファイル1トピック）'
// ペインの表の下に出す、Anthropic の公式の記述（2026-10-18 に確認）。訳は原文に沿わせ、出典の番号を付ける
const GUIDE = [
  '**Anthropic の公式の記述（ルールと CLAUDE.md の容量、2026-10-18 に確認）**',
  '',
  '**1. 長さの目安（1ファイル200行未満）**',
  '',
  '- CLAUDE.md は1ファイル200行未満を目標にする。長いファイルは文脈を多く使い、指示の守られ方が下がる。[1]',
  '- 200行を超えるファイルは文脈を多く使い、守られ方が下がることがある。4 MiB を超えるファイルは読み込まれない。[1]',
  '- 推奨の長さを超えるファイルがあると、起動時と /status で警告が出る。1本ずつは推奨の長さに収まっていても、合計が上限を超えると警告が出る。CLAUDE.md、ルールのファイル、@path の取り込みは、それぞれ別の1ファイルとして数える。[1]',
  '- CLAUDE.md は、要るものだけを書いて200行未満に保つ。[3]',
  '- プロジェクトの CLAUDE.md は200行未満に保ち、参照用の中身はスキルか paths のあるルールに移して、要るときだけ読み込ませる。[4]',
  '- 自動メモリー（MEMORY.md）は、先頭の200行か25KB の少ないほうだけが読み込まれる。[1]',
  '',
  '**2. ルールの読み込まれ方（常時と場所限定）**',
  '',
  '- 1ファイルに1つの話題を書き、中身が分かるファイル名にする。[1]',
  '- paths の無いルールは、起動時に .claude/CLAUDE.md と同じ優先度で読み込まれる。[1]',
  '- paths のあるルールは、対象のファイルを扱うときだけ読み込まれる。雑音を減らし、文脈を節約できる。[1]',
  '- ルールは毎回か、対象のファイルを開いたときに読み込まれる。いつも要るわけではない作業の指示は、スキルにする。スキルは、呼ばれたときか、関係があると Claude が判断したときだけ読み込まれる。[1]',
  '- コンパクションの後、プロジェクト直下の CLAUDE.md と paths の無いルールは、ファイルから読み直される。[4]',
  '- paths のあるルールは、対象のファイルを触ったときに会話の履歴へ読み込まれるので、コンパクションで要約されて消える。消えては困るルールは、paths を外すか、プロジェクト直下の CLAUDE.md に移す。[4]',
  '',
  '**3. 書き方（短く、具体的に、食い違わせない）**',
  '',
  '- 指示が具体的で簡潔なほど、Claude は一貫して従う。[1]',
  '- 1行ごとに「これを消すと Claude が間違えるか」を問い、間違えないなら消す。膨らんだ CLAUDE.md は、本当の指示を Claude に無視させる。[2]',
  '- CLAUDE.md が長すぎると、大事な規則が雑音に埋もれ、半分が無視される。容赦なく削る。指示が無くても正しくできていることは、消すかフックにする。[2]',
  '- 規則があるのに望まないことを繰り返されるなら、ファイルが長すぎて規則が埋もれている可能性が高い。[2]',
  '- 2つの指示が食い違うと、Claude はどちらかを任意に選ぶことがある。CLAUDE.md とルールを定期的に見直し、古い指示や食い違う指示を消す。[1]',
  '- 守られない指示が1つだけなら、その行にだけ IMPORTANT などの強調を付ける。多くの行を強調すると、どれも目立たない。[2]',
  '- 関係する指示は、見出しと箇条書きでまとめる。密な段落より従いやすい。[1]',
  '- @path の取り込みは長いファイルの整理には役立つが、文脈の量は減らない。取り込んだファイルも起動時に読み込まれる。[1]',
  '- ブロックの HTML コメント（`<!-- -->`）は、文脈に入る前に取り除かれる。トークンを使わずに人向けのメモを残せる。[1]',
  '- CLAUDE.md は system prompt の後に user メッセージとして渡される。Claude は従おうとするが、厳密に守られる保証はない。決まった時点で必ず行うことは、フックにする。[1]',
  '',
  '**4. 文脈は限りある資源（Anthropic の技術ブログ）**',
  '',
  '- 文脈は、増やすほど効き目が減っていく有限の資源として扱う。[5]',
  '- 文脈のトークンが増えるほど、そこから正確に思い出す力が下がる（context rot）。程度の差はあるが、すべてのモデルで起きる。[5]',
  '- 目標は、望む結果の見込みを最大にする、できるだけ小さな、情報の濃いトークンの集合を見つけること。[5]',
  '- 最小とは短いという意味ではない。必要な情報は、最初に十分に渡す。[5]',
  '- Claude Code では、CLAUDE.md は最初にそのまま文脈へ入れられる。[5]',
  '',
  '**5. 出典（5本）**',
  '',
  '- [1] How Claude remembers your project　https://code.claude.com/docs/en/memory',
  '- [2] Best practices for Claude Code　https://code.claude.com/docs/en/best-practices',
  '- [3] Manage costs effectively　https://code.claude.com/docs/en/costs',
  '- [4] Explore the context window　https://code.claude.com/docs/en/context-window',
  '- [5] Effective context engineering for AI agents（2025-09-29）　https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents',
].join('\n')

const EMPTY: Snapshot = { rules: [], rulesDir: '', updatedAt: 0, error: null }
const snapshot = atom({ plugin: 'active-rules', key: 'snapshot' } as const, EMPTY)
// /rules で開いたら true、使っている人が手で閉じたら false。読み直しで閉じたペインは、次の入力のついでに開き直す
const paneWanted = atom({ plugin: 'active-rules', key: 'paneWanted' } as const, false)

// 読み込み直しで消えてよい控え
let cwd = ''
let rulesDir = ''
// paths の条件を照らす基準のフォルダー（rulesDir の2つ上。.claude\rules なら、そのワークスペース）
let root = ''
let isToastOn = true
let rules: RuleFile[] = []
// 同じ組み合わせの toast を最後に出した時刻
const toastedAt: Record<string, number> = {}
let isPaneOpen = false
let isBusy = false
let lastListAt = 0

function join(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

function parentOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return at > 0 ? trimmed.slice(0, at) : trimmed
}

function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
}

// 比べるための形（区切りを / にし、小文字にする。Windows のパスは大文字小文字を区別しない）
function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// 基準のフォルダーからの相対パス（区切りは /）。基準の外なら絶対パスのまま
function relativeTo(base: string, path: string): string {
  const p = path.replace(/\\/g, '/')
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '')
  if (b !== '' && p.toLowerCase().startsWith(b.toLowerCase() + '/')) return p.slice(b.length + 1)
  return p
}

// 全角を2、半角を1と数える
function cellWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    width += code > 0x2e7f && !(code >= 0xff61 && code <= 0xff9f) ? 2 : 1
  }
  return width
}

// 3桁ごとにコンマ
function fmt(n: number | null): string {
  if (n === null) return '-'
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 行数（最後の改行の後の空行は数えない）
function countLines(text: string): number {
  if (text === '') return 0
  const parts = text.split(/\r?\n/)
  return text.endsWith('\n') ? parts.length - 1 : parts.length
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// paths の条件（glob）を正規表現にする。** は何階層でも、* は1階層の中、? は1文字、{a,b} はどちらか
function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '')
  let re = ''
  let i = 0
  while (i < g.length) {
    const ch = g[i] ?? ''
    if (ch === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 3
          continue
        }
        re += '.*'
        i += 2
        continue
      }
      re += '[^/]*'
      i += 1
      continue
    }
    if (ch === '?') {
      re += '[^/]'
      i += 1
      continue
    }
    if (ch === '{') {
      const end = g.indexOf('}', i)
      if (end > i) {
        re += '(?:' + g.slice(i + 1, end).split(',').map(part => escapeRe(part.trim())).join('|') + ')'
        i = end + 1
        continue
      }
    }
    re += escapeRe(ch)
    i += 1
  }
  return new RegExp('^' + re + '$', 'i')
}

// 相対パスが条件に合うか。/ を含まない条件は、ファイル名だけでも照らす
export function matchesGlob(rel: string, glob: string): boolean {
  const re = globToRegExp(glob)
  const path = rel.replace(/\\/g, '/')
  if (re.test(path)) return true
  if (!glob.includes('/')) return re.test(path.split('/').pop() ?? '')
  return false
}

function unquote(text: string): string {
  const t = text.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

// 先頭の --- で囲まれた部分から paths を読む。無ければ空（＝常時のルール）
export function parsePaths(text: string): string[] {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (m === null) return []
  const paths: string[] = []
  let inPaths = false
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const inline = /^paths:\s*\[(.*)\]\s*$/.exec(line)
    if (inline !== null) {
      for (const part of (inline[1] ?? '').split(',')) {
        const value = unquote(part)
        if (value !== '') paths.push(value)
      }
      inPaths = false
      continue
    }
    if (/^paths:\s*$/.test(line)) {
      inPaths = true
      continue
    }
    if (inPaths) {
      const item = /^\s+-\s*(.+?)\s*$/.exec(line)
      if (item !== null) {
        const value = unquote(item[1] ?? '')
        if (value !== '') paths.push(value)
        continue
      }
      if (/^\S/.test(line)) inPaths = false
    }
  }
  return paths
}

function categoryOf(name: string): string {
  const m = /^【(.+?)】/.exec(name)
  return m === null ? '' : (m[1] ?? '')
}

function numberOf(name: string): string {
  const m = /^【.+?】_(\d+)/.exec(name)
  return m === null ? '' : (m[1] ?? '')
}

// ファイル名の「名前」の部分（【分類】_番号_P_ を除いたもの）。分けられなければファイル名のまま
function titleOf(rule: RuleFile): string {
  const m = /^【.+?】(?:_\d+)?(?:_P(?=_))?_?(.*)$/.exec(rule.name)
  const rest = m === null ? '' : (m[1] ?? '')
  return rest === '' ? rule.name : rest
}

// 短い呼び名（【見た目】_04_P）。番号が無ければファイル名のまま
function shortName(rule: RuleFile): string {
  if (rule.number === '') return rule.name
  return '【' + rule.category + '】_' + rule.number + (rule.isPathScoped ? '_P' : '')
}

// 道具の入力から、触ったファイルのパスを取り出す（file_path・notebook_path・path）
function pathOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const record = input as Record<string, unknown>
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

// ルールのフォルダーの .md を全部読み、paths・行数・文字数を取り出す
async function loadRules($: EngineInterface): Promise<string | null> {
  let entries: FsEntry[]
  try {
    entries = await $.fs.list(rulesDir)
  } catch (error) {
    rules = []
    return 'ルールのフォルダーを読めません: ' + rulesDir + '（' + String(error) + '）'
  }
  const next: RuleFile[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/\.md$/i.test(entry.name)) continue
    const path = join(rulesDir, entry.name)
    let text = ''
    try {
      text = await $.fs.read(path)
    } catch {
      text = ''
    }
    const paths = parsePaths(text)
    const name = entry.name.replace(/\.md$/i, '')
    const prev = rules.find(rule => rule.path === path)
    next.push({
      name,
      path,
      category: categoryOf(name),
      number: numberOf(name),
      isPathScoped: paths.length > 0,
      paths,
      isLoaded: prev?.isLoaded ?? false,
      lines: countLines(text),
      chars: text.length,
      tokens: prev?.tokens ?? null,
    })
  }
  next.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  rules = next
  return null
}

// 文脈の内訳（memoryFiles）を読み、各ルールが読み込み済みかと推定トークン数を更新する。summary は手元の推定だけで、外へは何も送らない
async function refreshLoaded($: EngineInterface): Promise<string | null> {
  let files: readonly { path: string; type: string; tokens: number }[]
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const breakdown = usage.context.breakdown
    if (breakdown === undefined) return '文脈の内訳が取れません（セッションに結び付いていません）'
    files = breakdown.memoryFiles
  } catch (error) {
    return '文脈の内訳を読めません: ' + String(error)
  }
  const loaded = new Map<string, number>()
  for (const file of files) loaded.set(norm(file.path), file.tokens)
  rules = rules.map(rule => {
    const tokens = loaded.get(norm(rule.path))
    return { ...rule, isLoaded: tokens !== undefined, tokens: tokens ?? null }
  })
  return null
}

async function publish($: EngineInterface, error: string | null): Promise<void> {
  const now = await $.clock.now()
  await update($, snapshot, () => ({ rules, rulesDir, updatedAt: now, error }))
}

// 5秒ごとの1回分。前の回がまだ動いていたら飛ばす
async function tick($: EngineInterface): Promise<void> {
  if (isBusy) return
  isBusy = true
  try {
    const now = await $.clock.now()
    let listError: string | null = null
    if (rules.length === 0 || now - lastListAt >= LIST_EVERY_MS) {
      lastListAt = now
      listError = await loadRules($)
    }
    const loadError = await refreshLoaded($)
    await publish($, listError ?? loadError)
  } catch (error) {
    await update($, snapshot, prev => ({ ...EMPTY, ...prev, error: String(error) }))
  } finally {
    isBusy = false
  }
}

// 道具で触ったファイルに効く場所限定ルールがあれば、名前を toast で知らせる
async function noteTouch($: EngineInterface, rawPath: string): Promise<void> {
  const abs = isAbsolute(rawPath) ? rawPath : join(cwd, rawPath)
  const rel = relativeTo(root, abs)
  const matched = rules.filter(rule => rule.isPathScoped && rule.paths.some(glob => matchesGlob(rel, glob)))
  const now = await $.clock.now()
  if (isPaneOpen) {
    const loadError = await refreshLoaded($)
    await publish($, loadError)
  }
  if (!isToastOn || matched.length === 0) return
  const key = matched.map(rule => rule.name).join('|')
  if (now - (toastedAt[key] ?? 0) < TOAST_GAP_MS) return
  toastedAt[key] = now
  $.ui.toast('このファイルで効くルール ' + matched.map(shortName).join('　'), { timeoutMs: TOAST_MS })
}

type Totals = { lines: number; chars: number; tokens: number }

function totalsOf(list: RuleFile[]): Totals {
  return list.reduce<Totals>(
    (acc, rule) => ({ lines: acc.lines + rule.lines, chars: acc.chars + rule.chars, tokens: acc.tokens + (rule.tokens ?? 0) }),
    { lines: 0, chars: 0, tokens: 0 },
  )
}

// 表の1行分のマス（分類・番号・P・名前・行数・文字数・トークン）
function cellsOf(rule: RuleFile): string[] {
  return [rule.category, rule.number, rule.isPathScoped ? 'P' : '', titleOf(rule), fmt(rule.lines), fmt(rule.chars), fmt(rule.tokens)]
}

// 合計の行のマス
function totalCells(list: RuleFile[]): string[] {
  const total = totalsOf(list)
  return ['合計', '', '', String(list.length) + '本', fmt(total.lines), fmt(total.chars), fmt(total.tokens)]
}

// ペインを置けない画面向けの、文字の表（枠線なし）
function textTable(list: RuleFile[]): string {
  const lines = [HEADS.join(' | ')]
  for (const rule of list) lines.push(cellsOf(rule).join(' | '))
  if (list.length > 0) lines.push(totalCells(list).join(' | '))
  lines.push('', NOTE)
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  isToastOn = options.toasts !== false
  const configuredDir = typeof options.rulesDir === 'string' ? options.rulesDir.trim() : ''

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    rulesDir = configuredDir !== '' ? configuredDir : join(e.cwd, '.claude', 'rules')
    root = configuredDir !== '' ? parentOf(parentOf(configuredDir)) : e.cwd
    // 読み込みの記録（いつ・どの版が読み込まれたか）。画面が古いままかを、私が確かめるために書く
    try {
      await $.fs.write(join($.plugin.root, '起動記録.txt'), 'v' + VERSION + ' ' + new Date(await $.clock.now()).toISOString() + '\n')
    } catch {
      // 書けなくても動く
    }
    // toast の判定に要るので、ルールの一覧は最初に読む（.md を 1本ずつ読むだけで、外へは何も送らない）
    lastListAt = await $.clock.now()
    await loadRules($)
    // ペインは自分からは開かない。読み直しのときは、開いたままのペインが残っているか、/rules で開いてあれば続けて動く
    try {
      const panes = await $.ui.panes()
      const wanted = await read($, paneWanted)
      isPaneOpen = panes.some(pane => pane.id === PANE) || wanted === true
      if (isPaneOpen && !panes.some(pane => pane.id === PANE)) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    } catch {
      isPaneOpen = false
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: 'いま効いているルールの表（分類・番号・P・名前・行数・文字数・トークン）をペインに出す',
        immediate: true,
      })
    } catch {
      // 同じ名前のコマンドがあるときは登録しない
    }
    if (isPaneOpen) void tick($)
    $.clock.every(REFRESH_MS, () => {
      if (isPaneOpen) void tick($)
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    isPaneOpen = true
    await update($, paneWanted, () => true)
    const listError = await loadRules($)
    const loadError = await refreshLoaded($)
    await publish($, listError ?? loadError)
    // 前に出す指定（focus）を付ける。付けないと、ほかの mod のペインの後ろのタブに開いたままになる
    const result = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    if (!result.isPlaced) {
      // ペインを置けない画面では、同じ表を文字で出す
      return { text: TITLE + ' v' + VERSION + '（ペインを置けませんでした: ' + result.reason + '）\n' + textTable(rules.filter(rule => rule.isLoaded)) }
    }
    return { text: TITLE + ' v' + VERSION + '　ペインに出しました' }
  })

  // /rules で開いたのに置かれていないペインは、使っている人の入力のついでに開き直す
  on('prompt.submit', async ($, e, next) => {
    if (isPaneOpen) {
      const panes = await $.ui.panes()
      const mine = panes.find(pane => pane.id === PANE)
      if (mine === undefined || !mine.isPlaced) {
        await $.ui.open({ id: PANE, title: TITLE })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ファイルを触る道具の後で、そのファイルに効く場所限定ルールを知らせる。失敗しても道具の結果はそのまま返す
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!TOUCH_TOOLS.has(e.tool)) return ran
    if ('deny' in ran && typeof ran.deny === 'string') return ran
    const path = pathOf(e)
    if (path !== null) {
      try {
        await noteTouch($, path)
      } catch {
        // 知らせられなくても道具の結果は返す
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    isPaneOpen = false
    // 手で閉じたときだけ「開かない」を覚える。読み直しや仕組みの都合で閉じたときは、次の入力で開き直す
    if (e.origin.kind === 'person') await update($, paneWanted, () => false)
    return next(e)
  })

  // ペインには、枠線なしの表（分類・番号・P・名前・行数・文字数・トークン）と合計の行を出す。見出しの行だけ薄い水色
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const stored = await read($, snapshot)
    const list = (Array.isArray(stored.rules) ? stored.rules : []).filter(rule => rule.isLoaded)
    const error = typeof stored.error === 'string' ? stored.error : null
    const measured = e.props.bodyColumns > 0 ? e.props.bodyColumns : (e.viewport?.columns ?? 80)
    const columns = Math.max(44, measured) - 2
    // 分類の列は一番長い分類に合わせる（12 まで）。名前の列は残りの幅いっぱい
    const wCat = Math.min(12, Math.max(cellWidth(HEADS[0] ?? ''), ...list.map(rule => cellWidth(rule.category))))
    const fixed = wCat + W_NUM + W_P + W_LINES + W_CHARS + W_TOKENS + (HEADS.length - 1)
    const nameWidth = Math.max(12, columns - fixed)
    const widths = [wCat, W_NUM, W_P, nameWidth, W_LINES, W_CHARS, W_TOKENS]
    const rightAligned = [false, false, false, false, true, true, true]

    const row = (key: string, cells: string[], isHead: boolean, isBold: boolean) => (
      <Box key={key} flexDirection="row" columnGap={1} {...(isHead ? { backgroundColor: HEAD_BG } : {})}>
        {cells.map((text, i) => (
          <Box key={key + '-' + String(i)} width={widths[i] ?? 1} justifyContent={rightAligned[i] === true ? 'flex-end' : 'flex-start'}>
            <Text color={BLACK} weight={isBold ? 'bold' : 'regular'} wrap="truncate">{text === '' ? ' ' : text}</Text>
          </Box>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" backgroundColor={WHITE} paddingX={1}>
        {error !== null && <Text color={RED} wrap="wrap">{error}</Text>}
        {list.length === 0 && error === null && <Text color={BLACK}>読んでいます…</Text>}
        {row('head', HEADS, true, true)}
        {list.map(rule => row('rule-' + rule.name, cellsOf(rule), false, false))}
        {list.length > 0 && row('total', totalCells(list), false, true)}
        <Box marginTop={1} flexDirection="column">
          <Markdown key="guide" text={GUIDE} />
        </Box>
      </Box>
    )
  })
}
