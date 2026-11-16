/**
 * ======================================================================================
 * ST-Thief-Book: 酒馆助手（Tavern Helper）隐蔽摸鱼阅读与回复工具 (v3.6 桌面专属版)
 * 仿 VS Code 知名摸鱼插件 Thief-Book 设计
 *
 * 架构：Web 端为无界面桥接后端，桌面端 thief_desktop_bar.py 是唯一阅读 UI。
 * 1. Web 端职责：消息监听、白名单正文提取 + 思考黑名单剥离、整段分句状态机、
 *    回复发送 / Swipe / 中止生成，经 WebSocket (127.0.0.1:18899, 密钥认证) 同步桌面端
 * 2. ⚙️ 设置面板：魔法棒（扩展）菜单「摸鱼条」一键呼出，自定义黑白名单标签、阅读配置与桥接密钥配对
 * 3. 桌面端职责：置顶隐蔽状态栏渲染、整段分屏翻阅、老板键、自动阅读、贴边隐藏等
 * 4. 一键老板键：桌面端 Esc 秒切纯代码编译状态
 * ======================================================================================
 */

(function () {
  'use strict';

  // 默认标签黑名单预设 (严格仅包含纯思考/推理/状态/提示元数据标签，绝不包含正文容器！)
  const DEFAULT_TAG_BLACKLIST = [
    'think', 'thought', 'cot', 'scratchpad', 'reasoning', 'analysis', 'plan',
    'internal_monologue', 'system_note', 'thought_process', 'thinking', 'status',
    'bbi_image', 'fox_hugou', 'fox_selc', 'fox_tip', 'fox_input', 'think_fox~', 'so_seq', 'details', 'system'
  ];

  // 默认白名单容器标签预设 (用于提取包裹在特定标签内的正文，如 <content>、<output>、<response>、<dialogue>)
  const DEFAULT_TAG_WHITELIST = [
    'content', 'output', 'response', 'dialogue', 'story', 'reply', 'text', 'narration', 'message', '正文'
  ];

  // ------------------------------------------------------------------------------------
  // 配置与状态管理
  // ------------------------------------------------------------------------------------
  const CONFIG = {
    // 是否启用本地 Python 桌面端 (WebSocket) 同步 (默认 true：桌面端是唯一阅读 UI，未启动时静默重试)
    enableDesktopSync: true,
    // 布局模式: 'double' (双行边看边回) | 'single' (32px极窄单行)
    layoutMode: 'double',
    // 文本过滤模式: 'pure' (纯净模式：绝不引入美化HTML，剥离思考块与标签) | 'regex' (正则清洗模式)
    filterMode: 'pure',
    // 是否显示用户输入消息 (默认 false：摸鱼只看AI/小说回复，自动跳过用户消息；设为 true 则允许显示和阅读用户消息)
    showUserMessages: false,
    // 是否启用白名单提取模式：若开启且消息中存在白名单标签，则提取白名单内容并在其中剔除黑名单；若未找到则自动安全降级读取全文
    enableWhitelist: true,
    // 白名单容器列表 (若文本中有这些标签，只提取其中的正文)
    tagWhitelist: [...DEFAULT_TAG_WHITELIST],
    // 自定义标签黑名单 (这些标签及其内部思考内容将被彻底删除)
    tagBlacklist: [...DEFAULT_TAG_BLACKLIST],
    // 角色名展示模式: 'compact' (精简68px胶囊，不占位) | 'hidden' (隐藏角色名留出最大空间) | 'full' (完整展示)
    charNameMode: 'compact',
    // 换行模式: 'wrap' (默认：长句自动折行显示全部文字，绝不截断) | 'single' (强制单行)
    wrapMode: 'wrap',
    // 极简模式: true (纯文字+背景无边框，极度隐蔽) | false (标准 VS Code 状态栏)
    minimalMode: false,
    // 隐私模式: true (鼠标悬浮在窗口上方时才显示，移开时窗口隐藏) | false (常驻显示)
    privacyMode: false,
    // 尺寸配置
    barWidth: 840,
    // 透明度 (0.2 ~ 1.0)
    opacity: 0.95,
    // 是否过滤动作描写括号 *xxx*
    filterActions: false,
    // 单句最小与最大长度
    minSentenceLen: 6,
    maxSentenceLen: 42,
    // WebSocket 桌面同步端口
    wsPort: 18899,
    // 桌面端桥接密钥 (桌面端右键菜单 → 复制桥接密钥)
    bridgeToken: '',
    // 老板键伪装文本模板
    bossTemplates: [
      '⎇ main*  ✓ 0 ⨉ 0  |  TypeScript 5.4.5  UTF-8  LF  Ln 142, Col 8  Ready',
      '[webpack 5.89.0] Compiled successfully in 1240 ms. Watching for file changes...'
    ]
  };

  const STATE = {
    currentMsgId: -1,
    currentSentenceIndex: 0,
    sentences: [],
    characterName: 'AI',
    userName: 'User',
    isGenerating: false,
    isBossKey: false,
    isSettingsOpen: false,
    wsClient: null,
    wsReconnectTimer: null,
    wsConnecting: false,
    wsAuthenticated: false,
    streamRenderTimer: null
  };

  // 获取当前屏幕实际可用宽度 (移动端自适应，绝不截断溢出)
  function getEffectiveBarWidth() {
    let w = CONFIG.barWidth || 840;
    try {
      const topWin = window.top || window;
      const vp = topWin.visualViewport;
      const curW = (vp ? vp.width : topWin.innerWidth) || (topWin.screen ? topWin.screen.width : 0);
      if (curW > 0 && curW < w) {
        w = Math.max(260, Math.floor(curW));
      }
    } catch (e) {}
    return w;
  }

  // 配置枚举合法值与标签列表清洗（本地加载与 WS update_config 共用同一防线）
  const CONFIG_ENUMS = {
    filterMode: ['pure', 'regex'],
    charNameMode: ['compact', 'hidden', 'full'],
    wrapMode: ['wrap', 'single'],
    layoutMode: ['single', 'double']
  };

  function sanitizeTagList(arr) {
    if (!Array.isArray(arr)) return null;
    const cleaned = arr.slice(0, 100)
      .map(t => String(t).trim().replace(/^[<\[]+|[>\]]+$/g, ''))
      .filter(t => t && t.length <= 64);
    return Array.from(new Set(cleaned));
  }

  // 读取持久化配置
  function loadSavedConfig() {
    try {
      const raw = localStorage.getItem('ST_THIEF_CONFIG_V3') || localStorage.getItem('ST_THIEF_CONFIG_V2');
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved.enableDesktopSync === 'boolean') {
          CONFIG.enableDesktopSync = saved.enableDesktopSync;
        }
        if (typeof saved.showUserMessages === 'boolean') {
          CONFIG.showUserMessages = saved.showUserMessages;
        }
        if (Array.isArray(saved.tagBlacklist)) {
          const cleanedBlacklist = sanitizeTagList(saved.tagBlacklist) || [];
          const merged = Array.from(new Set([...DEFAULT_TAG_BLACKLIST, ...cleanedBlacklist]));
          CONFIG.tagBlacklist = merged;
        }
        if (Array.isArray(saved.tagWhitelist)) {
          const cleanedWhitelist = sanitizeTagList(saved.tagWhitelist);
          if (cleanedWhitelist) CONFIG.tagWhitelist = cleanedWhitelist;
        }
        if (typeof saved.bridgeToken === 'string') {
          CONFIG.bridgeToken = saved.bridgeToken.slice(0, 128);
        }
        if (typeof saved.enableWhitelist === 'boolean') {
          CONFIG.enableWhitelist = saved.enableWhitelist;
        }
        if (typeof saved.filterActions === 'boolean') {
          CONFIG.filterActions = saved.filterActions;
        }
        if (CONFIG_ENUMS.filterMode.includes(saved.filterMode)) {
          CONFIG.filterMode = saved.filterMode;
        }
        if (typeof saved.opacity === 'number') {
          CONFIG.opacity = Math.max(0.15, Math.min(1, saved.opacity));
        }
        if (CONFIG_ENUMS.layoutMode.includes(saved.layoutMode)) {
          CONFIG.layoutMode = saved.layoutMode;
        }
        if (CONFIG_ENUMS.charNameMode.includes(saved.charNameMode)) {
          CONFIG.charNameMode = saved.charNameMode;
        }
        if (CONFIG_ENUMS.wrapMode.includes(saved.wrapMode)) {
          CONFIG.wrapMode = saved.wrapMode;
        }
        if (typeof saved.minimalMode === 'boolean') {
          CONFIG.minimalMode = saved.minimalMode;
        }
        if (typeof saved.privacyMode === 'boolean') {
          CONFIG.privacyMode = saved.privacyMode;
        }
        if (typeof saved.barWidth === 'number' && saved.barWidth >= 360) {
          CONFIG.barWidth = saved.barWidth;
        }
      }
    } catch (e) {
      console.warn('[ST-Thief-Book] 读取本地配置异常:', e);
    }
  }

  // 保存持久化配置
  function saveCurrentConfig() {
    try {
      const data = {
        enableDesktopSync: CONFIG.enableDesktopSync,
        bridgeToken: CONFIG.bridgeToken,
        showUserMessages: CONFIG.showUserMessages,
        enableWhitelist: CONFIG.enableWhitelist,
        tagWhitelist: CONFIG.tagWhitelist,
        tagBlacklist: CONFIG.tagBlacklist,
        filterActions: CONFIG.filterActions,
        filterMode: CONFIG.filterMode,
        charNameMode: CONFIG.charNameMode,
        wrapMode: CONFIG.wrapMode,
        minimalMode: CONFIG.minimalMode,
        privacyMode: CONFIG.privacyMode,
        opacity: CONFIG.opacity,
        layoutMode: CONFIG.layoutMode,
        barWidth: CONFIG.barWidth
      };
      localStorage.setItem('ST_THIEF_CONFIG_V3', JSON.stringify(data));

      if (typeof replaceVariables === 'function') {
        try {
          replaceVariables(data, { type: 'script' });
        } catch (e) {}
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------------------------
  // 白名单提取与黑名单剥离引擎 (在白名单内剔除黑名单)
  // ------------------------------------------------------------------------------------
  function preDecodeEntities(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, '&');
  }

  function cleanHtmlAndStyles(html) {
    if (!html || typeof html !== 'string') return '';
    let text = html;

    // 1. 彻底剔除样式表与脚本内容（防止 CSS 规则如 .bubble { color: red; } 变为文本！）
    text = text.replace(HTML_JUNK_RE, '');

    // 2. 利用 DOMParser 剔除明确的 UI 干扰元素
    if (text.includes('<') || text.includes('&')) {
      try {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        doc.querySelectorAll('style, script, svg, img, video, audio, noscript, iframe, link, meta').forEach(el => el.remove());
        doc.querySelectorAll('.mes_reasoning, .reasoning_block, .thinking, .thinking-block, details, think, thought, reasoning, status').forEach(el => el.remove());
        doc.querySelectorAll('.avatar, .avatar-container, .mes_button_menu, .badge, .extra-badges').forEach(el => el.remove());

        const validSelectors = getFilterRegexes().selector;
        if (validSelectors) {
          try { doc.querySelectorAll(validSelectors).forEach(el => el.remove()); } catch (e) {}
        }

        const domText = doc.body.innerText || doc.body.textContent || '';
        if (domText && domText.trim()) {
          text = domText;
        }
      } catch (e) {
        // DOMParser 降级
      }
    }

    // 3. 解码常见 HTML 实体
    text = preDecodeEntities(text);

    // 4. 剥离残留的任意尖括号标签（替换为空格，保留标签内文字，绝不删字！）
    text = text.replace(/<[^>]+>/g, ' ');

    // 5. 剥离 BBCode 格式化标记如 [b], [/b], [color] 等（保留内容）
    text = text.replace(/\[\/?(?:b|i|u|s|color|size|font)[^\]]*\]/gi, ' ');

    return text.replace(/[ \t\r]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  }

  // 样式/脚本/注释合并为单遍扫描；{0,100000}? 上限防恶意未闭合长文引发 O(n²) 回溯
  const HTML_JUNK_RE = /<style[\s\S]{0,100000}?<\/style>|<script[\s\S]{0,100000}?<\/script>|<svg[\s\S]{0,100000}?<\/svg>|<!--[\s\S]{0,100000}?-->/gi;

  // 过滤正则缓存：标签列表不变时直接复用；所有标签合并为 alternation，10 遍扫描替代 标签数×10 遍
  let _filterCache = { key: null };
  function getFilterRegexes() {
    const cleanTag = t => String(t).trim().replace(/^[<\[]+|[>\]]+$/g, '');
    const wl = (CONFIG.tagWhitelist || []).map(cleanTag).filter(Boolean);
    const bl = (CONFIG.tagBlacklist || []).map(cleanTag).filter(Boolean);
    const key = wl.join(',') + '|' + bl.join(',');
    if (_filterCache.key === key) return _filterCache;

    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 长标签优先，避免 think 词干抢先匹配 thinking
    const alt = tags => tags.slice().sort((a, b) => b.length - a.length).map(esc).join('|');
    const wlAlt = alt(wl);
    const blAlt = alt(bl);
    const B = '{0,100000}?';
    const cache = { key, wlXml: null, wlBracket: null, bl: [], selector: '' };
    if (wlAlt) {
      cache.wlXml = new RegExp('<\\s*(' + wlAlt + ')(?:[\\s:][^>]*)?>([\\s\\S]' + B + ')<\\/\\s*\\1\\s*>', 'gi');
      cache.wlBracket = new RegExp('\\[\\s*(' + wlAlt + ')(?:[\\s:][^\\]]*)?\\]([\\s\\S]' + B + ')\\[\\/\\s*\\1\\s*\\]', 'gi');
    }
    if (blAlt) {
      cache.bl = [
        // 闭合 XML / 中括号标签（连同内部内容整体删除，\1 回引保证同标签闭合）
        new RegExp('<\\s*(' + blAlt + ')(?:[\\s:][^>]*)?>[\\s\\S]' + B + '<\\/\\s*\\1\\s*>', 'gi'),
        new RegExp('\\[\\s*(' + blAlt + ')(?:[\\s:][^\\]]*)?\\][\\s\\S]' + B + '\\[\\/\\s*\\1\\s*\\]', 'gi'),
        // 冒号指令型单标签 [system: ...] <system: ...> (system: ...) {system: ...}
        new RegExp('\\[\\s*(?:' + blAlt + ')\\s*[:：][^\\]]*\\]', 'gi'),
        new RegExp('<\\s*(?:' + blAlt + ')\\s*[:：][^>]*>', 'gi'),
        new RegExp('\\(\\s*(?:' + blAlt + ')\\s*[:：][^\\)]*\\)', 'gi'),
        new RegExp('\\{\\s*(?:' + blAlt + ')\\s*[:：][^\\}]*\\}', 'gi'),
        // 流式未闭合标签：删除自 opening tag 至文末
        new RegExp('<\\s*(?:' + blAlt + ')(?:[\\s:][^>]*)?>[\\s\\S]*$', 'gi'),
        new RegExp('\\[\\s*(?:' + blAlt + ')(?:[\\s:][^\\]]*)?\\][\\s\\S]*$', 'gi'),
        // 游离闭合或单标签
        new RegExp('<\\/?\\s*(?:' + blAlt + ')(?:[\\s:][^>]*)?>', 'gi'),
        new RegExp('\\[\\/?\\s*(?:' + blAlt + ')(?:[\\s:][^\\]]*)?\\]', 'gi')
      ];
    }
    cache.selector = bl.filter(t => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(t)).join(',');
    _filterCache = cache;
    return cache;
  }

  function processWhitelistAndBlacklist(content, forceDisableWhitelist = false) {
    if (!content || typeof content !== 'string') return '';
    // 关键：预先解码 HTML 实体，避免 &lt;tag&gt; 绕过黑名单！
    let text = preDecodeEntities(content);
    text = text.replace(HTML_JUNK_RE, '');

    const rx = getFilterRegexes();

    // 白名单容器正文提取：未匹配任何白名单时回退为全文，绝不丢弃正文
    if (!forceDisableWhitelist && CONFIG.enableWhitelist && rx.wlXml) {
      const extracted = [];
      for (const m of text.matchAll(rx.wlXml)) {
        if (m[2] && m[2].trim()) extracted.push(m[2].trim());
      }
      for (const m of text.matchAll(rx.wlBracket)) {
        if (m[2] && m[2].trim()) extracted.push(m[2].trim());
      }
      if (extracted.length > 0) {
        text = extracted.join('\n');
      }
    }

    // 黑名单及其内部思考过程彻底剥离
    for (const re of rx.bl) {
      text = text.replace(re, '');
    }

    // 剥离 Markdown 思考代码块 ```thought ... ```
    text = text.replace(/```(?:thought|thinking|think|cot|reasoning)[\s\S]*?```/gi, '');

    return text;
  }

  function filterThinkingAndTags(rawText, messageId) {
    if (!rawText || typeof rawText !== 'string') return '';

    // 1. 白名单提取 + 黑名单剥离
    let text = processWhitelistAndBlacklist(rawText);

    // 2. 动作描写过滤 (*xxx*)
    if (CONFIG.filterActions) {
      text = text.replace(/\*[^*]+\*/g, '').trim();
    }

    // 3. 模式 A：纯净小说模式
    let result = '';
    if (CONFIG.filterMode === 'pure') {
      result = cleanHtmlAndStyles(text);
    } else {
      // 模式 B：酒馆正则模式
      if (typeof retrieveDisplayedMessage === 'function' && typeof messageId === 'number' && messageId >= 0) {
        try {
          const $mes = retrieveDisplayedMessage(messageId);
          if ($mes && $mes.length > 0) {
            const $clone = $mes.clone();
            $clone.find('.mes_reasoning, .reasoning_block, .thinking, .thinking-block, details, script, style, .st-hidden, .mes_button_menu').remove();
            const validSelectors = getFilterRegexes().selector;
            if (validSelectors) {
              try { $clone.find(validSelectors).remove(); } catch (e) {}
            }
            const rendered = $clone.html();
            if (rendered && rendered.trim()) {
              result = cleanHtmlAndStyles(processWhitelistAndBlacklist(rendered));
            }
          }
        } catch (e) {}
      }

      if (!result && typeof formatAsDisplayedMessage === 'function' && typeof messageId === 'number' && messageId >= 0) {
        try {
          const formatted = formatAsDisplayedMessage(text, { message_id: messageId });
          result = cleanHtmlAndStyles(processWhitelistAndBlacklist(formatted));
        } catch (e) {}
      }

      if (!result && typeof formatAsTavernRegexedString === 'function') {
        try {
          const formatted = formatAsTavernRegexedString(text, 'ai_output', 'display', { depth: 0 });
          result = cleanHtmlAndStyles(processWhitelistAndBlacklist(formatted));
        } catch (e) {}
      }

      if (!result) {
        result = cleanHtmlAndStyles(text);
      }
    }

    // 4. 终极安全保底：若过滤后变为空白，但原始消息本来有字，执行宽容保底
    // 注意：保底也必须严格遵守黑名单，绝不能无视黑名单复活被剔除的黑名单文本！
    if (!result && rawText.trim()) {
      let safeFallback = processWhitelistAndBlacklist(rawText, true);
      safeFallback = cleanHtmlAndStyles(safeFallback);
      if (safeFallback) {
        return safeFallback;
      }
    }

    return result;
  }

  // ------------------------------------------------------------------------------------
  // 智能小说断句引擎
  // ------------------------------------------------------------------------------------
  function splitIntoSentences(text) {
    if (!text || typeof text !== 'string') return ['(暂无消息)'];

    let content = text.trim();
    if (!content) return ['(无对白内容)'];

    // 根据当前窗口/视口实际宽度动态评估单行最大字数容纳量 (适配手机端与小屏)
    const effectiveBarW = getEffectiveBarWidth();
    const lineCapChars = Math.max(12, Math.min(60, Math.floor((effectiveBarW - 140) / 16)));

    // 句子切分：支持在强句末标点（。！？!?；…\n）切分；
    // 当单句较长遇到逗号、顿号、破折号时，自然切分成单行小短句，超长文字顺延在下一行显示，绝不向下撑高窗口
    const rawSegments = content.split(/([。！？!?；…\n]+["”』」]?|[，,、—~～]+)/g);
    const result = [];
    let currentSentence = '';

    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i];
      if (!seg) continue;

      currentSentence += seg;

      const isHardPunct = /[。！？!?；…\n]/.test(seg);
      const isSoftPunct = /[，,、—~～]/.test(seg);
      const curLen = currentSentence.trim().length;

      const shouldBreakHard = isHardPunct && curLen >= CONFIG.minSentenceLen;
      const shouldBreakSoft = isSoftPunct && curLen >= Math.max(16, lineCapChars - 10);
      const isOverMax = curLen >= lineCapChars;

      if (shouldBreakHard || shouldBreakSoft || isOverMax || i === rawSegments.length - 1) {
        let clean = currentSentence.replace(/\r?\n+/g, ' ').trim();
        if (clean) {
          // 若单句依然超长，进一步切成单行顺延显示，绝不裁剪丢字
          while (clean.length > lineCapChars) {
            let splitPos = lineCapChars;
            const lookback = Math.max(10, splitPos - 8);
            for (let p = splitPos; p >= lookback; p--) {
              if (/[，,、 ；;。！？!?—~～…]/.test(clean[p - 1])) {
                splitPos = p;
                break;
              }
            }
            const chunk = clean.slice(0, splitPos).trim();
            if (chunk) result.push(chunk);
            clean = clean.slice(splitPos).trim();
          }
          if (clean) {
            result.push(clean);
          }
        }
        currentSentence = '';
      }
    }

    if (currentSentence.trim()) {
      let clean = currentSentence.replace(/\r?\n+/g, ' ').trim();
      while (clean.length > lineCapChars) {
        result.push(clean.slice(0, lineCapChars).trim());
        clean = clean.slice(lineCapChars).trim();
      }
      if (clean) result.push(clean);
    }

    return result.length > 0 ? result : [content];
  }

  // ------------------------------------------------------------------------------------
  // 数据同步与楼层读取
  // ------------------------------------------------------------------------------------
  function refreshLatestMessage(forceJumpToEnd = false) {
    try {
      const lastId = typeof getLastMessageId === 'function' ? getLastMessageId() : -1;
      if (lastId < 0) return;

      let targetId = lastId;
      if (!CONFIG.showUserMessages) {
        // 从最新一条消息向前寻找最近一条非用户消息 (AI/小说楼层)
        while (targetId >= 0) {
          const msgs = getChatMessages(targetId, { include_swipes: true });
          if (msgs && msgs[0] && !msgs[0].is_user && msgs[0].role !== 'user') {
            break;
          }
          targetId--;
        }
        // 如果未找到任何 AI 消息（例如纯新会话只有用户第一句输入），安全回退到 lastId
        if (targetId < 0) targetId = lastId;
      }

      const messages = getChatMessages(targetId, { include_swipes: true });
      if (!messages || messages.length === 0) return;

      const latest = messages[0];
      const isNewFloor = STATE.currentMsgId !== targetId;
      STATE.currentMsgId = targetId;

      STATE.characterName = latest.name || (typeof SillyTavern !== 'undefined' ? SillyTavern.name2 : 'AI');
      STATE.userName = typeof SillyTavern !== 'undefined' ? SillyTavern.name1 : 'User';

      let rawText = latest.message || '';
      if (latest.swipes && latest.swipes.length > 0 && typeof latest.swipe_id === 'number') {
        rawText = latest.swipes[latest.swipe_id] || rawText;
      }

      const cleanText = filterThinkingAndTags(rawText, targetId);
      const newSentences = splitIntoSentences(cleanText);
      STATE.sentences = newSentences;

      if (forceJumpToEnd) {
        STATE.currentSentenceIndex = Math.max(0, newSentences.length - 1);
      } else if (isNewFloor) {
        STATE.currentSentenceIndex = 0;
      } else if (STATE.currentSentenceIndex >= newSentences.length) {
        STATE.currentSentenceIndex = 0;
      }

      syncToDesktop();
    } catch (err) {
      console.warn('[ST-Thief-Book] 读取最新消息异常:', err);
    }
  }

  function changeMessageFloor(delta) {
    try {
      const lastId = typeof getLastMessageId === 'function' ? getLastMessageId() : 0;
      let targetId = STATE.currentMsgId + delta;
      if (targetId < 0) targetId = 0;
      if (targetId > lastId) targetId = lastId;

      if (!CONFIG.showUserMessages) {
        while (targetId >= 0 && targetId <= lastId) {
          const checkMsgs = getChatMessages(targetId, { include_swipes: true });
          if (checkMsgs && checkMsgs[0] && !checkMsgs[0].is_user && checkMsgs[0].role !== 'user') {
            break;
          }
          targetId += (delta >= 0 ? 1 : -1);
        }
        if (targetId < 0 || targetId > lastId) {
          flashStatusHint(delta > 0 ? '已是最新 AI 回复' : '已是最前 AI 回复');
          return;
        }
      }

      if (targetId === STATE.currentMsgId) return;

      const msgs = getChatMessages(targetId, { include_swipes: true });
      if (!msgs || msgs.length === 0) return;

      const msg = msgs[0];
      STATE.currentMsgId = targetId;
      STATE.characterName = msg.name || (typeof SillyTavern !== 'undefined' ? SillyTavern.name2 : 'AI');

      let rawText = msg.message || '';
      if (msg.swipes && msg.swipes.length > 0 && typeof msg.swipe_id === 'number') {
        rawText = msg.swipes[msg.swipe_id] || rawText;
      }

      const cleanText = filterThinkingAndTags(rawText, targetId);
      STATE.sentences = splitIntoSentences(cleanText);
      STATE.currentSentenceIndex = delta < 0 ? Math.max(0, STATE.sentences.length - 1) : 0;

      syncToDesktop();
    } catch (e) {
      console.error('[ST-Thief-Book] 切换楼层失败:', e);
    }
  }

  function jumpToMessageFloor(targetFloor, sentenceIdx) {
    try {
      const lastId = typeof getLastMessageId === 'function' ? getLastMessageId() : 0;
      let targetId = parseInt(targetFloor, 10);
      if (isNaN(targetId)) return;
      if (targetId < 0) targetId = 0;
      if (targetId > lastId) targetId = lastId;

      const msgs = getChatMessages(targetId, { include_swipes: true });
      if (!msgs || msgs.length === 0) {
        flashStatusHint(`未找到第 #${targetId} 楼`);
        return;
      }

      const msg = msgs[0];
      STATE.currentMsgId = targetId;
      STATE.characterName = msg.name || (typeof SillyTavern !== 'undefined' ? SillyTavern.name2 : 'AI');

      let rawText = msg.message || '';
      if (msg.swipes && msg.swipes.length > 0 && typeof msg.swipe_id === 'number') {
        rawText = msg.swipes[msg.swipe_id] || rawText;
      }

      const cleanText = filterThinkingAndTags(rawText, targetId);
      STATE.sentences = splitIntoSentences(cleanText);
      // 可选句序（1 起）：桌面端重启恢复阅读位置时传入；缺省回第一句
      const idx = parseInt(sentenceIdx, 10);
      STATE.currentSentenceIndex = isNaN(idx) ? 0 : Math.max(0, Math.min(STATE.sentences.length - 1, idx - 1));

      syncToDesktop();
      flashStatusHint(`已跳转至第 #${targetId} 楼`);
    } catch (e) {
      console.error('[ST-Thief-Book] 跳转楼层失败:', e);
    }
  }

  function toggleCharNameMode() {
    if (CONFIG.charNameMode === 'compact') {
      CONFIG.charNameMode = 'hidden';
      flashStatusHint('角色名已完全隐藏 (享受最大正文空间)');
    } else if (CONFIG.charNameMode === 'hidden') {
      CONFIG.charNameMode = 'full';
      flashStatusHint(`角色名完整显示: [${STATE.characterName}]`);
    } else {
      CONFIG.charNameMode = 'compact';
      flashStatusHint('角色名已切为精简胶囊 (68px)');
    }
    saveCurrentConfig();
    syncToDesktop();
  }

  function toggleWrapMode() {
    CONFIG.wrapMode = CONFIG.wrapMode === 'wrap' ? 'single' : 'wrap';
    saveCurrentConfig();
    flashStatusHint(`换行模式: ${CONFIG.wrapMode === 'wrap' ? '↩️ 自动折行全显' : '↔️ 单行切片'}`);
    syncToDesktop();
  }

  function toggleMinimalMode(forcedState) {
    CONFIG.minimalMode = typeof forcedState === 'boolean' ? forcedState : !CONFIG.minimalMode;
    saveCurrentConfig();
    flashStatusHint(`极简模式: ${CONFIG.minimalMode ? '✨ 已开启 (纯文字+背景)' : '📋 已关闭 (标准状态栏)'}`);
    syncToDesktop();
  }

  function togglePrivacyMode(forcedState) {
    CONFIG.privacyMode = typeof forcedState === 'boolean' ? forcedState : !CONFIG.privacyMode;
    saveCurrentConfig();
    flashStatusHint(`隐私模式: ${CONFIG.privacyMode ? '👻 已开启 (移开隐藏 / 悬浮显示)' : '👁️ 已关闭 (常驻显示)'}`);
    syncToDesktop();
  }

  function toggleShowUserMessages() {
    CONFIG.showUserMessages = !CONFIG.showUserMessages;
    saveCurrentConfig();
    flashStatusHint(CONFIG.showUserMessages ? '已开启显示用户消息' : '已隐藏用户消息 (仅阅读AI与小说)');
    refreshLatestMessage(false);
    syncToDesktop();
  }

  // ------------------------------------------------------------------------------------
  // 翻句控制
  // ------------------------------------------------------------------------------------
  function nextSentence() {
    if (STATE.isBossKey) {
      return;
    }

    if (STATE.currentSentenceIndex < STATE.sentences.length - 1) {
      STATE.currentSentenceIndex++;
      syncToDesktop();
    } else {
      const lastId = typeof getLastMessageId === 'function' ? getLastMessageId() : -1;
      if (STATE.currentMsgId < lastId) {
        changeMessageFloor(1);
      } else {
        flashStatusHint('已读完最新句，可直接在下方输入框回复');
      }
    }
  }

  function prevSentence() {
    if (STATE.isBossKey) {
      return;
    }

    if (STATE.currentSentenceIndex > 0) {
      STATE.currentSentenceIndex--;
      syncToDesktop();
    } else if (STATE.currentMsgId > 0) {
      changeMessageFloor(-1);
    }
  }

  // 无界面桥接后端的状态提示：优先酒馆 toastr，降级控制台
  function flashStatusHint(text) {
    try {
      const topWin = getSafeTopWin();
      if (topWin && topWin.toastr && typeof topWin.toastr.info === 'function') {
        topWin.toastr.info(text, 'ST-Thief-Book', { timeOut: 2500 });
        return;
      }
    } catch (e) {}
    console.log('[ST-Thief-Book] 💡 ' + text);
  }

  // ------------------------------------------------------------------------------------
  // 回复发送与 AI 生成控制
  // ------------------------------------------------------------------------------------
  async function submitReply(userInput) {
    const text = (userInput || '').trim();
    if (!text) return;

    STATE.isGenerating = true;
    syncToDesktop();

    try {
      if (typeof createChatMessages === 'function') {
        await createChatMessages([{ role: 'user', message: text }]);
      }

      if (typeof triggerSlash === 'function') {
        await triggerSlash('/trigger');
      }
    } catch (err) {
      console.error('[ST-Thief-Book] 发送消息失败:', err);
      flashStatusHint('发送失败: ' + (err.message || '未知错误'));
    } finally {
      STATE.isGenerating = false;
      refreshLatestMessage(false);
      setTimeout(() => refreshLatestMessage(false), 300);
      setTimeout(() => refreshLatestMessage(false), 800);
      setTimeout(() => refreshLatestMessage(false), 1500);
    }
  }

  async function swipeMessage() {
    if (STATE.isGenerating) return;
    try {
      flashStatusHint('正在重新生成 (Swipe)...');
      STATE.isGenerating = true;
      syncToDesktop();
      if (typeof triggerSlash === 'function') {
        await triggerSlash('/swipe');
      }
    } catch (e) {
      console.error('[ST-Thief-Book] Swipe 失败:', e);
    } finally {
      STATE.isGenerating = false;
      refreshLatestMessage(false);
      setTimeout(() => refreshLatestMessage(false), 300);
      setTimeout(() => refreshLatestMessage(false), 800);
      setTimeout(() => refreshLatestMessage(false), 1500);
    }
  }

  function stopGeneration() {
    try {
      if (typeof SillyTavern !== 'undefined' && SillyTavern.stopGeneration) {
        SillyTavern.stopGeneration();
      } else if (typeof triggerSlash === 'function') {
        triggerSlash('/stop');
      }
      STATE.isGenerating = false;
      flashStatusHint('已中止生成');
      syncToDesktop();
    } catch (e) {
      console.warn('[ST-Thief-Book] 中止生成失败:', e);
    }
  }

  // ------------------------------------------------------------------------------------
  // 老板键、布局、过滤模式与设置面板
  // ------------------------------------------------------------------------------------
  function toggleBossKey(forcedState) {
    STATE.isBossKey = typeof forcedState === 'boolean' ? forcedState : !STATE.isBossKey;
    syncToDesktop();
  }

  function toggleLayoutMode() {
    CONFIG.layoutMode = CONFIG.layoutMode === 'double' ? 'single' : 'double';
    saveCurrentConfig();
    syncToDesktop();
  }

  function toggleFilterMode() {
    CONFIG.filterMode = CONFIG.filterMode === 'pure' ? 'regex' : 'pure';
    saveCurrentConfig();
    flashStatusHint(`模式: ${CONFIG.filterMode === 'pure' ? '🧹 纯净小说(去HTML美化)' : '🎨 酒馆正则清洗'}`);
    refreshLatestMessage(false);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ensureStandaloneSettingsStyles(topDoc) {
    if (!topDoc || topDoc.getElementById('st-thief-standalone-settings-style')) return;
    const style = topDoc.createElement('style');
    style.id = 'st-thief-standalone-settings-style';
    style.textContent = `
      #st-thief-standalone-settings-modal {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000000;
        padding: 16px;
        box-sizing: border-box;
        animation: stThiefFadeIn 0.15s ease-out;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, Consolas, sans-serif;
        color: #cccccc;
      }
      @keyframes stThiefFadeIn {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }
      #st-thief-standalone-settings-modal * {
        box-sizing: border-box;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-card {
        background: #1e1e1e;
        color: #cccccc;
        border: 1px solid #333333;
        border-radius: 8px;
        width: 100%;
        max-width: 680px;
        max-height: 90vh;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.85);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: #252526;
        border-bottom: 1px solid #333333;
        user-select: none;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-title {
        font-size: 13px;
        font-weight: 600;
        color: #cccccc;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-close {
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        color: #888888;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.15s;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-close:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-body {
        padding: 14px 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-size: 11px;
        line-height: 1.5;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-body::-webkit-scrollbar {
        width: 6px;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-body::-webkit-scrollbar-thumb {
        background: #333333;
        border-radius: 3px;
      }
      #st-thief-standalone-settings-modal .st-thief-section {
        background: #252526;
        border: 1px solid #2d2d2d;
        border-radius: 6px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      #st-thief-standalone-settings-modal .st-thief-section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      #st-thief-standalone-settings-modal .st-thief-section-title {
        font-size: 11px;
        font-weight: 600;
        color: #cccccc;
      }
      #st-thief-standalone-settings-modal .st-thief-btn-link {
        font-size: 11px;
        color: #888888;
        cursor: pointer;
        text-decoration: underline;
        transition: color 0.15s;
      }
      #st-thief-standalone-settings-modal .st-thief-btn-link:hover {
        color: #cccccc;
      }
      #st-thief-standalone-settings-modal .st-thief-textarea {
        width: 100%;
        height: 38px;
        background: #181818;
        color: #cccccc;
        border: 1px solid #3c3c3c;
        border-radius: 4px;
        padding: 5px 8px;
        font-family: Consolas, 'Courier New', monospace;
        font-size: 11px;
        resize: none;
        outline: none;
        line-height: 1.4;
        transition: border-color 0.15s;
      }
      #st-thief-standalone-settings-modal .st-thief-textarea:focus {
        border-color: #007acc;
      }
      #st-thief-standalone-settings-modal .st-thief-chips-row {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      #st-thief-standalone-settings-modal .st-thief-chips-label {
        font-size: 10px;
        color: #777777;
      }
      #st-thief-standalone-settings-modal .tb-wl-chip,
      #st-thief-standalone-settings-modal .tb-bl-chip {
        padding: 2px 7px;
        background: #1e1e1e;
        border: 1px solid #3c3c3c;
        border-radius: 3px;
        font-size: 10px;
        cursor: pointer;
        user-select: none;
        transition: all 0.15s;
      }
      #st-thief-standalone-settings-modal .tb-wl-chip { color: #4ec9b0; }
      #st-thief-standalone-settings-modal .tb-wl-chip:hover {
        background: #1e3a35;
        color: #73e6cf;
        border-color: #4ec9b0;
      }
      #st-thief-standalone-settings-modal .tb-bl-chip { color: #f48771; }
      #st-thief-standalone-settings-modal .tb-bl-chip:hover {
        background: #3c2420;
        color: #ffa593;
        border-color: #f48771;
      }
      #st-thief-standalone-settings-modal .st-thief-current-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      #st-thief-standalone-settings-modal .tb-cur-chip {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 1px 3px 1px 6px;
        background: #252526;
        border: 1px solid #3c3c3c;
        border-radius: 3px;
        font-size: 10px;
        user-select: none;
      }
      #st-thief-standalone-settings-modal .tb-cur-wl { color: #4ec9b0; }
      #st-thief-standalone-settings-modal .tb-cur-bl { color: #f48771; }
      #st-thief-standalone-settings-modal .tb-cur-x {
        cursor: pointer;
        color: #888888;
        padding: 0 3px;
        border-radius: 2px;
        font-weight: bold;
        transition: all 0.12s;
      }
      #st-thief-standalone-settings-modal .tb-cur-x:hover {
        color: #ffffff;
        background: #e06c75;
      }
      #st-thief-standalone-settings-modal .st-thief-hint {
        font-size: 10px;
        color: #777777;
        line-height: 1.3;
      }
      #st-thief-standalone-settings-modal .st-thief-form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 16px;
      }
      @media (max-width: 600px) {
        #st-thief-standalone-settings-modal .st-thief-form-grid {
          grid-template-columns: 1fr;
        }
      }
      #st-thief-standalone-settings-modal .st-thief-form-item {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #st-thief-standalone-settings-modal .st-thief-form-item label {
        font-size: 11px;
        color: #9cdcfe;
        font-weight: 500;
        width: 70px;
        flex-shrink: 0;
        text-align: right;
      }
      #st-thief-standalone-settings-modal .st-thief-form-item select,
      #st-thief-standalone-settings-modal .st-thief-form-item input[type="number"] {
        flex: 1;
        background: #181818;
        color: #cccccc;
        border: 1px solid #3c3c3c;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        outline: none;
        transition: border-color 0.15s;
      }
      #st-thief-standalone-settings-modal .st-thief-form-item select:focus,
      #st-thief-standalone-settings-modal .st-thief-form-item input[type="number"]:focus {
        border-color: #007acc;
      }
      #st-thief-standalone-settings-modal .st-thief-checkbox-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 8px 12px;
        padding-top: 6px;
        border-top: 1px solid #2d2d2d;
      }
      #st-thief-standalone-settings-modal .st-thief-checkbox-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #cccccc;
        cursor: pointer;
        user-select: none;
      }
      #st-thief-standalone-settings-modal .st-thief-checkbox-item input[type="checkbox"] {
        cursor: pointer;
        accent-color: #007acc;
        width: 14px;
        height: 14px;
      }
      #st-thief-standalone-settings-modal .st-thief-status-btn {
        padding: 3px 10px;
        font-size: 11px;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }
      #st-thief-standalone-settings-modal .st-thief-settings-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: #181818;
        border-top: 1px solid #2d2d2d;
        user-select: none;
      }
      #st-thief-standalone-settings-modal .tb-btn-primary {
        padding: 5px 18px;
        background: #0e639c;
        color: #ffffff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: background 0.15s;
      }
      #st-thief-standalone-settings-modal .tb-btn-primary:hover {
        background: #1177bb;
      }
      #st-thief-standalone-settings-modal .tb-btn-secondary {
        padding: 5px 14px;
        background: #2a2a2a;
        color: #cccccc;
        border: 1px solid #444;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        transition: background 0.15s;
      }
      #st-thief-standalone-settings-modal .tb-btn-secondary:hover {
        background: #333333;
      }
      #st-thief-standalone-settings-modal .tb-btn-danger {
        padding: 5px 12px;
        background: #2a2a2a;
        color: #999999;
        border: 1px solid #3a3a3a;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.15s;
      }
      #st-thief-standalone-settings-modal .tb-btn-danger:hover {
        background: #333333;
        color: #cccccc;
      }
    `;
    topDoc.head.appendChild(style);
  }

  function openSettingsModal() {
    STATE.isSettingsOpen = true;
    const topDoc = getSafeTopDoc();
    if (!topDoc || !topDoc.body) return;

    ensureStandaloneSettingsStyles(topDoc);

    let modal = topDoc.getElementById('st-thief-standalone-settings-modal');
    if (!modal) {
      modal = topDoc.createElement('div');
      modal.id = 'st-thief-standalone-settings-modal';
      topDoc.body.appendChild(modal);
    }

    const wlList = Array.isArray(CONFIG.tagWhitelist) ? CONFIG.tagWhitelist : DEFAULT_TAG_WHITELIST;
    const blList = Array.isArray(CONFIG.tagBlacklist) ? CONFIG.tagBlacklist : DEFAULT_TAG_BLACKLIST;
    const whitelistVal = escapeHtml(wlList.join(', '));
    const blacklistVal = escapeHtml(blList.join(', '));
    const barWidthVal = CONFIG.barWidth || 840;

    const wlChecked = CONFIG.enableWhitelist ? 'checked' : '';
    const minChecked = CONFIG.minimalMode ? 'checked' : '';
    const privacyChecked = CONFIG.privacyMode ? 'checked' : '';
    const userMsgChecked = CONFIG.showUserMessages ? 'checked' : '';
    const actChecked = CONFIG.filterActions ? 'checked' : '';
    const deskSyncChecked = CONFIG.enableDesktopSync ? 'checked' : '';

    const filterModePure = CONFIG.filterMode === 'pure' ? 'selected' : '';
    const filterModeRegex = CONFIG.filterMode === 'regex' ? 'selected' : '';

    const charModeCompact = CONFIG.charNameMode === 'compact' ? 'selected' : '';
    const charModeHidden = CONFIG.charNameMode === 'hidden' ? 'selected' : '';
    const charModeFull = CONFIG.charNameMode === 'full' ? 'selected' : '';

    const wrapModeWrap = CONFIG.wrapMode === 'wrap' ? 'selected' : '';
    const wrapModeSingle = CONFIG.wrapMode === 'single' ? 'selected' : '';

    let deskStatusText = '未开启';
    let deskBtnStyle = 'background:#252526; color:#888888; border:1px solid #3c3c3c;';
    if (CONFIG.enableDesktopSync) {
      if (STATE.wsAuthenticated) {
        deskStatusText = '● 已连接';
        deskBtnStyle = 'background:#1b3a24; color:#81c784; border:1px solid #2e7d32;';
      } else if (STATE.wsClient) {
        deskStatusText = '○ 待认证 (填密钥)';
        deskBtnStyle = 'background:#3d3322; color:#ffd54f; border:1px solid #8d6e63;';
      } else {
        deskStatusText = '○ 未连接 (重试)';
        deskBtnStyle = 'background:#3d3322; color:#ffd54f; border:1px solid #8d6e63;';
      }
    }

    modal.innerHTML = `
      <div class="st-thief-settings-card" id="st-thief-settings-card">
        <div class="st-thief-settings-header">
          <div class="st-thief-settings-title">ST-Thief-Book 设置与规则过滤</div>
          <span class="st-thief-settings-close" id="btn-standalone-close-settings" title="关闭设置 (Esc)">✕</span>
        </div>
        <div class="st-thief-settings-body">
          <!-- 1. 白名单提取容器 -->
          <div class="st-thief-section">
            <div class="st-thief-section-header">
              <label class="st-thief-checkbox-item" style="font-weight:600; color:#4ec9b0;">
                <input type="checkbox" id="setting-enable-whitelist" ${wlChecked} />
                <span>启用正文白名单提取</span>
              </label>
              <span id="btn-clear-whitelist" class="st-thief-btn-link">清空白名单</span>
            </div>
            <textarea id="setting-whitelist" class="st-thief-textarea" placeholder="输入标签名，以英文逗号分隔">${whitelistVal}</textarea>
            <div class="st-thief-current-chips" id="current-whitelist-chips"></div>
            <div class="st-thief-chips-row">
              <span class="st-thief-chips-label">快选:</span>
              <span class="tb-wl-chip" data-tag="content">+content</span>
              <span class="tb-wl-chip" data-tag="output">+output</span>
              <span class="tb-wl-chip" data-tag="response">+response</span>
              <span class="tb-wl-chip" data-tag="dialogue">+dialogue</span>
              <span class="tb-wl-chip" data-tag="story">+story</span>
              <span class="tb-wl-chip" data-tag="reply">+reply</span>
              <span class="tb-wl-chip" data-tag="text">+text</span>
              <span class="tb-wl-chip" data-tag="正文">+正文</span>
            </div>
            <div class="st-thief-hint">优先提取白名单标签内的正文内容；未匹配任何白名单时安全降级读取全文。</div>
          </div>

          <!-- 2. 黑名单剥离 -->
          <div class="st-thief-section">
            <div class="st-thief-section-header">
              <span class="st-thief-section-title" style="color:#f48771;">思考与元数据黑名单 (彻底清除标签及其内部内容)</span>
              <span id="btn-clear-blacklist" class="st-thief-btn-link">清空黑名单</span>
            </div>
            <textarea id="setting-blacklist" class="st-thief-textarea" placeholder="输入黑名单标签，以英文逗号分隔">${blacklistVal}</textarea>
            <div class="st-thief-current-chips" id="current-blacklist-chips"></div>
            <div class="st-thief-chips-row">
              <span class="st-thief-chips-label">快选:</span>
              <span class="tb-bl-chip" data-tag="think">+think</span>
              <span class="tb-bl-chip" data-tag="thought">+thought</span>
              <span class="tb-bl-chip" data-tag="cot">+cot</span>
              <span class="tb-bl-chip" data-tag="status">+status</span>
              <span class="tb-bl-chip" data-tag="bbi_image">+bbi_image</span>
              <span class="tb-bl-chip" data-tag="fox_hugou">+fox_hugou</span>
              <span class="tb-bl-chip" data-tag="fox_selc">+fox_selc</span>
              <span class="tb-bl-chip" data-tag="fox_tip">+fox_tip</span>
              <span class="tb-bl-chip" data-tag="so_seq">+so_seq</span>
              <span class="tb-bl-chip" data-tag="details">+details</span>
            </div>
            <div class="st-thief-hint">彻底剥离上述标签块及内容；其他普通排版标签仅剥除尖括号保留纯文字。</div>
          </div>

          <!-- 3. 阅读与界面参数 -->
          <div class="st-thief-section">
            <div class="st-thief-form-grid">
              <div class="st-thief-form-item">
                <label for="setting-filtermode">阅读模式</label>
                <select id="setting-filtermode">
                  <option value="pure" ${filterModePure}>纯净小说模式 (过滤多余标签，短小精炼)</option>
                  <option value="regex" ${filterModeRegex}>酒馆正则清洗模式 (执行正则后清洗)</option>
                </select>
              </div>
              <div class="st-thief-form-item">
                <label for="setting-charmode">角色名显示</label>
                <select id="setting-charmode">
                  <option value="compact" ${charModeCompact}>精简胶囊 (限制宽度并省略)</option>
                  <option value="hidden" ${charModeHidden}>完全隐藏 (最大正文空间)</option>
                  <option value="full" ${charModeFull}>完整显示</option>
                </select>
              </div>
              <div class="st-thief-form-item">
                <label for="setting-wrapmode">换行展示</label>
                <select id="setting-wrapmode">
                  <option value="wrap" ${wrapModeWrap}>自动折行全显 (完整展示长句)</option>
                  <option value="single" ${wrapModeSingle}>单行截断</option>
                </select>
              </div>
              <div class="st-thief-form-item">
                <label for="setting-barwidth">摸鱼条长度</label>
                <div style="display:flex; align-items:center; gap:6px; flex:1;">
                  <input type="number" id="setting-barwidth" value="${barWidthVal}" min="360" max="2560" step="20" />
                  <span style="font-size:11px; color:#888;">px</span>
                </div>
              </div>
            </div>

            <!-- 功能开关 -->
            <div class="st-thief-checkbox-grid">
              <label class="st-thief-checkbox-item">
                <input type="checkbox" id="setting-minimal-mode" ${minChecked} />
                <span>极简模式 (纯文字无边框)</span>
              </label>
              <label class="st-thief-checkbox-item">
                <input type="checkbox" id="setting-privacy-mode" ${privacyChecked} />
                <span>隐私模式 (悬停显示/移开隐藏)</span>
              </label>
              <label class="st-thief-checkbox-item">
                <input type="checkbox" id="setting-filter-actions" ${actChecked} />
                <span>过滤动作描写 (*xxx*)</span>
              </label>
              <label class="st-thief-checkbox-item">
                <input type="checkbox" id="setting-show-user-messages" ${userMsgChecked} />
                <span>显示用户消息 (默认仅阅读AI)</span>
              </label>
            </div>
          </div>

          <!-- 4. 桌面端同步 -->
          <div class="st-thief-section">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label class="st-thief-checkbox-item" style="font-weight:500;">
                <input type="checkbox" id="setting-enable-desktopsync" ${deskSyncChecked} />
                <span>启用本地桌面端同步 (thief_desktop_bar.py)</span>
              </label>
              <button type="button" id="btn-reconnect-desktop" class="st-thief-status-btn" style="${deskBtnStyle}">
                ${deskStatusText}
              </button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
              <span style="font-size:12px; color:#cccccc; white-space:nowrap;">桥接密钥</span>
              <input type="text" id="setting-bridge-token" value="${escapeHtml(CONFIG.bridgeToken)}"
                     placeholder="桌面端右键菜单 → 复制桥接密钥，粘贴到此处"
                     style="flex:1; background:#1e1e1e; color:#cccccc; border:1px solid #3c3c3c; border-radius:3px; padding:4px 8px; font-size:12px; font-family:Consolas,monospace;" />
            </div>
            <div class="st-thief-hint">网页端仅负责过滤与桥接，阅读界面为本地桌面摸鱼条 (start_desktop.bat)。首次同步需填入桌面端桥接密钥完成配对。</div>
          </div>
        </div>

        <!-- 5. 底部操作栏 -->
        <div class="st-thief-settings-footer">
          <button id="btn-reset-settings" class="tb-btn-danger">恢复默认预设</button>
          <div style="display:flex; gap:8px;">
            <button id="btn-cancel-settings" class="tb-btn-secondary">取消</button>
            <button id="btn-save-settings" class="tb-btn-primary">保存生效</button>
          </div>
        </div>
      </div>
    `;

    bindStandaloneSettingsEvents(modal, topDoc);
  }

  function bindStandaloneSettingsEvents(modal, topDoc) {
    if (!modal) return;

    modal.addEventListener('click', e => {
      if (e.target === modal) {
        closeSettingsModal();
      }
    });

    const card = modal.querySelector('.st-thief-settings-card');
    card?.addEventListener('click', e => {
      e.stopPropagation();
    });

    const parseTags = val => val.split(/[,，\n]/).map(s => s.trim().replace(/^[<\[]+|[>\]]+$/g, '')).filter(Boolean);

    // 当前标签 chips 与 textarea 同步：点 × 移除，输入/快选/清空/重置后自动刷新
    function syncCurrentChips() {
      [['#setting-whitelist', '#current-whitelist-chips', 'wl'], ['#setting-blacklist', '#current-blacklist-chips', 'bl']].forEach(([areaSel, rowSel, kind]) => {
        const area = modal.querySelector(areaSel);
        const row = modal.querySelector(rowSel);
        if (!area || !row) return;
        const tags = parseTags(area.value);
        row.innerHTML = '<span class="st-thief-chips-label">当前:</span>' + (tags.length
          ? tags.map(t => `<span class="tb-cur-chip tb-cur-${kind}">${escapeHtml(t)}<span class="tb-cur-x" data-tag="${escapeHtml(t)}" title="点击移除 ${escapeHtml(t)}">×</span></span>`).join('')
          : '<span class="st-thief-chips-label">(空)</span>');
      });
    }

    card?.addEventListener('click', e => {
      const x = e.target.closest('.tb-cur-x');
      if (!x) return;
      const row = x.closest('.st-thief-current-chips');
      const area = modal.querySelector(row && row.id === 'current-whitelist-chips' ? '#setting-whitelist' : '#setting-blacklist');
      if (!area) return;
      const tag = x.getAttribute('data-tag');
      area.value = parseTags(area.value).filter(t => t !== tag).join(', ');
      syncCurrentChips();
    });
    card?.addEventListener('input', e => {
      if (e.target.id === 'setting-whitelist' || e.target.id === 'setting-blacklist') syncCurrentChips();
    });

    modal.querySelector('#btn-standalone-close-settings')?.addEventListener('click', closeSettingsModal);
    modal.querySelector('#btn-cancel-settings')?.addEventListener('click', closeSettingsModal);

    modal.querySelector('#btn-clear-whitelist')?.addEventListener('click', () => {
      const area = modal.querySelector('#setting-whitelist');
      if (area) {
        area.value = '';
        area.focus();
        syncCurrentChips();
      }
    });

    modal.querySelector('#btn-clear-blacklist')?.addEventListener('click', () => {
      const area = modal.querySelector('#setting-blacklist');
      if (area) {
        area.value = '';
        area.focus();
        syncCurrentChips();
      }
    });

    modal.querySelectorAll('.tb-wl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tag = chip.getAttribute('data-tag');
        const area = modal.querySelector('#setting-whitelist');
        if (!tag || !area) return;
        const curTags = parseTags(area.value);
        if (!curTags.includes(tag)) {
          curTags.push(tag);
          area.value = curTags.join(', ');
          syncCurrentChips();
        }
      });
    });

    modal.querySelectorAll('.tb-bl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tag = chip.getAttribute('data-tag');
        const area = modal.querySelector('#setting-blacklist');
        if (!tag || !area) return;
        const curTags = parseTags(area.value);
        if (!curTags.includes(tag)) {
          curTags.push(tag);
          area.value = curTags.join(', ');
          syncCurrentChips();
        }
      });
    });

    syncCurrentChips();

    modal.querySelector('#btn-reset-settings')?.addEventListener('click', () => {
      const wlArea = modal.querySelector('#setting-whitelist');
      if (wlArea) wlArea.value = DEFAULT_TAG_WHITELIST.join(', ');
      const blArea = modal.querySelector('#setting-blacklist');
      if (blArea) blArea.value = DEFAULT_TAG_BLACKLIST.join(', ');
      const wlEnable = modal.querySelector('#setting-enable-whitelist');
      if (wlEnable) wlEnable.checked = true;
      const charMode = modal.querySelector('#setting-charmode');
      if (charMode) charMode.value = 'compact';
      const wrapMode = modal.querySelector('#setting-wrapmode');
      if (wrapMode) wrapMode.value = 'wrap';
      const minMode = modal.querySelector('#setting-minimal-mode');
      if (minMode) minMode.checked = false;
      const userMsg = modal.querySelector('#setting-show-user-messages');
      if (userMsg) userMsg.checked = false;
      const actions = modal.querySelector('#setting-filter-actions');
      if (actions) actions.checked = false;
      const privacy = modal.querySelector('#setting-privacy-mode');
      if (privacy) privacy.checked = false;
      const mode = modal.querySelector('#setting-filtermode');
      if (mode) mode.value = 'pure';
      const barW = modal.querySelector('#setting-barwidth');
      if (barW) barW.value = '840';
      const deskSync = modal.querySelector('#setting-enable-desktopsync');
      if (deskSync) deskSync.checked = true;
      const bridgeToken = modal.querySelector('#setting-bridge-token');
      if (bridgeToken) bridgeToken.value = '';
      syncCurrentChips();
    });

    modal.querySelector('#btn-reconnect-desktop')?.addEventListener('click', () => {
      const deskSync = modal.querySelector('#setting-enable-desktopsync');
      if (deskSync) deskSync.checked = true;
      CONFIG.enableDesktopSync = true;
      saveCurrentConfig();
      flashStatusHint('正在连接本地桌面端 127.0.0.1:18899...');
      initDesktopBridge(true);
    });

    modal.querySelector('#btn-save-settings')?.addEventListener('click', () => {
      const wlArea = modal.querySelector('#setting-whitelist');
      const blArea = modal.querySelector('#setting-blacklist');
      const wlEnable = modal.querySelector('#setting-enable-whitelist');
      const charMode = modal.querySelector('#setting-charmode');
      const wrapMode = modal.querySelector('#setting-wrapmode');
      const minMode = modal.querySelector('#setting-minimal-mode');
      const userMsg = modal.querySelector('#setting-show-user-messages');
      const actions = modal.querySelector('#setting-filter-actions');
      const privacy = modal.querySelector('#setting-privacy-mode');
      const mode = modal.querySelector('#setting-filtermode');
      const barW = modal.querySelector('#setting-barwidth');
      const deskSync = modal.querySelector('#setting-enable-desktopsync');

      if (wlEnable) CONFIG.enableWhitelist = wlEnable.checked;
      if (charMode) CONFIG.charNameMode = charMode.value;
      if (wrapMode) CONFIG.wrapMode = wrapMode.value;
      if (minMode) CONFIG.minimalMode = minMode.checked;
      if (privacy) CONFIG.privacyMode = privacy.checked;
      if (userMsg) CONFIG.showUserMessages = userMsg.checked;
      if (barW) {
        const w = parseInt(barW.value, 10);
        if (!isNaN(w) && w >= 360 && w <= 2560) {
          CONFIG.barWidth = w;
        }
      }

      if (wlArea) {
        const list = wlArea.value
          .split(/[,，\n]/)
          .map(s => s.trim().replace(/^[<\[]+|[>\]]+$/g, ''))
          .filter(Boolean);
        CONFIG.tagWhitelist = list.length > 0 ? list : [...DEFAULT_TAG_WHITELIST];
      }

      if (blArea) {
        const list = blArea.value
          .split(/[,，\n]/)
          .map(s => s.trim().replace(/^[<\[]+|[>\]]+$/g, ''))
          .filter(Boolean);
        CONFIG.tagBlacklist = list.length > 0 ? list : [...DEFAULT_TAG_BLACKLIST];
      }

      if (actions) CONFIG.filterActions = actions.checked;
      if (mode) CONFIG.filterMode = mode.value;

      const tokenInput = modal.querySelector('#setting-bridge-token');
      const tokenChanged = tokenInput && tokenInput.value.trim().slice(0, 128) !== CONFIG.bridgeToken;
      if (tokenInput) CONFIG.bridgeToken = tokenInput.value.trim().slice(0, 128);

      if (deskSync) {
        const oldState = CONFIG.enableDesktopSync;
        CONFIG.enableDesktopSync = deskSync.checked;
        if (!oldState && CONFIG.enableDesktopSync) {
          initDesktopBridge(true);
        } else if (oldState && !CONFIG.enableDesktopSync) {
          stopDesktopBridge();
        } else if (CONFIG.enableDesktopSync && tokenChanged) {
          stopDesktopBridge();
          initDesktopBridge(true);
        }
      }

      saveCurrentConfig();
      closeSettingsModal();
      flashStatusHint('设置已保存并生效');
      refreshLatestMessage(false);
      syncToDesktop();
    });
  }

  function closeSettingsModal() {
    STATE.isSettingsOpen = false;
    const topDoc = getSafeTopDoc();
    const modal = topDoc?.getElementById('st-thief-standalone-settings-modal');
    if (modal) {
      modal.remove();
    }
  }

  // ------------------------------------------------------------------------------------
  // 宿主文档安全访问与全局快捷键
  // ------------------------------------------------------------------------------------
  function getSafeTopDoc() {
    try {
      if (window.top && window.top.document && window.top.document.body) {
        return window.top.document;
      }
    } catch (e) {}
    return document;
  }

  function getSafeTopWin() {
    try {
      if (window.top && window.top.location && window.top.location.href) {
        return window.top;
      }
    } catch (e) {}
    return window;
  }

  function setupHostGlobalShortcuts() {
    try {
      const topDoc = getSafeTopDoc();
      // 脚本重载时旧 handler 闭包已随旧 iframe 销毁，必须先卸载再绑新实例
      if (topDoc._tbHostKeydownHandler) {
        topDoc.removeEventListener('keydown', topDoc._tbHostKeydownHandler);
      }

      const handler = e => {
        if (e.key === 'Escape' && STATE.isSettingsOpen) {
          const activeEl = topDoc.activeElement;
          const isInputActive = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
          if (isInputActive) return;
          e.preventDefault();
          closeSettingsModal();
        }
      };
      topDoc._tbHostKeydownHandler = handler;
      topDoc.addEventListener('keydown', handler);

      // 当用户从桌面切回酒馆窗口且开启了桌面同步时，顺手轻量探测连接一次
      window.addEventListener('focus', () => {
        if (CONFIG.enableDesktopSync && !STATE.wsClient && !STATE.wsConnecting) {
          initDesktopBridge(false);
        }
      });
    } catch (e) {
      console.warn('[ST-Thief-Book] 注入宿主按键监听受限:', e);
    }
  }

  // ------------------------------------------------------------------------------------
  // 魔法棒（扩展）菜单入口：摸鱼条设置
  // ------------------------------------------------------------------------------------
  let wandObserver = null;
  let wandRetryTimer = null;

  function injectWandMenu() {
    const topDoc = getSafeTopDoc();
    const menu = topDoc && topDoc.getElementById('extensionsMenu');
    if (!menu || topDoc.getElementById('st_thief_wand_container')) return;

    const container = topDoc.createElement('div');
    container.id = 'st_thief_wand_container';
    container.className = 'extension_container';
    container.innerHTML = `
      <div id="st_thief_wand_settings" class="list-group-item flex-container flexGap5" title="打开摸鱼条设置与桥接密钥配对">
        <div class="fa-solid fa-fish extensionsMenuExtensionButton"></div>摸鱼条
      </div>`;
    menu.appendChild(container);
    container.querySelector('#st_thief_wand_settings').addEventListener('click', () => openSettingsModal());
  }

  function ensureWandMenu() {
    const topDoc = getSafeTopDoc();
    if (!topDoc || !topDoc.body) {
      wandRetryTimer = setTimeout(ensureWandMenu, 1000);
      return;
    }
    injectWandMenu();
    if (wandObserver) return;
    // 魔法棒菜单由酒馆启动时动态 append 到 body；整体重建时自动补回我们的条目
    wandObserver = new MutationObserver(() => injectWandMenu());
    wandObserver.observe(topDoc.body, { childList: true });
  }

  // ------------------------------------------------------------------------------------
  // 本地桌面端 WebSocket 同步机制
  // ------------------------------------------------------------------------------------
  function stopDesktopBridge() {
    if (STATE.wsReconnectTimer) {
      clearTimeout(STATE.wsReconnectTimer);
      STATE.wsReconnectTimer = null;
    }
    if (STATE.wsClient) {
      try {
        STATE.wsClient.onopen = null;
        STATE.wsClient.onmessage = null;
        STATE.wsClient.onclose = null;
        STATE.wsClient.onerror = null;
        STATE.wsClient.close();
      } catch (e) {}
      STATE.wsClient = null;
    }
    STATE.wsConnecting = false;
    STATE.wsAuthenticated = false;
  }

  function toggleDesktopSync(forcedState) {
    const target = typeof forcedState === 'boolean' ? forcedState : !CONFIG.enableDesktopSync;
    CONFIG.enableDesktopSync = target;
    saveCurrentConfig();

    if (CONFIG.enableDesktopSync) {
      flashStatusHint('🖥️ 已开启桌面同步，正在连接 127.0.0.1:18899...');
      initDesktopBridge(true);
    } else {
      stopDesktopBridge();
      flashStatusHint('⚪ 已关闭桌面同步 (桌面摸鱼条将停止接收消息)');
    }
  }

  function initDesktopBridge(isManual = false) {
    // 关键守卫：用户显式关闭桌面同步后，绝不发起任何 WebSocket 连接与重连
    if (!CONFIG.enableDesktopSync) {
      stopDesktopBridge();
      return;
    }

    if (STATE.wsClient && (STATE.wsClient.readyState === WebSocket.OPEN || STATE.wsClient.readyState === WebSocket.CONNECTING)) {
      if (isManual) flashStatusHint('🟢 桌面端已在连接中');
      return;
    }

    if (STATE.wsReconnectTimer) {
      clearTimeout(STATE.wsReconnectTimer);
      STATE.wsReconnectTimer = null;
    }

    STATE.wsConnecting = true;

    try {
      const wsUrl = `ws://127.0.0.1:${CONFIG.wsPort}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        STATE.wsConnecting = false;
        STATE.wsClient = ws;
        STATE.wsAuthenticated = false;
        console.log('[ST-Thief-Book] 已连接桌面端，发送 hello 认证...');
        try {
          ws.send(JSON.stringify({ action: 'hello', token: CONFIG.bridgeToken }));
        } catch (e) {}
      };

      ws.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          if (data.action === 'hello_ok') {
            STATE.wsAuthenticated = true;
            console.log('[ST-Thief-Book] 桌面端桥接认证成功');
            flashStatusHint('🟢 桌面端认证成功，同步已开启');
            syncToDesktop();
            return;
          }
          if (data.action === 'hello_fail') {
            STATE.wsAuthenticated = false;
            flashStatusHint('⚠️ 桥接密钥错误：桌面端右键 → 复制桥接密钥，填入脚本设置');
            return;
          }
          if (!STATE.wsAuthenticated) return;
          if (data.action === 'next') nextSentence();
          else if (data.action === 'prev') prevSentence();
          else if (data.action === 'boss') toggleBossKey();
          else if (data.action === 'swipe') swipeMessage();
          else if (data.action === 'stop') stopGeneration();
          else if (data.action === 'reply') submitReply(data.text);
          else if (data.action === 'open_settings') openSettingsModal();
          else if (data.action === 'jump_floor') jumpToMessageFloor(data.floor);
          else if (data.action === 'resume') jumpToMessageFloor(data.floor, data.curIdx);
          else if (data.action === 'change_floor') changeMessageFloor(data.delta || 1);
          else if (data.action === 'toggle_user_messages') toggleShowUserMessages();
          else if (data.action === 'toggle_char_mode') toggleCharNameMode();
          else if (data.action === 'toggle_wrap_mode') toggleWrapMode();
          else if (data.action === 'toggle_minimal_mode') toggleMinimalMode(data.minimalMode);
          else if (data.action === 'toggle_layout_mode') toggleLayoutMode();
          else if (data.action === 'set_window_width' && typeof data.barWidth === 'number') {
            CONFIG.barWidth = data.barWidth;
            saveCurrentConfig();
          }
          else if (data.action === 'update_config' && data.config) {
            if (typeof data.config.showUserMessages === 'boolean') CONFIG.showUserMessages = data.config.showUserMessages;
            if (typeof data.config.enableWhitelist === 'boolean') CONFIG.enableWhitelist = data.config.enableWhitelist;
            const wl = sanitizeTagList(data.config.tagWhitelist);
            if (wl) CONFIG.tagWhitelist = wl;
            const bl = sanitizeTagList(data.config.tagBlacklist);
            if (bl) CONFIG.tagBlacklist = bl;
            if (typeof data.config.filterActions === 'boolean') CONFIG.filterActions = data.config.filterActions;
            if (CONFIG_ENUMS.filterMode.includes(data.config.filterMode)) CONFIG.filterMode = data.config.filterMode;
            if (CONFIG_ENUMS.charNameMode.includes(data.config.charNameMode)) CONFIG.charNameMode = data.config.charNameMode;
            if (CONFIG_ENUMS.wrapMode.includes(data.config.wrapMode)) CONFIG.wrapMode = data.config.wrapMode;
            if (typeof data.config.minimalMode === 'boolean') CONFIG.minimalMode = data.config.minimalMode;
            if (typeof data.config.privacyMode === 'boolean') CONFIG.privacyMode = data.config.privacyMode;
            if (CONFIG_ENUMS.layoutMode.includes(data.config.layoutMode)) CONFIG.layoutMode = data.config.layoutMode;
            if (typeof data.config.opacity === 'number') CONFIG.opacity = Math.max(0.15, Math.min(1, data.config.opacity));
            if (typeof data.config.barWidth === 'number') CONFIG.barWidth = Math.max(360, Math.min(2560, data.config.barWidth));
            saveCurrentConfig();
            refreshLatestMessage(false);
          }
        } catch (err) {
          console.warn('[ST-Thief-Book] 处理桌面端消息错误:', err);
        }
      };

      ws.onclose = () => {
        STATE.wsClient = null;
        STATE.wsConnecting = false;
        STATE.wsAuthenticated = false;

        // 只有当用户依然开启了桌面同步时，才温和安排重连，若未开启则完全静默
        if (CONFIG.enableDesktopSync) {
          if (STATE.wsReconnectTimer) clearTimeout(STATE.wsReconnectTimer);
          STATE.wsReconnectTimer = setTimeout(() => {
            if (CONFIG.enableDesktopSync) {
              initDesktopBridge(false);
            }
          }, 10000);
        }
      };

      ws.onerror = () => {
        STATE.wsClient = null;
        STATE.wsConnecting = false;
        STATE.wsAuthenticated = false;
        if (isManual) {
          flashStatusHint('⚠️ 桌面端未开启，请先运行 start_desktop.bat');
        }
      };
    } catch (e) {
      STATE.wsClient = null;
      STATE.wsConnecting = false;
      STATE.wsAuthenticated = false;
    }
  }

  function syncToDesktop() {
    if (!CONFIG.enableDesktopSync || !STATE.wsAuthenticated || !STATE.wsClient || STATE.wsClient.readyState !== WebSocket.OPEN) return;

    try {
      const payload = {
        type: 'sync',
        charName: STATE.characterName,
        userName: STATE.userName,
        floor: STATE.currentMsgId,
        curIdx: STATE.currentSentenceIndex + 1,
        totalSentences: STATE.sentences.length,
        currentSentence: STATE.sentences[STATE.currentSentenceIndex] || '',
        // 整条消息连成一段：桌面端据此整段分屏（不再按标点一句一翻）
        fullText: STATE.sentences.join(''),
        // 当前句在整段里的字符偏移，供桌面端"跳句"定位
        sentenceOffset: STATE.sentences.slice(0, STATE.currentSentenceIndex).join('').length,
        isBossKey: STATE.isBossKey,
        isGenerating: STATE.isGenerating,
        barWidth: CONFIG.barWidth,
        config: {
          showUserMessages: CONFIG.showUserMessages,
          enableWhitelist: CONFIG.enableWhitelist,
          tagWhitelist: CONFIG.tagWhitelist,
          tagBlacklist: CONFIG.tagBlacklist,
          filterActions: CONFIG.filterActions,
          filterMode: CONFIG.filterMode,
          charNameMode: CONFIG.charNameMode,
          wrapMode: CONFIG.wrapMode,
          minimalMode: CONFIG.minimalMode,
          privacyMode: CONFIG.privacyMode,
          layoutMode: CONFIG.layoutMode,
          opacity: CONFIG.opacity,
          barWidth: CONFIG.barWidth
        }
      };
      STATE.wsClient.send(JSON.stringify(payload));
    } catch (e) {}
  }

  // ------------------------------------------------------------------------------------
  // 酒馆事件监听绑定
  // ------------------------------------------------------------------------------------
  function initTavernEvents() {
    // 入口已迁移到魔法棒（扩展）菜单；清空脚本按钮栏（含旧版本残留）
    if (typeof replaceScriptButtons === 'function') {
      try { replaceScriptButtons([]); } catch (e) {}
    }

    if (typeof tavern_events !== 'undefined' && typeof eventOn === 'function') {
      eventOn(tavern_events.MESSAGE_RECEIVED, () => {
        STATE.isGenerating = false;
        refreshLatestMessage(false);
      });

      eventOn(tavern_events.MESSAGE_UPDATED, () => {
        refreshLatestMessage(false);
      });

      eventOn(tavern_events.CHAT_CHANGED, () => {
        STATE.currentSentenceIndex = 0;
        refreshLatestMessage(false);
      });

      eventOn(tavern_events.GENERATION_STARTED, () => {
        STATE.isGenerating = true;
        syncToDesktop();
      });

      eventOn(tavern_events.GENERATION_ENDED, () => {
        STATE.isGenerating = false;
        refreshLatestMessage(false);
      });

      if (tavern_events.CHARACTER_MESSAGE_RENDERED) {
        eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, () => {
          STATE.isGenerating = false;
          refreshLatestMessage(false);
        });
      }

      if (tavern_events.USER_MESSAGE_RENDERED) {
        eventOn(tavern_events.USER_MESSAGE_RENDERED, () => {
          refreshLatestMessage(false);
        });
      }

      if (tavern_events.MESSAGE_SWIPED) {
        eventOn(tavern_events.MESSAGE_SWIPED, () => {
          refreshLatestMessage(false);
        });
      }

      if (tavern_events.STREAM_TOKEN_RECEIVED) {
        //  trailing-edge 节流：token 高频到达时最多每 150ms 全量刷新一次，GENERATION_ENDED 会兜底最终态
        eventOn(tavern_events.STREAM_TOKEN_RECEIVED, () => {
          if (STATE.streamRenderTimer) return;
          STATE.streamRenderTimer = setTimeout(() => {
            STATE.streamRenderTimer = null;
            try {
              const lastId = typeof getLastMessageId === 'function' ? getLastMessageId() : -1;
              if (lastId >= 0) {
                const msgs = getChatMessages(lastId);
                if (msgs && msgs[0]) {
                  STATE.currentMsgId = lastId;
                  const raw = msgs[0].message || '';
                  const clean = filterThinkingAndTags(raw, lastId);
                  if (!clean) {
                    STATE.sentences = ['(AI 正在思考中，思考完成后将自动切入小说正文...)'];
                    STATE.currentSentenceIndex = 0;
                  } else {
                    STATE.sentences = splitIntoSentences(clean);
                  }
                  syncToDesktop();
                }
              }
            } catch (e) {}
          }, 150);
        });
      }
    }
  }

  // ------------------------------------------------------------------------------------
  // 入口初始化
  // ------------------------------------------------------------------------------------
  function init() {
    console.log('[ST-Thief-Book] 插件正在初始化...');
    loadSavedConfig();
    initTavernEvents();
    setupHostGlobalShortcuts();
    ensureWandMenu();
    initDesktopBridge();
    refreshLatestMessage(false);
    console.log('[ST-Thief-Book] 初始化完成！入口在魔法棒（扩展）菜单，阅读请使用桌面摸鱼条 (start_desktop.bat)。');
  }

  // 脚本被禁用/重载时（Tavern Helper 销毁本 iframe）清理宿主侧残留，避免泄漏的监听器
  window.addEventListener('unload', () => {
    stopDesktopBridge();
    if (wandRetryTimer) clearTimeout(wandRetryTimer);
    if (wandObserver) {
      wandObserver.disconnect();
      wandObserver = null;
    }
    try {
      const topDoc = getSafeTopDoc();
      if (topDoc) {
        topDoc.getElementById('st_thief_wand_container')?.remove();
        if (topDoc._tbHostKeydownHandler) {
          topDoc.removeEventListener('keydown', topDoc._tbHostKeydownHandler);
          topDoc._tbHostKeydownHandler = null;
        }
      }
    } catch (e) {}
  });

  setTimeout(init, 500);

  window.STThiefBook = {
    boss: toggleBossKey,
    next: nextSentence,
    prev: prevSentence,
    reply: submitReply,
    swipe: swipeMessage,
    stop: stopGeneration,
    toggleLayout: toggleLayoutMode,
    toggleFilter: toggleFilterMode,
    jumpFloor: jumpToMessageFloor,
    toggleUserMessages: toggleShowUserMessages,
    toggleCharMode: toggleCharNameMode,
    toggleWrap: toggleWrapMode,
    toggleMinimal: toggleMinimalMode,
    togglePrivacy: togglePrivacyMode,
    openSettings: openSettingsModal,
    toggleDesktopSync: toggleDesktopSync,
    connectDesktop: () => toggleDesktopSync(true),
    disconnectDesktop: () => toggleDesktopSync(false),
    addWhitelistTag: tag => {
      if (tag && !CONFIG.tagWhitelist.includes(tag)) {
        CONFIG.tagWhitelist.push(tag);
        saveCurrentConfig();
        refreshLatestMessage(false);
      }
    },
    addBlacklistTag: tag => {
      if (tag && !CONFIG.tagBlacklist.includes(tag)) {
        CONFIG.tagBlacklist.push(tag);
        saveCurrentConfig();
        refreshLatestMessage(false);
      }
    }
  };
})();
