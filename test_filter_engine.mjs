// 过滤引擎单元测试：在 vm 中运行整个 IIFE（setTimeout 打桩使 init 不触发），
// 仅在 IIFE 收尾前注入测试导出钩子，源码本身不做任何修改。
// 运行: node test_filter_engine.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const src = readFileSync(new URL('./st-thief-book.js', import.meta.url), 'utf8');
const idx = src.lastIndexOf('})();');
assert.ok(idx > 0, 'IIFE 收尾未找到');
const hook = `window.__tbTest = {
  CONFIG, STATE, sanitizeTagList, getFilterRegexes, processWhitelistAndBlacklist,
  filterThinkingAndTags, cleanHtmlAndStyles, splitIntoSentences, changeMessageFloor,
  refreshLatestMessage, initTavernEvents, syncToDesktop, initDesktopBridge, stopDesktopBridge,
  extractReplyChoices, submitReply, retryGeneration, restoreDesktopPosition
};\n`;
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
const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}
async function runTest(name, fn) {
  resetConfig();
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.error(`[FAIL] ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

const P = T.processWhitelistAndBlacklist;

test('闭合黑名单标签连同内容剥离', () => {
  assert.strictEqual(P('<think>秘密推理</think>正文你好'), '正文你好');
});

test('HTML 实体编码的黑名单标签无法绕过', () => {
  assert.strictEqual(P('&lt;think&gt;秘密&lt;/think&gt;正文'), '正文');
});

test('名单识别粘贴的实体标签、多层转义和数字实体', () => {
  T.CONFIG.enableWhitelist = true;
  T.CONFIG.tagWhitelist = ['&amp;lt;game&amp;gt;'];
  T.CONFIG.tagBlacklist = ['&#x3c;hidden&#x3e;'];
  const msg = '外围&amp;lt;game&amp;gt;正文&#60;hidden&#62;杂项&#x3c;/hidden&#x3e;&amp;lt;/game&amp;gt;尾部';
  assert.strictEqual(T.filterThinkingAndTags(msg, 0), '正文');
  T.CONFIG.tagBlacklist = ['&lt;game&gt;'];
  assert.strictEqual(T.filterThinkingAndTags('&lt;game&gt;不显示&lt;/game&gt;正文', 0), '正文');
});

test('黑名单外层不会被内层白名单带回，空白名单保留过滤结果', () => {
  T.CONFIG.enableWhitelist = true;
  T.CONFIG.tagBlacklist = ['game', 'think'];
  assert.strictEqual(T.filterThinkingAndTags(
    '&lt;game&gt;&lt;content&gt;杂项&lt;/content&gt;&lt;/game&gt;<content>正文</content>', 0), '正文');
  assert.strictEqual(T.filterThinkingAndTags('外围<content><think>杂项</think></content>', 0), '');
});

test('酒馆正则使用过滤后的文本，渲染副本无法带回名单外内容', () => {
  T.CONFIG.filterMode = 'regex';
  T.CONFIG.enableWhitelist = true;
  T.CONFIG.tagWhitelist = ['game'];
  sandbox.retrieveDisplayedMessage = () => ({ length: 1, clone: () => ({
    find: () => ({ remove() {} }),
    html: () => '<p>外围和正文及杂项</p>'
  }) });
  const formatted = [];
  sandbox.formatAsDisplayedMessage = text => {
    formatted.push(text);
    return '<p>处理后的' + text + '</p>';
  };
  try {
    assert.strictEqual(T.filterThinkingAndTags(
      '外围&amp;lt;game&amp;gt;正文&lt;think&gt;杂项&lt;/think&gt;&amp;lt;/game&amp;gt;', 0), '处理后的正文');
    assert.deepStrictEqual(formatted, ['正文']);
  } finally {
    delete sandbox.retrieveDisplayedMessage;
    delete sandbox.formatAsDisplayedMessage;
  }
});

test('流式未闭合标签删除至文末', () => {
  assert.strictEqual(P('正文开始<think>秘密推理还在继续'), '正文开始');
  assert.strictEqual(P('正文开始[think]秘密推理还在继续'), '正文开始');
});

test('未闭合的黑名单只截断已选正文，自闭合标签只删除标签', () => {
  T.CONFIG.enableWhitelist = true;
  T.CONFIG.tagBlacklist = ['game'];
  assert.strictEqual(P('外围<content>正文&lt;game&gt;杂项</content>'), '正文');
  assert.strictEqual(P('正文&lt;game&gt;<content>隐藏正文</content>'), '正文');
  assert.strictEqual(P('前&lt;game /&gt;后'), '前后');
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
  assert.strictEqual(P('[content]甲[/content]<content>乙</content>'), '甲\n乙');
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

test('正文断句保留空格、完整 Unicode 字符和稳定句序', () => {
  const text = 'A'.repeat(41) + '😀 stays together。 Next sentence!\n下一段。';
  const parts = Array.from(T.splitIntoSentences(text));
  assert.strictEqual(parts.join(''), text.replace('\n', ' '));
  assert.ok(parts[0].endsWith('😀'));
  sandbox.window.innerWidth = 360;
  T.CONFIG.barWidth = 360;
  assert.deepStrictEqual(Array.from(T.splitIntoSentences(text)), parts);
});

test('桥接跨楼跳过用户楼层，区分首末屏并忽略重复翻页', () => {
  const messages = [
    { role: 'assistant', message: '😀 第一条回复。 结尾仍有内容。' },
    { role: 'user', message: '用户消息' },
    { role: 'assistant', message: '第二条回复。' }
  ];
  const sent = [];
  sandbox.getChatMessages = id => messages[id] ? [messages[id]] : [];
  sandbox.getLastMessageId = () => messages.length - 1;
  sandbox.WebSocket = { OPEN: 1 };
  T.CONFIG.enableDesktopSync = true;
  T.CONFIG.showUserMessages = false;
  T.STATE.wsAuthenticated = true;
  T.STATE.wsClient = { readyState: 1, send: payload => sent.push(JSON.parse(payload)) };
  T.STATE.currentMsgId = 0;

  T.changeMessageFloor(1, 0, 1);
  assert.strictEqual(sent.at(-1).floor, 2);
  assert.strictEqual(sent.at(-1).pageEdge, 'first');
  assert.strictEqual(sent.at(-1).floorRequest, 1);
  T.changeMessageFloor(1, 0, 2);
  assert.strictEqual(sent.at(-1).floorRequest, 2);
  assert.strictEqual(sent.at(-1).floor, 2);
  assert.strictEqual(sent.at(-1).pageEdge, undefined);
  T.changeMessageFloor(1, 2, 3, true);
  assert.strictEqual(sent.at(-1).floorRequest, 3);
  assert.strictEqual(sent.at(-1).floor, 2);
  T.changeMessageFloor(-1, 2, 4);
  assert.strictEqual(sent.at(-1).floor, 0);
  assert.strictEqual(sent.at(-1).pageEdge, 'last');
  assert.strictEqual(sent.at(-1).fullText, messages[0].message);
  assert.strictEqual(sent.at(-1).sentenceOffset, Array.from('😀 第一条回复。').length);
  T.refreshLatestMessage(true);
  assert.strictEqual(sent.at(-1).floor, 0);
  assert.strictEqual(sent.at(-1).pageEdge, undefined);
  assert.strictEqual(sent.at(-1).floorRequest, null);
  T.CONFIG.showUserMessages = true;
  T.changeMessageFloor(1, 0);
  assert.strictEqual(sent.at(-1).floor, 1);
});

test('后台渲染和流式更新保留历史楼层，切会话时从首屏开始', () => {
  let chat = 'a';
  let messages = [
    { role: 'assistant', message: '上一楼已经读到末尾。' },
    { role: 'user', message: '用户消息' },
    { role: 'assistant', message: '稍后的回复。' }
  ];
  const sent = [];
  const handlers = new Map();
  const timers = [];
  sandbox.SillyTavern = { getCurrentChatId: () => chat, characterId: '7', name2: 'AI' };
  sandbox.getChatMessages = id => messages[id] ? [messages[id]] : [];
  sandbox.getLastMessageId = () => messages.length - 1;
  sandbox.tavern_events = Object.fromEntries([
    'CHAT_CHANGED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'GENERATION_STARTED',
    'GENERATION_ENDED', 'MESSAGE_RECEIVED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'STREAM_TOKEN_RECEIVED'
  ].map(name => [name, name]));
  sandbox.eventOn = (event, callback) => handlers.set(event, callback);
  sandbox.setTimeout = callback => timers.push(callback);
  T.CONFIG.showUserMessages = false;
  T.STATE.wsClient = { readyState: 1, send: payload => sent.push(JSON.parse(payload)) };
  T.initTavernEvents();
  T.refreshLatestMessage();
  handlers.get('GENERATION_STARTED')();
  handlers.get('STREAM_TOKEN_RECEIVED')();
  T.changeMessageFloor(-1, 2, 10);
  timers.shift()(); // 已安排的 token 更新也不能把读者拉回最新楼。
  handlers.get('CHARACTER_MESSAGE_RENDERED')(2);
  handlers.get('CHARACTER_MESSAGE_RENDERED')(0);
  assert.strictEqual(sent.at(-1).floor, 0);
  assert.strictEqual(sent.at(-1).followGenerating, false);
  handlers.get('GENERATION_ENDED')();
  timers.shift()();
  assert.strictEqual(sent.at(-1).floor, 0);
  T.changeMessageFloor(1, 0, 11);
  assert.strictEqual(sent.at(-1).pageEdge, 'first');
  assert.strictEqual(sent.at(-1).floor, 2);

  handlers.get('GENERATION_STARTED')();
  messages.push({ role: 'user', message: '新提示' }, {
    role: 'assistant', message: '这是新回复的第一句话。 新回复的第二句也已经出现了。'
  });
  handlers.get('STREAM_TOKEN_RECEIVED')();
  timers.shift()();
  assert.strictEqual(sent.at(-1).floor, 4);
  assert.strictEqual(sent.at(-1).pageEdge, 'first');
  assert.strictEqual(sent.at(-1).followGenerating, false);
  sandbox.window.STThiefBook.next();
  messages[4].message += '继续生成的第三句话。';
  handlers.get('STREAM_TOKEN_RECEIVED')();
  timers.shift()();
  assert.strictEqual(sent.at(-1).curIdx, 2);
  assert.strictEqual(sent.at(-1).pageEdge, undefined);
  handlers.get('GENERATION_ENDED')();
  timers.shift()();
  assert.strictEqual(sent.at(-1).curIdx, 2);

  chat = 'b';
  messages[4] = { role: 'assistant', message: '另一个会话的同号楼层。' };
  handlers.get('CHAT_CHANGED')();
  assert.strictEqual(sent.at(-1).chatId, 'character:7/b');
  assert.strictEqual(sent.at(-1).floor, 4);
  assert.strictEqual(sent.at(-1).pageEdge, 'first');
  messages = [];
  handlers.get('MESSAGE_DELETED')();
  assert.strictEqual(sent.at(-1).floor, -1);
  assert.match(sent.at(-1).fullText, /暂无消息/);

  chat = null;
  handlers.get('CHAT_CHANGED')();
  T.restoreDesktopPosition({ floor: 0, curIdx: 1, chatId: 'character:7/a' });
  assert.strictEqual(T.STATE.pendingResume.floor, 0);
  chat = 'a';
  messages = [
    { role: 'assistant', message: '上次正在阅读的楼层。' },
    { role: 'assistant', message: '最新回复。' }
  ];
  handlers.get('CHAT_CHANGED')();
  assert.strictEqual(sent.at(-1).floor, 0);
  assert.strictEqual(sent.at(-1).resumeFloor, 0);
  handlers.get('CHAT_CHANGED')();
  assert.strictEqual(sent.at(-1).floor, 0);
  assert.strictEqual(sent.at(-1).pageEdge, undefined);
});

test('仅主动修改宽度时向桌面发送尺寸', () => {
  const sent = [];
  T.STATE.wsClient = { readyState: 1, send: payload => sent.push(JSON.parse(payload)) };
  T.CONFIG.barWidth = 3200;
  T.CONFIG.barWidthPending = true;
  T.syncToDesktop();
  assert.deepStrictEqual(sent[0], { action: 'set_window_width', barWidth: 3200 });
  assert.strictEqual(sent[1].barWidth, undefined);
  assert.strictEqual(sent[1].config.barWidth, undefined);
  assert.strictEqual(JSON.parse(storage.get('ST_THIEF_CONFIG_V3')).barWidthPending, false);
  T.syncToDesktop();
  assert.deepStrictEqual(sent.map(frame => frame.action || frame.type), ['set_window_width', 'sync', 'sync']);
});

test('连接建立前可以取消桌面同步，重复启动只创建一个连接', () => {
  const connections = [];
  sandbox.WebSocket = class {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() {
      this.readyState = 0;
      connections.push(this);
    }
    close() { this.closed = true; }
  };
  T.STATE.wsClient = null;
  T.initDesktopBridge();
  T.initDesktopBridge();
  assert.strictEqual(connections.length, 1);
  T.stopDesktopBridge();
  assert.strictEqual(connections[0].closed, true);
  assert.strictEqual(connections[0].onopen, null);
  assert.strictEqual(T.STATE.wsClient, null);
});

test('回复选项可在正文白名单外单独展示，并遵守黑名单', () => {
  T.CONFIG.enableWhitelist = true;
  const raw = '<content>剧情正文。</content><think><options><option>隐藏行</option></options></think>'
    + '&lt;choices&gt;<choice>往树林走</choice><choice>留在原地</choice>&lt;/choices&gt;';
  assert.strictEqual(T.filterThinkingAndTags(raw, 0), '剧情正文。');
  assert.deepStrictEqual(Array.from(T.extractReplyChoices(raw)), ['往树林走', '留在原地']);
  assert.deepStrictEqual(Array.from(T.extractReplyChoices('正文\n**行动选项：**\nA. 先询问\nB. 返回营地\n\n其他说明')),
    ['A. 先询问', 'B. 返回营地']);
  assert.deepStrictEqual(Array.from(T.extractReplyChoices('普通说明\n1. 甲\n2. 乙')), []);
});

test('正文黑名单里的 options 和 option 仍可在独立选项面板中打开', () => {
  T.CONFIG.tagBlacklist = [...T.CONFIG.tagBlacklist, 'options', 'option'];
  const raw = '剧情正文。<options><option>先找路<think>隐藏内容</think></option>'
    + '<option>原地等候</option></options><think><options><option>隐藏选项</option></options></think>';
  assert.strictEqual(T.filterThinkingAndTags(raw, 0), '剧情正文。');
  assert.deepStrictEqual(Array.from(T.extractReplyChoices(raw)), ['先找路', '原地等候']);
  assert.strictEqual(T.filterThinkingAndTags(raw, 0), '剧情正文。');
});

test('生成失败后重试沿用已发送消息，恢复成功后清除重试状态', async () => {
  const chat = [{ role: 'assistant', message: '对话开始。' }];
  const commands = [];
  const frames = [];
  let userSends = 0;
  sandbox.SillyTavern = { getCurrentChatId: () => 'retry-test', characterId: '7' };
  sandbox.getLastMessageId = () => chat.length - 1;
  sandbox.getChatMessages = id => chat[id] ? [chat[id]] : [];
  sandbox.WebSocket = { OPEN: 1 };
  T.CONFIG.enableDesktopSync = true;
  T.STATE.wsAuthenticated = true;
  T.STATE.wsClient = { readyState: 1, send: payload => frames.push(JSON.parse(payload)) };
  T.refreshLatestMessage(false, true);
  sandbox.createChatMessages = async messages => {
    userSends++;
    chat.push(...messages);
  };
  sandbox.triggerSlash = async command => {
    commands.push(command);
    if (commands.length === 1) {
      chat.push({ role: 'assistant', message: '...' });
      throw new Error('test provider failure');
    }
    chat.at(-1).message = '成功生成的新回复。';
  };

  await T.submitReply('中文标点，保留！');
  assert.strictEqual(frames.at(-1).generationStatus, 'failed');
  assert.strictEqual(frames.at(-1).canRetryGeneration, true);
  await T.retryGeneration();
  assert.deepStrictEqual(commands, ['/trigger await=true', '/regenerate await=true']);
  assert.strictEqual(userSends, 1);
  assert.strictEqual(chat[1].message, '中文标点，保留！');
  assert.strictEqual(frames.at(-1).generationStatus, 'complete');
  assert.strictEqual(frames.at(-1).canRetryGeneration, false);
});

for (const [name, fn] of tests) {
  await runTest(name, fn);
}
console.log(`\n${passed} 项通过${process.exitCode ? '，存在失败项' : '，全部通过'}`);
