import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On, SessionUsage } from 'claude-code'

// テストの見本はすべて架空のルール（実在のルールの本文は使わない）

const PANE = {
  component: 'Pane',
  requestId: 'active-rules',
  props: {
    title: 'いま効いているルール',
    isFocused: false,
    bodyColumns: 100,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// テストの「いま」。2026-10-18 09:00（ローカル時刻）
const NOW = new Date(2026, 9, 18, 9, 0).getTime()
const WORKSPACE = 'C:\\work\\space'
const RULES_DIR = WORKSPACE + '\\.claude\\rules'
const START = { cwd: WORKSPACE, surface: null, isInteractive: true } as const
// /rules を、人が入力欄で打ったときと同じ形で起こす
const RUN = { command: 'rules', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const ALWAYS_A = '【見た目】_01_チャット内のフォーマット'
const ALWAYS_B = '【進め方】_02_決めた手順を自己判断で省略しない'
const SCOPED_HTML = '【見た目】_04_P_アーティファクトはシンプルに'
const SCOPED_REPO = '【安全】_02_P_リポジトリに個人情報を置かない'

// ルールのフォルダーの中身の見本（常時2本・場所限定2本・README）
const FILES: Record<string, string> = {
  [ALWAYS_A + '.md']: '# チャット内のフォーマット\n\n## 目次\n\n1. 禁止（見本の1行）\n',
  [ALWAYS_B + '.md']: '# 決めた手順を自己判断で省略しない\n\n本文の見本です。\n',
  [SCOPED_HTML + '.md']: '---\npaths:\n  - "**/*.html"\n---\n\n# アーティファクトはシンプルに\n\n白い背景にする。\n',
  [SCOPED_REPO + '.md']: '---\npaths:\n  - "01_myrepo/**"\n---\n\n# リポジトリに個人情報を置かない\n',
  'README.md': '# ルールの書き方\n',
}
// 見本1本あたりの推定トークン数（memoryFiles の値）
const TOKENS_EACH = 300
// 表の下に出る補足
const NOTE = 'Anthropic の推奨　1ファイル200行未満（CLAUDE.md の目安。ルールは1ファイル1トピック）'

function entry(name: string): FsEntry {
  return { name, kind: 'file', size: 100, mtimeMs: 0, isLink: false }
}

// 行数（最後の改行の後の空行は数えない）
function linesOf(text: string): number {
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

type World = { opens: number; focused: number; toasts: string[]; usageCalls: number; loaded: Set<string> }

// 文脈の内訳（memoryFiles）の見本。CLAUDE.md と、world.loaded にあるルールを読み込み済みとして答える
function usageOf(world: World): SessionUsage {
  const memoryFiles = [
    { path: WORKSPACE + '\\CLAUDE.md', type: 'Project', tokens: 2400 },
    ...[...world.loaded].map(name => ({ path: RULES_DIR + '\\' + name + '.md', type: 'Project', tokens: TOKENS_EACH })),
  ]
  const breakdown = { memoryFiles, categories: [], totalTokens: 10000, maxTokens: 200000, rawMaxTokens: 200000, percentage: 5, gridRows: [], model: 'test', mcpTools: [], agents: [] }
  return { startedAt: NOW - 60_000, context: { window: 200000, breakdown }, rateLimits: [] } as unknown as SessionUsage
}

// ルールのフォルダー・文脈の内訳・ペイン・toast を、テストの中で答える。placed=false はペインを置けない画面
function stubWorld(on: On, placed = true): World {
  const world: World = { opens: 0, focused: 0, toasts: [], usageCalls: 0, loaded: new Set([ALWAYS_A, ALWAYS_B, 'README']) }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'rules' } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    world.opens += 1
    if (e.focus) world.focused += 1
    return placed ? { value: { isPlaced: true } } : { value: { isPlaced: false, reason: 'no-surface' } }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', ($, e) => {
    if (e.path.replace(/\\/g, '/').toLowerCase() === RULES_DIR.replace(/\\/g, '/').toLowerCase()) {
      return { value: Object.keys(FILES).map(entry) }
    }
    return { value: [] }
  })
  on('fs.read', ($, e) => {
    const name = e.path.split(/[\\/]/).pop() ?? ''
    const text = FILES[name]
    if (text === undefined) throw new Error('no such file: ' + e.path)
    return { value: text }
  })
  on('session.usage', () => {
    world.usageCalls += 1
    return { value: usageOf(world) }
  })
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  return world
}

// ペインのマスの文字と、表の下の Markdown（Anthropic の公式の記述）を集める
async function shownTexts($: Engine, surface: 'terminal' | 'desktop' | 'vscode'): Promise<{ texts: string[]; framed: number; guide: string }> {
  const ui = await $.ui.mount({ plugin: 'active-rules', surface, ...PANE })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  const framed = (await ui.findAll({ type: 'Box' })).filter(box => box.props.borderStyle !== undefined).length
  const markdown = await ui.find({ type: 'Markdown' })
  const guide = typeof markdown?.props.text === 'string' ? markdown.props.text : ''
  await ui.unmount()
  return { texts, framed, guide }
}

test('セッションが始まっただけでは、ペインを開かず、文脈の内訳も読まない（/rules で初めて動く）', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = stubWorld(on)

  await $.session.start(START)
  await clock.advance(10_000)
  expect(world.opens).toBe(0)
  expect(world.usageCalls).toBe(0)

  const ran = await $.command.run(RUN)
  expect(world.opens).toBe(1)
  expect(world.focused).toBe(1)
  expect(world.usageCalls).toBeGreaterThan(0)
  expect(ran.text).toMatch(/いま効いているルール v0\.3\.7/)
})

