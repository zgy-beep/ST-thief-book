// 过滤引擎单元测试：在 vm 中运行整个 IIFE（setTimeout 打桩使 init 不触发），
// 仅在 IIFE 收尾前注入测试导出钩子，源码本身不做任何修改。
// 运行: node test_filter_engine.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const src = readFileSync(new URL('./st-thief-book.js', import.meta.url), 'utf8');
const idx = src.lastIndexOf('})();');
assert.ok(idx > 0, 'IIFE 收尾未找到');
const hook = '  window.__tbTest = { CONFIG, sanitizeTagList, getFilterRegexes, processWhitelistAndBlacklist, filterThinkingAndTags, cleanHtmlAndStyles, splitIntoSentences };\n';
const patched = src.slice(0, idx) + hook + src.slice(idx);

const storage = new Map();
const sandbox = {
  console,
  window: { addEventListener() {} },
  localStorage: {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  },
  setTimeout: () => 0,
  clearTimeout() {},
  setInterval: () => 0,
  clearInterval() {}
};
sandbox.window.top = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(patched, sandbox, { filename: 'st-thief-book.js' });

const T = sandbox.window.__tbTest;
assert.ok(T && typeof T.processWhitelistAndBlacklist === 'function', '测试导出失败');

const DEFAULT_BL = [...T.CONFIG.tagBlacklist];
const DEFAULT_WL = [...T.CONFIG.tagWhitelist];
function resetConfig() {
  T.CONFIG.tagBlacklist = [...DEFAULT_BL];
  T.CONFIG.tagWhitelist = [...DEFAULT_WL];
  T.CONFIG.enableWhitelist = false;
  T.CONFIG.filterMode = 'pure';
  T.CONFIG.filterActions = false;
}

let passed = 0;
function test(name, fn) {
  resetConfig();
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

const P = (s, force) => T.processWhitelistAndBlacklist(s, force);

test('闭合黑名单标签连同内容剥离', () => {
  assert.strictEqual(P('<think>秘密推理</think>正文你好'), '正文你好');
});

test('HTML 实体编码的黑名单标签无法绕过', () => {
  assert.strictEqual(P('&lt;think&gt;秘密&lt;/think&gt;正文'), '正文');
});

test('流式未闭合标签删除至文末', () => {
  assert.strictEqual(P('正文开始<think>秘密推理还在继续'), '正文开始');
  assert.strictEqual(P('正文开始[think]秘密推理还在继续'), '正文开始');
});

test('中括号黑名单标签剥离', () => {
  assert.strictEqual(P('[cot]秘密[/cot]正文'), '正文');
});

test('四种冒号指令单标签剥离', () => {
  assert.strictEqual(P('[system: 指令]正文'), '正文');
  assert.strictEqual(P('<system: 指令>正文'), '正文');
  assert.strictEqual(P('(system: 指令)正文'), '正文');
  assert.strictEqual(P('{system: 指令}正文'), '正文');
  assert.strictEqual(P('[system：全角冒号]正文'), '正文');
});

test('白名单提取正文容器', () => {
  T.CONFIG.enableWhitelist = true;
  assert.strictEqual(P('<content>小说正文</content>标签外杂音'), '小说正文');
  assert.strictEqual(P('[content]小说正文[/content]杂音'), '小说正文');
});

test('白名单容器内仍剔除黑名单', () => {
  T.CONFIG.enableWhitelist = true;
  assert.strictEqual(P('<content>前<thought>秘密</thought>后</content>'), '前后');
});

test('白名单未命中时回退全文不丢字', () => {
  T.CONFIG.enableWhitelist = true;
  assert.strictEqual(P('没有任何容器的普通正文'), '没有任何容器的普通正文');
});

test('XML 与中括号白名单混用按文档序提取', () => {
  T.CONFIG.enableWhitelist = true;
  assert.strictEqual(P('<content>甲</content>[content]乙[/content]'), '甲\n乙');
});

test('长标签优先匹配（thinking 不被 think 词干抢截）', () => {
  T.CONFIG.tagBlacklist = ['think', 'thinking'];
  assert.strictEqual(P('<thinking>秘密</thinking>正文'), '正文');
  assert.strictEqual(P('<think>秘密</think>正文'), '正文');
});

test('style/script/svg/注释整块剔除', () => {
  assert.strictEqual(P('<style>.a{color:red}</style>正文'), '正文');
  assert.strictEqual(P('<script>alert(1)</script>正文'), '正文');
  assert.strictEqual(P('<svg><path/></svg>正文'), '正文');
  assert.strictEqual(P('<!-- 注释 -->正文'), '正文');
});

test('Markdown 思考代码块剥离', () => {
  assert.strictEqual(P('```thought\n秘密\n```正文'), '正文');
});

test('正则缓存：标签不变复用同一对象，变更后重建', () => {
  const a = T.getFilterRegexes();
  assert.strictEqual(T.getFilterRegexes(), a);
  T.CONFIG.tagBlacklist = [...T.CONFIG.tagBlacklist, 'custom_tag'];
  const b = T.getFilterRegexes();
  assert.notStrictEqual(b, a);
  assert.strictEqual(P('<custom_tag>秘密</custom_tag>正文'), '正文');
});

test('sanitizeTagList 清洗：去括号/ trimmed/ 去重/ 限长/ 限量', () => {
  assert.strictEqual(T.sanitizeTagList('not-array'), null);
  assert.deepStrictEqual(Array.from(T.sanitizeTagList(['<think>', '[cot]', 'think', '  plan  ', 'x'.repeat(65), ''])), ['think', 'cot', 'plan']);
  const many = Array.from({ length: 150 }, (_, i) => `tag${i}`);
  assert.strictEqual(T.sanitizeTagList(many).length, 100);
});

test('纯净模式端到端：白名单+黑名单+HTML 清洗', () => {
  T.CONFIG.enableWhitelist = true;
  assert.strictEqual(T.filterThinkingAndTags('<think>推理</think><content>你好，世界。</content>', -1), '你好，世界。');
});

test('正则模式无酒馆 API 时安全降级', () => {
  T.CONFIG.filterMode = 'regex';
  assert.strictEqual(T.filterThinkingAndTags('<think>秘密</think>正文', -1), '正文');
});

test('动作描写过滤开关', () => {
  T.CONFIG.filterActions = true;
  assert.strictEqual(T.filterThinkingAndTags('正文*挥手*继续', -1), '正文继续');
});

test('保底逻辑绝不复活黑名单内容', () => {
  assert.strictEqual(T.filterThinkingAndTags('<think>只有思考没有正文</think>', -1), '');
});

test('超长未闭合 style 不引发灾难性回溯（2 秒上限）', () => {
  const evil = '<style>' + 'a'.repeat(150000);
  const t0 = Date.now();
  const out = T.filterThinkingAndTags(evil, -1);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, `耗时 ${elapsed}ms 超限`);
  assert.ok(out.startsWith('aaa'), '残留标签应被剥掉、正文保留');
});

test('splitIntoSentences 基本断句', () => {
  assert.deepStrictEqual(Array.from(T.splitIntoSentences('')), ['(暂无消息)']);
  const parts = T.splitIntoSentences('你好。世界！今天天气不错。');
  assert.ok(Array.isArray(parts) && parts.length >= 2);
  assert.ok(parts.join('').includes('你好'));
});

console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败项' : '，全部通过'}`);