test('ペインは枠線なしの表で、読み込まれているルールの名前・行数・文字数・トークンと合計の行がある（読み込まれていない場所限定ルールは出ない）', async ($, on) => {
  mock.clock(on, { now: NOW })
  stubWorld(on)

  await $.session.start(START)
  await $.command.run(RUN)

  const textA = FILES[ALWAYS_A + '.md'] ?? ''
  const loadedTexts = [ALWAYS_A, ALWAYS_B, 'README'].map(name => FILES[name + '.md'] ?? '')
  const totalLines = loadedTexts.reduce((sum, text) => sum + linesOf(text), 0)
  const totalChars = loadedTexts.reduce((sum, text) => sum + text.length, 0)

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const { texts, framed, guide } = await shownTexts($, surface)
    // 枠線は無い
    expect(framed).toBe(0)
    expect(texts.some(text => /[┌─┬│├┼└┴┐┤┘]/.test(text))).toBe(false)
    // 見出しの行
    for (const head of ['分類', '番号', 'P', '名前', '行数', '文字数', 'トークン']) expect(texts).toContain(head)
    // ファイル名を 分類・番号・名前 に分けたマス
    expect(texts).toContain('見た目')
    expect(texts).toContain('01')
    expect(texts).toContain('チャット内のフォーマット')
    expect(texts).toContain('進め方')
    expect(texts).toContain('02')
    expect(texts).toContain('決めた手順を自己判断で省略しない')
    expect(texts).toContain('README')
    expect(texts).not.toContain(ALWAYS_A)
    // 数字
    expect(texts).toContain(String(linesOf(textA)))
    expect(texts).toContain(String(textA.length))
    expect(texts).toContain(String(TOKENS_EACH))
    // 合計の行
    expect(texts).toContain('合計')
    expect(texts).toContain('3本')
    expect(texts).toContain(String(totalLines))
    expect(texts).toContain(String(totalChars))
    expect(texts).toContain(String(TOKENS_EACH * 3))
    // 読み込まれていない場所限定ルールは出ない。常時のルールの行に P は付かない（P は見出しの1つだけ）
    expect(texts).not.toContain('アーティファクトはシンプルに')
    expect(texts).not.toContain('リポジトリに個人情報を置かない')
    expect(texts.filter(text => text === 'P').length).toBe(1)
    // 表の下の Anthropic の公式の記述（長さの目安・ルールの読み込まれ方・書き方・文脈は限りある資源・出典）
    expect(guide).toContain('1ファイル200行未満')
    expect(guide).toContain('paths の無いルールは、起動時に')
    expect(guide).toContain('ルールのファイル、@path の取り込みは、それぞれ別の1ファイルとして数える')
    expect(guide).toContain('context rot')
    expect(guide).toContain('https://code.claude.com/docs/en/memory')
    expect(guide).toContain('https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents')
  }
})

test('ペインを置けない画面では、/rules の出力に同じ表が文字で出る', async ($, on) => {
  mock.clock(on, { now: NOW })
  stubWorld(on, false)

  await $.session.start(START)
  const ran = await $.command.run(RUN)
  expect(ran.text).toMatch(/ペインを置けませんでした/)
  expect(ran.text).toContain('分類 | 番号 | P | 名前 | 行数 | 文字数 | トークン')
  expect(ran.text).toContain('見た目 | 01 |  | チャット内のフォーマット | ')
  expect(ran.text).toContain('合計 |  |  | 3本 | ')
  expect(ran.text).toContain(NOTE)
  expect(ran.text).not.toContain('アーティファクトはシンプルに')
})

test('HTML のファイルを Edit すると、そのファイルで効く場所限定ルールが toast で出て、読み込まれたら表に行が増える', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = stubWorld(on)

  await $.session.start(START)
  await $.command.run(RUN)

  await $.tool.call({ tool: 'Edit', file_path: WORKSPACE + '\\docs\\page.html', old_string: 'a', new_string: 'b' })
  expect(world.toasts.length).toBe(1)
  expect(world.toasts[0]).toBe('このファイルで効くルール 【見た目】_04_P')

  world.loaded.add(SCOPED_HTML)
  await clock.advance(5000)
  const { texts } = await shownTexts($, 'vscode')
  expect(texts).toContain('アーティファクトはシンプルに')
  expect(texts).toContain('04')
  expect(texts.filter(text => text === 'P').length).toBe(2)
  expect(texts).toContain('4本')

  // 同じ組み合わせの toast は 10分に1回まで
  await $.tool.call({ tool: 'Edit', file_path: WORKSPACE + '\\docs\\other.html', old_string: 'a', new_string: 'b' })
  expect(world.toasts.length).toBe(1)
})

test('01_myrepo の下のファイルを Write すると【安全】_02_P が出て、.md の Read では何も出ない', async ($, on) => {
  mock.clock(on, { now: NOW })
  const world = stubWorld(on)

  await $.session.start(START)
  await $.command.run(RUN)

  await $.tool.call({ tool: 'Write', file_path: WORKSPACE + '\\01_myrepo\\repo\\README.md', content: 'x' })
  expect(world.toasts.length).toBe(1)
  expect(world.toasts[0]).toBe('このファイルで効くルール 【安全】_02_P')

  await $.tool.call({ tool: 'Read', file_path: WORKSPACE + '\\notes\\memo.md' })
  expect(world.toasts.length).toBe(1)
})

test('toast の設定を切ると、ファイルを触っても toast を出さない', { options: { toasts: false } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const world = stubWorld(on)

  await $.session.start(START)
  await $.command.run(RUN)
  await $.tool.call({ tool: 'Edit', file_path: WORKSPACE + '\\docs\\page.html', old_string: 'a', new_string: 'b' })
  expect(world.toasts.length).toBe(0)
})
