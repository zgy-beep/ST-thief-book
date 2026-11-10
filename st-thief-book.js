/**
 * ======================================================================================
 * ST-Thief-Book: 酒馆助手（Tavern Helper）隐蔽摸鱼阅读与回复工具 (v2.3 自定义黑名单设置版)
 * 仿 VS Code 知名摸鱼插件 Thief-Book 设计
 *
 * 核心升级：
 * 1. 新增【⚙️ 设置面板 & 自定义标签黑名单】：
 *    - 随时点击状态栏右侧“⚙️设置”呼出配置窗口
 *    - 可自定义填入任意思考/状态标签（如 think, cot, status, analysis, plan 等）
 *    - 自动剥离黑名单内所有闭合标签、未闭合流式标签与中括号标签
 *    - 支持一键开启“自动剥除所有未知自定义 XML 标签”
 *    - 支持设置数据本地自动持久化（localStorage + 脚本变量）
 * 2. 默认启用【🧹 纯净小说模式】：直取原始对白描写，不跑 HTML 美化正则，对白短小精炼
 * 3. 独立常驻浮动入口：酒馆主页右下角“🐟 摸鱼条”悬浮胶囊随时开启（支持拖拽）
 * 4. 边看边回双行布局：上行正文看小说（点击文字直接翻句），下行单行回复回车发送
 * 5. 一键老板键：按 Esc 秒切纯代码编译状态
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
    // 是否启用本地 Python 桌面端 (WebSocket) 同步 (默认 false：纯网页模式，不默认主动开启，杜绝连接报错)
    enableDesktopSync: false,
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
    // 默认样式主题: 'vscode-dark' | 'vscode-blue' | 'terminal'
    theme: 'vscode-dark',
    // 角色名展示模式: 'compact' (精简68px胶囊，不占位) | 'hidden' (隐藏角色名留出最大空间) | 'full' (完整展示)
    charNameMode: 'compact',
    // 换行模式: 'wrap' (默认：长句自动折行显示全部文字，绝不截断) | 'single' (强制单行)
    wrapMode: 'wrap',
    // 极简模式: true (纯文字+背景无边框，极度隐蔽) | false (标准 VS Code 状态栏)
    minimalMode: false,
    // 隐私模式: true (鼠标悬浮在窗口上方时才显示，移开时窗口隐藏) | false (常驻显示)
    privacyMode: false,
    // 尺寸配置
    doubleHeight: 74,
    singleHeight: 40,
    barWidth: 840,
    // 透明度 (0.2 ~ 1.0)
    opacity: 0.95,
    // 防窥毛玻璃模式
    hoverBlur: false,
    // 是否过滤动作描写括号 *xxx*
    filterActions: false,
    // 单句最小与最大长度
    minSentenceLen: 6,
    maxSentenceLen: 42,
    // WebSocket 桌面同步端口
    wsPort: 18899,
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
    cachedMessage: null,
    characterName: 'AI',
    userName: 'User',
    isGenerating: false,
    isBossKey: false,
    isSettingsOpen: false,
    isFloorPickerOpen: false,
    isContextMenuOpen: false,
    contextMenuPos: { x: 0, y: 0 },
    thiefWindow: null,
    wsClient: null,
    wsReconnectTimer: null,
    wsConnecting: false,
    isHostInpage: false,
    inpageContainer: null
  };

  // 检查是否处于手机/移动端窄屏环境
  function isMobileDevice() {
    try {
      if (typeof navigator !== 'undefined') {
        const ua = navigator.userAgent || '';
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
          return true;
        }
      }
      if (typeof window !== 'undefined') {
        const topWin = window.top || window;
        if (topWin.matchMedia && topWin.matchMedia('(max-width: 768px)').matches) {
          return true;
        }
        if (topWin.innerWidth <= 768) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

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
          const cleanedBlacklist = saved.tagBlacklist
            .map(t => String(t).trim().replace(/^[<\[]+|[>\]]+$/g, ''))
            .filter(Boolean);
          const merged = Array.from(new Set([...DEFAULT_TAG_BLACKLIST, ...cleanedBlacklist]));
          CONFIG.tagBlacklist = merged;
        }
        if (Array.isArray(saved.tagWhitelist)) {
          CONFIG.tagWhitelist = saved.tagWhitelist;
        }
        if (typeof saved.enableWhitelist === 'boolean') {
          CONFIG.enableWhitelist = saved.enableWhitelist;
        }
        if (typeof saved.filterActions === 'boolean') {
          CONFIG.filterActions = saved.filterActions;
        }
        if (typeof saved.hoverBlur === 'boolean') {
          CONFIG.hoverBlur = saved.hoverBlur;
        }
        if (saved.filterMode) {
          CONFIG.filterMode = saved.filterMode;
        }
        if (saved.theme) {
          CONFIG.theme = saved.theme;
        }
        if (typeof saved.opacity === 'number') {
          CONFIG.opacity = saved.opacity;
        }
        if (saved.layoutMode) {
          CONFIG.layoutMode = saved.layoutMode;
        }
        if (saved.charNameMode) {
          CONFIG.charNameMode = saved.charNameMode;
        }
        if (saved.wrapMode) {
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
        showUserMessages: CONFIG.showUserMessages,
        enableWhitelist: CONFIG.enableWhitelist,
        tagWhitelist: CONFIG.tagWhitelist,
        tagBlacklist: CONFIG.tagBlacklist,
        filterActions: CONFIG.filterActions,
        hoverBlur: CONFIG.hoverBlur,
        filterMode: CONFIG.filterMode,
        theme: CONFIG.theme,
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
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // 2. 利用 DOMParser 剔除明确的 UI 干扰元素
    if (text.includes('<') || text.includes('&')) {
      try {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        doc.querySelectorAll('style, script, svg, img, video, audio, noscript, iframe, link, meta').forEach(el => el.remove());
        doc.querySelectorAll('.mes_reasoning, .reasoning_block, .thinking, .thinking-block, details, think, thought, reasoning, status').forEach(el => el.remove());
        doc.querySelectorAll('.avatar, .avatar-container, .mes_button_menu, .badge, .extra-badges').forEach(el => el.remove());

        if (Array.isArray(CONFIG.tagBlacklist) && CONFIG.tagBlacklist.length > 0) {
          const validSelectors = CONFIG.tagBlacklist
            .map(t => String(t).trim().replace(/^[<\[]+|[>\]]+$/g, ''))
            .filter(t => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(t))
            .join(',');
          if (validSelectors) {
            try { doc.querySelectorAll(validSelectors).forEach(el => el.remove()); } catch (e) {}
          }
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

  function processWhitelistAndBlacklist(content, forceDisableWhitelist = false) {
    if (!content || typeof content !== 'string') return '';
    // 关键：预先解码 HTML 实体，避免 &lt;tag&gt; 绕过黑名单！
    let text = preDecodeEntities(content);

    // 1. 预先清除样式、脚本与 HTML 注释
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // 2. 白名单容器正文提取 (Whitelist Extraction)
    // 若开启白名单模式，且在消息中找到了匹配的白名单标签，则优先提取其内部正文
    if (!forceDisableWhitelist && CONFIG.enableWhitelist && Array.isArray(CONFIG.tagWhitelist) && CONFIG.tagWhitelist.length > 0) {
      const extracted = [];
      for (const rawTag of CONFIG.tagWhitelist) {
        const t = String(rawTag).trim().replace(/^[<\[]+|[>\]]+$/g, '');
        if (!t) continue;
        const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // 匹配闭合 XML 标签: <wtag>...</wtag>
        const xmlRegex = new RegExp('<\\s*' + escaped + '(?:[\\s:][^>]*)?>([\\s\\S]*?)<\\/\\s*' + escaped + '\\s*>', 'gi');
        let m;
        while ((m = xmlRegex.exec(text)) !== null) {
          if (m[1] && m[1].trim()) extracted.push(m[1].trim());
        }

        // 匹配中括号标签: [wtag]...[/wtag]
        const bracketRegex = new RegExp('\\[\\s*' + escaped + '(?:[\\s:][^\\]]*)?\\]([\\s\\S]*?)\\[\\/\\s*' + escaped + '\\s*\\]', 'gi');
        while ((m = bracketRegex.exec(text)) !== null) {
          if (m[1] && m[1].trim()) extracted.push(m[1].trim());
        }
      }

      // 如果成功提取到了白名单标签内的正文，以白名单提取内容为基准！
      // 若未匹配到任何白名单标签，则自动回退为全文，绝不丢弃正文！
      if (extracted.length > 0) {
        text = extracted.join('\n');
      }
    }

    // 3. 在白名单内容（或全文）中，彻底剥离黑名单及其内部思考过程 (Blacklist Stripping)
    const btags = CONFIG.tagBlacklist || [];
    for (const rawTag of btags) {
      const t = String(rawTag).trim().replace(/^[<\[]+|[>\]]+$/g, '');
      if (!t) continue;
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // 闭合 XML 标签: <tag ...>...</tag> (连同内部思考细节整体彻底删除)
      text = text.replace(new RegExp('<\\s*' + escaped + '(?:[\\s:][^>]*)?>[\\s\\S]*?<\\/\\s*' + escaped + '\\s*>', 'gi'), '');

      // 闭合中括号标签: [tag ...]...[/tag]
      text = text.replace(new RegExp('\\[\\s*' + escaped + '(?:[\\s:][^\\]]*)?\\][\\s\\S]*?\\[\\/\\s*' + escaped + '\\s*\\]', 'gi'), '');

      // 冒号或指令型单标签 (常见于用户输入 [system: ...] 或 [system：...] 或 <system: ...> 或 (system: ...) 或 {system: ...})
      text = text.replace(new RegExp('\\[\\s*' + escaped + '\\s*[:：][^\\]]*\\]', 'gi'), '');
      text = text.replace(new RegExp('<\\s*' + escaped + '\\s*[:：][^>]*>', 'gi'), '');
      text = text.replace(new RegExp('\\(\\s*' + escaped + '\\s*[:：][^\\)]*\\)', 'gi'), '');
      text = text.replace(new RegExp('\\{\\s*' + escaped + '\\s*[:：][^\\}]*\\}', 'gi'), '');

      // 流式未闭合标签: <tag ...>...$ 或 [tag ...]...$
      text = text.replace(new RegExp('<\\s*' + escaped + '(?:[\\s:][^>]*)?>[\\s\\S]*$', 'gi'), '');
      text = text.replace(new RegExp('\\[\\s*' + escaped + '(?:[\\s:][^\\]]*)?\\][\\s\\S]*$', 'gi'), '');

      // 游离闭合或单标签
      text = text.replace(new RegExp('<\\/?\\s*' + escaped + '(?:[\\s:][^>]*)?>', 'gi'), '');
      text = text.replace(new RegExp('\\[\\/?\\s*' + escaped + '(?:[\\s:][^\\]]*)?\\]', 'gi'), '');
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
            if (Array.isArray(CONFIG.tagBlacklist) && CONFIG.tagBlacklist.length > 0) {
              const validSelectors = CONFIG.tagBlacklist
                .map(t => String(t).trim().replace(/^[<\[]+|[>\]]+$/g, ''))
                .filter(t => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(t))
                .join(',');
              if (validSelectors) {
                try { $clone.find(validSelectors).remove(); } catch (e) {}
              }
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
      STATE.cachedMessage = latest;
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

      renderThiefBar();
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
      STATE.cachedMessage = msg;
      STATE.currentMsgId = targetId;
      STATE.characterName = msg.name || (typeof SillyTavern !== 'undefined' ? SillyTavern.name2 : 'AI');

      let rawText = msg.message || '';
      if (msg.swipes && msg.swipes.length > 0 && typeof msg.swipe_id === 'number') {
        rawText = msg.swipes[msg.swipe_id] || rawText;
      }

      const cleanText = filterThinkingAndTags(rawText, targetId);
      STATE.sentences = splitIntoSentences(cleanText);
      STATE.currentSentenceIndex = delta < 0 ? Math.max(0, STATE.sentences.length - 1) : 0;

      renderThiefBar();
      syncToDesktop();
    } catch (e) {
      console.error('[ST-Thief-Book] 切换楼层失败:', e);
    }
  }

  function jumpToMessageFloor(targetFloor) {
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
      STATE.cachedMessage = msg;
      STATE.currentMsgId = targetId;
      STATE.characterName = msg.name || (typeof SillyTavern !== 'undefined' ? SillyTavern.name2 : 'AI');

      let rawText = msg.message || '';
      if (msg.swipes && msg.swipes.length > 0 && typeof msg.swipe_id === 'number') {
        rawText = msg.swipes[msg.swipe_id] || rawText;
      }

      const cleanText = filterThinkingAndTags(rawText, targetId);
      STATE.sentences = splitIntoSentences(cleanText);
      STATE.currentSentenceIndex = 0;
      STATE.isFloorPickerOpen = false;

      renderThiefBar();
      syncToDesktop();
      flashStatusHint(`已跳转至第 #${targetId} 楼`);
    } catch (e) {
      console.error('[ST-Thief-Book] 跳转楼层失败:', e);
    }
  }

  function toggleFloorPicker(forcedState) {
    STATE.isFloorPickerOpen = typeof forcedState === 'boolean' ? forcedState : !STATE.isFloorPickerOpen;
    if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      const baseH = CONFIG.minimalMode
        ? (CONFIG.layoutMode === 'double' ? 56 : 30)
        : (CONFIG.layoutMode === 'double' ? CONFIG.doubleHeight : CONFIG.singleHeight);
      const targetHeight = (STATE.isFloorPickerOpen ? 100 : baseH) + 35;
      try {
        STATE.thiefWindow.resizeTo(CONFIG.barWidth, targetHeight);
      } catch (e) {}
    }
    renderThiefBar();
  }

  function toggleCharNameMode() {
    STATE.isContextMenuOpen = false;
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
    renderThiefBar();
    syncToDesktop();
  }

  function toggleWrapMode() {
    STATE.isContextMenuOpen = false;
    CONFIG.wrapMode = CONFIG.wrapMode === 'wrap' ? 'single' : 'wrap';
    saveCurrentConfig();
    flashStatusHint(`换行模式: ${CONFIG.wrapMode === 'wrap' ? '↩️ 自动折行全显' : '↔️ 单行切片'}`);
    renderThiefBar();
    syncToDesktop();
  }

  function cycleBarWidth() {
    STATE.isContextMenuOpen = false;
    const presets = [680, 840, 1080, 1360];
    let nextW = 840;
    let found = false;
    for (let i = 0; i < presets.length; i++) {
      if (Math.abs(CONFIG.barWidth - presets[i]) <= 20) {
        nextW = presets[(i + 1) % presets.length];
        found = true;
        break;
      }
    }
    if (!found) nextW = 840;
    CONFIG.barWidth = nextW;
    saveCurrentConfig();
    if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      try {
        STATE.thiefWindow.resizeTo(CONFIG.barWidth, STATE.thiefWindow.outerHeight || 74);
      } catch (e) {}
    }
    flashStatusHint(`窗口长度已调整为: ${CONFIG.barWidth}px`);
    renderThiefBar();
    syncToDesktop();
  }

  function toggleMinimalMode(forcedState) {
    STATE.isContextMenuOpen = false;
    CONFIG.minimalMode = typeof forcedState === 'boolean' ? forcedState : !CONFIG.minimalMode;
    saveCurrentConfig();
    flashStatusHint(`极简模式: ${CONFIG.minimalMode ? '✨ 已开启 (纯文字+背景)' : '📋 已关闭 (标准状态栏)'}`);
    if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      const baseH = CONFIG.minimalMode
        ? (CONFIG.layoutMode === 'double' ? 56 : 30)
        : (CONFIG.layoutMode === 'double' ? CONFIG.doubleHeight : CONFIG.singleHeight);
      try {
        STATE.thiefWindow.resizeTo(CONFIG.barWidth, baseH + 35);
      } catch (e) {}
    }
    renderThiefBar();
    syncToDesktop();
  }

  function togglePrivacyMode(forcedState) {
    STATE.isContextMenuOpen = false;
    CONFIG.privacyMode = typeof forcedState === 'boolean' ? forcedState : !CONFIG.privacyMode;
    saveCurrentConfig();
    flashStatusHint(`隐私模式: ${CONFIG.privacyMode ? '👻 已开启 (移开隐藏 / 悬浮显示)' : '👁️ 已关闭 (常驻显示)'}`);
    renderThiefBar();
    syncToDesktop();
  }

  function toggleShowUserMessages() {
    STATE.isContextMenuOpen = false;
    CONFIG.showUserMessages = !CONFIG.showUserMessages;
    saveCurrentConfig();
    flashStatusHint(CONFIG.showUserMessages ? '已开启显示用户消息' : '已隐藏用户消息 (仅阅读AI与小说)');
    refreshLatestMessage(false);
    syncToDesktop();
  }

  function openContextMenu(x, y) {
    STATE.isContextMenuOpen = true;
    STATE.contextMenuPos = { x, y };
    renderThiefBar();
  }

  function closeContextMenu() {
    if (STATE.isContextMenuOpen) {
      STATE.isContextMenuOpen = false;
      renderThiefBar();
    }
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
      renderThiefBar();
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
      renderThiefBar();
      syncToDesktop();
    } else if (STATE.currentMsgId > 0) {
      changeMessageFloor(-1);
    }
  }

  function flashStatusHint(text) {
    if (!STATE.thiefWindow || !STATE.thiefWindow.document) return;
    const textEl = STATE.thiefWindow.document.getElementById('tb-text');
    if (!textEl) return;

    const original = textEl.textContent;
    textEl.style.color = '#e5c07b';
    textEl.textContent = `💡 ${text}`;
    setTimeout(() => {
      textEl.style.color = '';
      textEl.textContent = original;
    }, 2000);
  }

  // ------------------------------------------------------------------------------------
  // 回复发送与 AI 生成控制
  // ------------------------------------------------------------------------------------
  async function submitReply(userInput) {
    const text = (userInput || '').trim();
    if (!text) return;

    STATE.isGenerating = true;
    renderThiefBar();

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
      renderThiefBar();
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
      renderThiefBar();
    } catch (e) {
      console.warn('[ST-Thief-Book] 中止生成失败:', e);
    }
  }

  // ------------------------------------------------------------------------------------
  // 老板键、布局、过滤模式与设置面板
  // ------------------------------------------------------------------------------------
  function toggleBossKey(forcedState) {
    STATE.isBossKey = typeof forcedState === 'boolean' ? forcedState : !STATE.isBossKey;
    renderThiefBar();
    syncToDesktop();
  }

  function toggleLayoutMode() {
    STATE.isContextMenuOpen = false;
    CONFIG.layoutMode = CONFIG.layoutMode === 'double' ? 'single' : 'double';
    saveCurrentConfig();
    if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      const baseH = CONFIG.minimalMode
        ? (CONFIG.layoutMode === 'double' ? 56 : 30)
        : (CONFIG.layoutMode === 'double' ? CONFIG.doubleHeight : CONFIG.singleHeight);
      try {
        STATE.thiefWindow.resizeTo(CONFIG.barWidth, baseH + 35);
      } catch (e) {}
    }
    renderThiefBar();
    syncToDesktop();
  }

  function toggleFilterMode() {
    STATE.isContextMenuOpen = false;
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
    const blurChecked = CONFIG.hoverBlur ? 'checked' : '';
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
      if (STATE.wsClient) {
        deskStatusText = '● 已连接';
        deskBtnStyle = 'background:#1b3a24; color:#81c784; border:1px solid #2e7d32;';
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
              <label class="st-thief-checkbox-item">
                <input type="checkbox" id="setting-hover-blur" ${blurChecked} />
                <span>防窥毛玻璃 (鼠标移开模糊)</span>
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
            <div class="st-thief-hint">默认保持纯网页模式。仅在启动本地 start_desktop.bat 时开启同步。</div>
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

    modal.querySelector('#btn-standalone-close-settings')?.addEventListener('click', closeSettingsModal);
    modal.querySelector('#btn-cancel-settings')?.addEventListener('click', closeSettingsModal);

    modal.querySelector('#btn-clear-whitelist')?.addEventListener('click', () => {
      const area = modal.querySelector('#setting-whitelist');
      if (area) {
        area.value = '';
        area.focus();
      }
    });

    modal.querySelector('#btn-clear-blacklist')?.addEventListener('click', () => {
      const area = modal.querySelector('#setting-blacklist');
      if (area) {
        area.value = '';
        area.focus();
      }
    });

    modal.querySelectorAll('.tb-wl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tag = chip.getAttribute('data-tag');
        const area = modal.querySelector('#setting-whitelist');
        if (!tag || !area) return;
        const curTags = area.value
          .split(/[,，\n]/)
          .map(s => s.trim().replace(/^[<\[]+|[>\]]+$/g, ''))
          .filter(Boolean);
        if (!curTags.includes(tag)) {
          curTags.push(tag);
          area.value = curTags.join(', ');
        }
      });
    });

    modal.querySelectorAll('.tb-bl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tag = chip.getAttribute('data-tag');
        const area = modal.querySelector('#setting-blacklist');
        if (!tag || !area) return;
        const curTags = area.value
          .split(/[,，\n]/)
          .map(s => s.trim().replace(/^[<\[]+|[>\]]+$/g, ''))
          .filter(Boolean);
        if (!curTags.includes(tag)) {
          curTags.push(tag);
          area.value = curTags.join(', ');
        }
      });
    });

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
      const blur = modal.querySelector('#setting-hover-blur');
      if (blur) blur.checked = false;
      const privacy = modal.querySelector('#setting-privacy-mode');
      if (privacy) privacy.checked = false;
      const mode = modal.querySelector('#setting-filtermode');
      if (mode) mode.value = 'pure';
      const barW = modal.querySelector('#setting-barwidth');
      if (barW) barW.value = '840';
      const deskSync = modal.querySelector('#setting-enable-desktopsync');
      if (deskSync) deskSync.checked = false;
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
      const blur = modal.querySelector('#setting-hover-blur');
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
          if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
            try {
              STATE.thiefWindow.resizeTo(CONFIG.barWidth, STATE.thiefWindow.outerHeight || 74);
            } catch (e) {}
          }
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
      if (blur) CONFIG.hoverBlur = blur.checked;
      if (mode) CONFIG.filterMode = mode.value;

      if (deskSync) {
        const oldState = CONFIG.enableDesktopSync;
        CONFIG.enableDesktopSync = deskSync.checked;
        if (!oldState && CONFIG.enableDesktopSync) {
          initDesktopBridge(true);
        } else if (oldState && !CONFIG.enableDesktopSync) {
          stopDesktopBridge();
        }
      }

      saveCurrentConfig();
      closeSettingsModal();
      flashStatusHint('设置已保存并生效');
      if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
        renderThiefBar();
      }
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
  // UI 渲染与样式构造 (VS Code 状态栏仿真)
  // ------------------------------------------------------------------------------------
  const CSS_STYLES = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, Consolas, monospace;
      font-size: 12px;
      user-select: none;
      -webkit-font-smoothing: antialiased;
    }

    body.theme-vscode-dark, #st-thief-inpage-container.theme-vscode-dark {
      background-color: #181818;
      color: #cccccc;
      border-top: 1px solid #2d2d2d;
    }
    body.theme-vscode-blue, #st-thief-inpage-container.theme-vscode-blue {
      background-color: #007acc;
      color: #ffffff;
      border-top: 1px solid #0062a3;
    }
    body.theme-terminal, #st-thief-inpage-container.theme-terminal {
      background-color: #0c0c0c;
      color: #00ff66;
      border-top: 1px solid #1a1a1a;
      font-family: Consolas, 'Courier New', monospace;
    }

    #tb-container {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      justify-content: center;
      position: relative;
    }

    /* 第一行：正文阅读栏 */
    .tb-row-reading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 32px;
      padding: 3px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    body.single-mode .tb-row-reading {
      border-bottom: none;
    }

    /* 拖拽手柄 */
    .tb-drag-handle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      padding: 0 4px;
      font-size: 13px;
      color: #777777;
      user-select: none;
      touch-action: none;
      transition: color 0.15s ease, transform 0.1s ease;
      line-height: 1;
    }
    .tb-drag-handle:hover {
      color: #4ec9b0;
      transform: scale(1.15);
    }
    .tb-drag-handle:active {
      cursor: grabbing;
      color: #73e6cf;
    }

    /* 左侧 Git 分支与楼层导航器 */
    .tb-section-left {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      font-size: 11px;
    }
    .tb-git-branch {
      color: #858585;
      font-family: Consolas, monospace;
      padding: 1px 4px;
      border-radius: 3px;
      cursor: default;
      transition: background 0.15s, color 0.15s;
    }
    .tb-git-branch:hover {
      color: #cccccc;
      background: rgba(255, 255, 255, 0.06);
    }

    /* 楼层导航组件 */
    .tb-floor-nav-wrap {
      display: inline-flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 3px;
      padding: 0 2px;
      height: 20px;
      transition: all 0.15s ease;
    }
    .tb-floor-nav-wrap:hover {
      border-color: #007acc;
      background: rgba(0, 122, 204, 0.1);
    }
    .tb-floor-btn-step {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 18px;
      font-size: 8px;
      color: #888888;
      cursor: pointer;
      user-select: none;
      transition: all 0.12s ease;
      border-radius: 2px;
    }
    .tb-floor-btn-step:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }
    .tb-floor-btn-step:active {
      transform: scale(0.88);
    }
    .tb-floor-num-badge {
      padding: 0 5px;
      font-family: Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      color: #9cdcfe;
      cursor: pointer;
      user-select: none;
      transition: all 0.12s ease;
      border-radius: 2px;
    }
    .tb-floor-num-badge:hover {
      background: #0e639c;
      color: #ffffff;
    }

    .tb-spin-icon {
      display: inline-block;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }

    /* 中间正文区域 */
    .tb-section-center {
      display: flex;
      align-items: center;
      flex: 1;
      overflow: hidden;
      margin: 0 8px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
      transition: background 0.15s ease;
    }
    .tb-section-center:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    /* 角色名徽章 */
    .tb-char-badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      margin-right: 6px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 3px;
      background: rgba(78, 201, 176, 0.12);
      color: #4ec9b0;
      border: 1px solid rgba(78, 201, 176, 0.3);
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .tb-char-badge:hover {
      background: rgba(78, 201, 176, 0.22);
      border-color: #4ec9b0;
      color: #73e6cf;
    }
    .tb-char-compact {
      max-width: 68px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tb-char-hidden-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-right: 4px;
      font-size: 11px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.05);
      color: #888888;
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .tb-char-hidden-pill:hover {
      background: rgba(78, 201, 176, 0.2);
      color: #4ec9b0;
    }
    body.theme-vscode-blue .tb-char-badge {
      background: rgba(255, 230, 153, 0.15);
      color: #ffe699;
      border-color: rgba(255, 230, 153, 0.35);
    }

    .tb-sentence-text {
      color: #f1f1f1;
      font-size: 12.5px;
      letter-spacing: 0.2px;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: clip;
      transition: filter 0.2s, opacity 0.15s;
    }
    .tb-sentence-text.nowrap {
      overflow: hidden;
      text-overflow: clip;
      white-space: nowrap;
    }
    body.theme-vscode-blue .tb-sentence-text { color: #ffffff; }

    body.tb-blur-mode .tb-sentence-text { filter: blur(4px); }
    body.tb-blur-mode:hover .tb-sentence-text { filter: blur(0); }

    /* 👻 隐私模式 (移开隐藏，鼠标悬浮在窗口上方时才显示工具条) */
    body.tb-privacy-mode {
      background-color: transparent !important;
      transition: opacity 0.22s ease-in, background-color 0.22s ease-in;
    }
    body.tb-privacy-mode:not(:hover):not(.tb-mouse-over):not(.tb-privacy-active) {
      opacity: 0 !important;
      background-color: transparent !important;
      border-color: transparent !important;
      box-shadow: none !important;
      pointer-events: auto;
      transition: opacity 0.22s ease-in, background-color 0.22s ease-in;
    }
    body.tb-privacy-mode:hover,
    body.tb-privacy-mode.tb-mouse-over,
    body.tb-privacy-mode.tb-privacy-active {
      opacity: var(--tb-user-opacity, 0.95) !important;
      pointer-events: auto;
      transition: opacity 0.15s ease-out, background-color 0.15s ease-out;
    }
    body.tb-privacy-mode.theme-vscode-dark:hover,
    body.tb-privacy-mode.theme-vscode-dark.tb-mouse-over,
    body.tb-privacy-mode.theme-vscode-dark.tb-privacy-active {
      background-color: #181818 !important;
      border-top: 1px solid #2d2d2d !important;
    }
    body.tb-privacy-mode.theme-vscode-blue:hover,
    body.tb-privacy-mode.theme-vscode-blue.tb-mouse-over,
    body.tb-privacy-mode.theme-vscode-blue.tb-privacy-active {
      background-color: #007acc !important;
      border-top: 1px solid #0062a3 !important;
    }
    body.tb-privacy-mode.theme-terminal:hover,
    body.tb-privacy-mode.theme-terminal.tb-mouse-over,
    body.tb-privacy-mode.theme-terminal.tb-privacy-active {
      background-color: #0c0c0c !important;
      border-top: 1px solid #1a1a1a !important;
    }

    #st-thief-inpage-container.tb-privacy-mode {
      background-color: transparent !important;
      transition: bottom 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.22s ease-in, background-color 0.22s ease-in;
    }
    #st-thief-inpage-container.tb-privacy-mode:not(:hover):not(.tb-mouse-over):not(.tb-privacy-active) {
      opacity: 0 !important;
      background-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
      pointer-events: auto;
      transition: opacity 0.22s ease-in;
    }
    #st-thief-inpage-container.tb-privacy-mode:hover,
    #st-thief-inpage-container.tb-privacy-mode.tb-mouse-over,
    #st-thief-inpage-container.tb-privacy-mode.tb-privacy-active {
      opacity: var(--tb-user-opacity, 0.95) !important;
      pointer-events: auto;
      box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.7);
      transition: opacity 0.15s ease-out;
    }
    #st-thief-inpage-container.tb-privacy-mode.theme-vscode-dark:hover,
    #st-thief-inpage-container.tb-privacy-mode.theme-vscode-dark.tb-mouse-over,
    #st-thief-inpage-container.tb-privacy-mode.theme-vscode-dark.tb-privacy-active {
      background-color: #181818 !important;
      border-top: 1px solid #2d2d2d !important;
    }
    #st-thief-inpage-container.tb-privacy-mode.theme-vscode-blue:hover,
    #st-thief-inpage-container.tb-privacy-mode.theme-vscode-blue.tb-mouse-over,
    #st-thief-inpage-container.tb-privacy-mode.theme-vscode-blue.tb-privacy-active {
      background-color: #007acc !important;
      border-top: 1px solid #0062a3 !important;
    }
    #st-thief-inpage-container.tb-privacy-mode.theme-terminal:hover,
    #st-thief-inpage-container.tb-privacy-mode.theme-terminal.tb-mouse-over,
    #st-thief-inpage-container.tb-privacy-mode.theme-terminal.tb-privacy-active {
      background-color: #0c0c0c !important;
      border-top: 1px solid #1a1a1a !important;
    }

    /* 移动端/触屏环境豁免：触屏无 hover 特性，防止隐私模式导致移动端完全不可见 */
    @media (hover: none), (max-width: 768px) {
      body.tb-privacy-mode:not(:hover):not(.tb-mouse-over):not(.tb-privacy-active),
      #st-thief-inpage-container.tb-privacy-mode:not(:hover):not(.tb-mouse-over):not(.tb-privacy-active) {
        opacity: var(--tb-user-opacity, 0.95) !important;
      }
      #st-thief-inpage-container.tb-privacy-mode.theme-vscode-dark {
        background-color: #181818 !important;
        border-top: 1px solid #2d2d2d !important;
      }
      #st-thief-inpage-container.tb-privacy-mode.theme-vscode-blue {
        background-color: #007acc !important;
        border-top: 1px solid #0062a3 !important;
      }
      #st-thief-inpage-container.tb-privacy-mode.theme-terminal {
        background-color: #0c0c0c !important;
        border-top: 1px solid #1a1a1a !important;
      }
    }

    /* 右侧精简状态与功能触发器 */
    .tb-section-right {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
      font-size: 11px;
      opacity: 0.9;
    }
    .tb-progress-badge {
      font-family: Consolas, monospace;
      font-size: 11px;
      color: #858585;
      background: rgba(255, 255, 255, 0.05);
      padding: 1px 6px;
      border-radius: 3px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      user-select: none;
      cursor: default;
    }
    .tb-menu-trigger {
      font-size: 15px;
      font-weight: bold;
      color: #9cdcfe;
      padding: 1px 6px;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.15s ease;
      line-height: 1;
    }
    .tb-menu-trigger:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
    }

    /* VS Code 风格右键上下文菜单 */
    #tb-context-menu {
      position: fixed;
      z-index: 999999;
      background: #1f1f1f;
      border: 1px solid #454545;
      border-radius: 5px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.75);
      padding: 4px 0;
      min-width: 230px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Consolas, sans-serif;
      font-size: 12px;
      color: #cccccc;
      user-select: none;
      animation: tbMenuFade 0.1s ease-out;
    }
    @keyframes tbMenuFade {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }
    .tb-menu-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 12px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .tb-menu-item:hover {
      background: #094771;
      color: #ffffff;
    }
    .tb-menu-item-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tb-menu-item-icon {
      width: 14px;
      text-align: center;
      font-size: 12px;
      opacity: 0.85;
    }
    .tb-menu-mark {
      width: 14px;
      text-align: center;
      font-size: 11px;
      color: #4ec9b0;
      font-weight: bold;
      display: inline-block;
      flex-shrink: 0;
    }
    .tb-menu-shortcut {
      font-size: 10px;
      color: #858585;
      margin-left: 14px;
      font-family: Consolas, monospace;
    }
    .tb-menu-item:hover .tb-menu-shortcut {
      color: #b8d9fc;
    }
    .tb-menu-separator {
      height: 1px;
      background: #333333;
      margin: 4px 0;
    }
    .tb-menu-tag {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.08);
      color: #4ec9b0;
      margin-left: 6px;
    }
    .tb-menu-item:hover .tb-menu-tag {
      background: rgba(255, 255, 255, 0.2);
      color: #ffffff;
    }

    .tb-btn {
      cursor: pointer;
      padding: 2px 5px;
      border-radius: 3px;
      transition: all 0.12s ease;
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    .tb-btn:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
      opacity: 1;
    }
    .tb-btn:active {
      transform: scale(0.92);
    }

    /* 第二行：单行回复区 */
    .tb-row-reply {
      display: flex;
      align-items: center;
      height: 30px;
      padding: 0 10px;
      background: rgba(0, 0, 0, 0.22);
      border-top: 1px solid rgba(255, 255, 255, 0.04);
      gap: 6px;
    }
    .tb-reply-prefix {
      color: #4ec9b0;
      font-family: Consolas, monospace;
      font-weight: bold;
      font-size: 13px;
    }
    .tb-reply-input {
      flex: 1;
      height: 22px;
      line-height: 22px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 3px;
      color: #ffffff;
      padding: 0 8px;
      font-size: 12px;
      outline: none;
      font-family: inherit;
      transition: all 0.15s ease;
    }
    .tb-reply-input:focus {
      border-color: #007acc;
      background: rgba(0, 0, 0, 0.4);
      box-shadow: 0 0 0 1px #007acc;
    }
    .tb-send-btn {
      padding: 2px 10px;
      background: #0e639c;
      color: #ffffff;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      user-select: none;
      transition: all 0.15s ease;
    }
    .tb-send-btn:hover {
      background: #1177bb;
      box-shadow: 0 1px 4px rgba(0, 122, 204, 0.4);
    }
    .tb-send-btn:active {
      transform: scale(0.95);
    }

    /* 楼层跳转快速浮窗 */
    #tb-floor-popover {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 4px;
      animation: tbFadeIn 0.15s ease-out;
    }
    @keyframes tbFadeIn {
      from { opacity: 0; transform: scale(0.98); }
      to { opacity: 1; transform: scale(1); }
    }
    .tb-floor-popover-card {
      background: #1e1e1e;
      border: 1px solid #3c3c3c;
      border-radius: 4px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7);
      padding: 6px 12px;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      font-size: 11px;
      color: #cccccc;
    }
    .tb-pop-btn {
      padding: 2px 8px;
      background: #2a2a2a;
      border: 1px solid #3c3c3c;
      border-radius: 3px;
      color: #cccccc;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
    }
    .tb-pop-btn:hover {
      background: #3a3a3a;
      color: #ffffff;
      border-color: #555555;
    }
    .tb-pop-btn:active {
      transform: scale(0.95);
    }
    .tb-pop-btn.tb-pop-primary {
      background: #0e639c;
      border-color: #1177bb;
      color: #ffffff;
      font-weight: 600;
    }
    .tb-pop-btn.tb-pop-primary:hover {
      background: #1177bb;
    }

    /* 设置模态弹窗 (视口自适应居中) */
    #tb-settings-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999999;
      padding: 10px;
      animation: tbFadeIn 0.15s ease-out;
      box-sizing: border-box;
    }
    .tb-settings-card {
      background: #1e1e1e;
      color: #cccccc;
      border: 1px solid #3c3c3c;
      border-radius: 6px;
      width: 100%;
      max-width: 720px;
      max-height: 88vh;
      height: auto;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow-y: auto;
      font-size: 11px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.85);
      box-sizing: border-box;
    }

    /* 宿主页内悬浮条专属容器 (手机端与无弹窗环境) */
    #st-thief-inpage-container {
      position: fixed;
      bottom: max(0px, env(safe-area-inset-bottom, 0px));
      left: 0;
      width: 100%;
      max-width: 100vw;
      z-index: 999998;
      box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.7);
      user-select: none;
      box-sizing: border-box;
      touch-action: none;
      transition: bottom 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.15s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, Consolas, monospace;
    }
    #st-thief-inpage-container #tb-container {
      width: 100%;
      height: 100%;
    }

    @media (max-width: 768px) {
      .tb-git-branch {
        display: none !important;
      }
      .tb-section-left {
        gap: 2px !important;
      }
      .tb-char-compact {
        max-width: 50px !important;
      }
      .tb-sentence-text {
        font-size: 13px !important;
      }
      #tb-context-menu {
        max-width: 90vw !important;
      }
      .tb-settings-card {
        max-height: 86vh !important;
        padding: 8px 10px !important;
      }
    }
    .tb-settings-card::-webkit-scrollbar {
      width: 5px;
    }
    .tb-settings-card::-webkit-scrollbar-thumb {
      background: #3c3c3c;
      border-radius: 3px;
    }
    .tb-settings-card::-webkit-scrollbar-thumb:hover {
      background: #555555;
    }

    .tb-tag-chip {
      padding: 1px 6px;
      background: #252526;
      color: #9cdcfe;
      border: 1px solid #3c3c3c;
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s, color 0.15s;
    }
    .tb-tag-chip:hover {
      background: #37373d;
      color: #ffffff;
      border-color: #007acc;
    }
    .tb-wl-chip, .tb-bl-chip {
      padding: 1px 6px;
      background: #252526;
      border: 1px solid #3c3c3c;
      border-radius: 3px;
      font-size: 10px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s, color 0.15s;
    }
    .tb-wl-chip { color: #4ec9b0; }
    .tb-wl-chip:hover {
      background: #1e3a35;
      color: #73e6cf;
      border-color: #4ec9b0;
    }
    .tb-bl-chip { color: #f48771; }
    .tb-bl-chip:hover {
      background: #3c2420;
      color: #ffa593;
      border-color: #f48771;
    }

    /* 极简模式 (纯文字+背景，完全符合参考图规范) */
    body.minimal-mode {
      border: none !important;
      background: #141414;
    }
    body.minimal-mode.theme-vscode-dark {
      background-color: #121212 !important;
      border: none !important;
    }
    body.minimal-mode.theme-vscode-blue {
      background-color: #0d283d !important;
      border: none !important;
    }
    body.minimal-mode.theme-terminal {
      background-color: #000000 !important;
      border: none !important;
    }
    body.minimal-mode .tb-section-left {
      display: none !important;
    }
    body.minimal-mode .tb-section-right {
      display: none !important;
    }
    body.minimal-mode .tb-char-badge,
    body.minimal-mode .tb-char-hidden-pill {
      display: none !important;
    }
    body.minimal-mode .tb-row-reading {
      padding: 3px 12px !important;
      border-bottom: none !important;
      min-height: 26px !important;
    }
    body.minimal-mode .tb-section-center {
      margin: 0 !important;
      padding: 2px 4px !important;
    }
    body.minimal-mode .tb-sentence-text {
      font-size: 13px !important;
      color: #dddddd !important;
      letter-spacing: 0.3px !important;
    }
    body.minimal-mode.double-mode .tb-row-reply {
      height: 26px !important;
      padding: 0 12px 4px 12px !important;
      background: transparent !important;
      border-top: none !important;
      gap: 0 !important;
    }
    body.minimal-mode .tb-reply-prefix {
      display: none !important;
    }
    body.minimal-mode .tb-send-btn {
      display: none !important;
    }
    body.minimal-mode .tb-reply-input {
      height: 20px !important;
      line-height: 20px !important;
      font-size: 11px !important;
      background: rgba(255, 255, 255, 0.05) !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-radius: 2px !important;
      color: #ccc !important;
      padding: 0 6px !important;
      width: 100% !important;
    }
    body.minimal-mode .tb-reply-input:focus {
      background: rgba(255, 255, 255, 0.1) !important;
      border-color: rgba(255, 255, 255, 0.25) !important;
      box-shadow: none !important;
    }
  `;

  function renderThiefBar() {
    if (!STATE.thiefWindow || !STATE.thiefWindow.document) return;
    const doc = STATE.thiefWindow.document;

    if (!doc.getElementById('tb-style')) {
      const style = doc.createElement('style');
      style.id = 'tb-style';
      style.textContent = CSS_STYLES;
      doc.head.appendChild(style);
    }

    const isInteracting = STATE.isContextMenuOpen || STATE.isSettingsOpen || STATE.isFloorPickerOpen || (doc.activeElement && doc.activeElement.tagName === 'INPUT');
    const activePrivacyClass = isInteracting ? 'tb-privacy-active' : '';

    if (!STATE.isHostInpage) {
      doc.body.className = `theme-${CONFIG.theme} ${CONFIG.hoverBlur ? 'tb-blur-mode' : ''} ${CONFIG.privacyMode ? 'tb-privacy-mode' : ''} ${CONFIG.layoutMode === 'single' ? 'single-mode' : 'double-mode'} ${CONFIG.minimalMode ? 'minimal-mode' : ''} ${activePrivacyClass}`.trim();
      doc.body.style.setProperty('--tb-user-opacity', CONFIG.opacity);
      if (CONFIG.privacyMode) {
        doc.body.style.opacity = '';
      } else {
        doc.body.style.opacity = CONFIG.opacity;
      }
    }

    let container = doc.getElementById('tb-container');
    if (!container) {
      container = doc.createElement('div');
      container.id = 'tb-container';
      if (STATE.isHostInpage && STATE.inpageContainer) {
        STATE.inpageContainer.appendChild(container);
      } else {
        doc.body.appendChild(container);
      }
      bindWindowEvents(STATE.thiefWindow);
    }

    if (STATE.isHostInpage && STATE.inpageContainer) {
      STATE.inpageContainer.className = `theme-${CONFIG.theme} ${CONFIG.hoverBlur ? 'tb-blur-mode' : ''} ${CONFIG.privacyMode ? 'tb-privacy-mode' : ''} ${CONFIG.layoutMode === 'single' ? 'single-mode' : 'double-mode'} ${CONFIG.minimalMode ? 'minimal-mode' : ''} ${activePrivacyClass}`.trim();
      STATE.inpageContainer.style.setProperty('--tb-user-opacity', CONFIG.opacity);
      if (CONFIG.privacyMode) {
        STATE.inpageContainer.style.opacity = '';
      } else {
        STATE.inpageContainer.style.opacity = CONFIG.opacity;
      }
    }

    // 1. 老板键伪装模式
    if (STATE.isBossKey) {
      container.innerHTML = `
        <div class="tb-row-reading">
          <div class="tb-section-left">
            <span>⎇ main*</span>
            <span>✓ 0 ⨉ 0</span>
          </div>
          <div class="tb-section-center" style="cursor:default;">
            <span style="opacity:0.9;">${CONFIG.bossTemplates[0]}</span>
          </div>
          <div class="tb-section-right">
            <span>TypeScript 5.4.5</span>
            <span>UTF-8</span>
            <span>Ln 142, Col 8</span>
            <span class="tb-btn" id="btn-boss" title="退出伪装 (Esc)">🕶️</span>
          </div>
        </div>
        ${
          CONFIG.layoutMode === 'double'
            ? `
          <div class="tb-row-reply">
            <span style="opacity:0.6;font-size:11px;font-family:Consolas,monospace;">${CONFIG.bossTemplates[1]}</span>
          </div>
        `
            : ''
        }
      `;
      doc.getElementById('btn-boss')?.addEventListener('click', () => toggleBossKey(false));
      return;
    }

    // 2. 正常阅读模式
    const totalSentences = STATE.sentences.length;
    const currentSentence = STATE.sentences[STATE.currentSentenceIndex] || '(空)';
    const curIdx = totalSentences > 0 ? STATE.currentSentenceIndex + 1 : 0;
    const lastId = typeof getLastMessageId === 'function' ? getLastMessageId() : Math.max(0, STATE.currentMsgId);
    const displayFloor = STATE.currentMsgId >= 0 ? STATE.currentMsgId : 0;

    const leftIconHtml = STATE.isGenerating
      ? `<span class="tb-drag-handle" id="tb-drag-handle" title="按住拖拽调节摸鱼条上下高度 (双击贴底复位)">⠿</span> <span class="tb-spin-icon" title="AI 生成中...">⟳</span> <span style="color:#dcdcaa;font-size:11px;">Building...</span>`
      : `
        <span class="tb-drag-handle" id="tb-drag-handle" title="按住拖拽调节摸鱼条上下高度 (双击贴底复位)">⠿</span>
        <span class="tb-git-branch" title="Git 分支">⎇ main*</span>
        <div class="tb-floor-nav-wrap" title="楼层导航 (点击跳转)">
          <span class="tb-floor-btn-step" id="btn-floor-prev" title="上一楼 (快捷键: PageUp)">▲</span>
          <span class="tb-floor-num-badge" id="btn-floor-picker" title="当前: 第 #${displayFloor} 楼 / 共 ${lastId} 楼\n[点击] 打开楼层快速跳转面板">#${displayFloor} ▾</span>
          <span class="tb-floor-btn-step" id="btn-floor-next" title="下一楼 (快捷键: PageDown)">▼</span>
        </div>
      `;

    let charBadgeHtml = '';
    if (CONFIG.charNameMode === 'hidden') {
      charBadgeHtml = `<span class="tb-char-hidden-pill" id="tb-char-badge" title="角色名已隐藏 (点击恢复显示: ${escapeHtml(STATE.characterName)})">👤</span>`;
    } else {
      const isCompact = CONFIG.charNameMode === 'compact';
      charBadgeHtml = `
        <span class="tb-char-badge ${isCompact ? 'tb-char-compact' : ''}" id="tb-char-badge" title="当前角色: ${escapeHtml(STATE.characterName)}\n[点击切换模式]: 精简胶囊 / 完全隐藏 / 完整显示">
          ${escapeHtml(STATE.characterName)}
        </span>
      `;
    }

    const isNowrap = CONFIG.wrapMode === 'single';
    const centerHtml = `
      <div class="tb-section-center" id="tb-text-wrapper" title="点击阅读下一句 (也可按 ←/→ 翻句，滚轮滚动)">
        ${charBadgeHtml}
        <span class="tb-sentence-text ${isNowrap ? 'nowrap' : ''}" id="tb-text">${escapeHtml(currentSentence)}</span>
      </div>
    `;

    const rightHtml = `
      <div class="tb-section-right">
        <span class="tb-progress-badge" id="tb-progress" title="当前阅读进度">${curIdx}/${totalSentences}</span>
        <span class="tb-menu-trigger" id="btn-context-menu" title="功能菜单 (鼠标右键任意处也可唤出)">⋮</span>
        ${STATE.isHostInpage ? `<span class="tb-menu-trigger tb-close-btn" id="btn-inpage-close" title="收起摸鱼条" style="color:#e06c75; font-size:12px; margin-left:2px; font-weight:bold;">✕</span>` : ''}
      </div>
    `;

    let replyRowHtml = '';
    if (CONFIG.layoutMode === 'double') {
      replyRowHtml = `
        <div class="tb-row-reply">
          <span class="tb-reply-prefix">&gt;</span>
          <input type="text" class="tb-reply-input" id="tb-input" placeholder="输入回复并按 Enter 发送..." />
          <span class="tb-send-btn" id="btn-send">发送</span>
        </div>
      `;
    }

    // 楼层跳转快速浮窗 HTML
    let floorPopoverHtml = '';
    if (STATE.isFloorPickerOpen) {
      floorPopoverHtml = `
        <div id="tb-floor-popover">
          <div class="tb-floor-popover-card">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:3px; margin-bottom:5px;">
              <span style="font-weight:600; color:#4ec9b0; font-size:11px;">📖 快速楼层跳转 (当前: #${displayFloor} / 共 ${lastId} 楼)</span>
              <span id="btn-close-floor-popover" style="cursor:pointer; font-size:13px; color:#888; padding:0 4px; font-weight:bold;" title="关闭">✕</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:5px; flex-wrap:wrap;">
              <div style="display:flex; gap:4px;">
                <button class="tb-pop-btn" id="btn-floor-first" title="回到第一楼 (#0)">⏮ 首页</button>
                <button class="tb-pop-btn" id="btn-floor-pop-prev" title="上一楼">◀ 上楼</button>
              </div>
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="font-size:11px; opacity:0.8;">跳转到第</span>
                <input type="number" id="tb-floor-input" value="${displayFloor}" min="0" max="${lastId}" style="width:48px; background:#141414; border:1px solid #3c3c3c; color:#fff; padding:2px 4px; border-radius:3px; font-size:11px; text-align:center; outline:none;" />
                <span style="font-size:11px; opacity:0.8;">楼</span>
                <button class="tb-pop-btn tb-pop-primary" id="btn-floor-go">GO</button>
              </div>
              <div style="display:flex; gap:4px;">
                <button class="tb-pop-btn" id="btn-floor-pop-next" title="下一楼">下楼 ▶</button>
                <button class="tb-pop-btn" id="btn-floor-last" title="跳转到最新楼 (#${lastId})">最新 ⏭</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 右键上下文菜单 HTML
    let contextMenuHtml = '';
    if (STATE.isContextMenuOpen) {
      const topWin = window.top || window;
      const vp = topWin.visualViewport;
      const docW = (vp ? vp.width : topWin.innerWidth) || doc.documentElement.clientWidth || 800;
      const docH = (vp ? vp.height : topWin.innerHeight) || doc.documentElement.clientHeight || 400;
      let posStyle = '';

      if (STATE.isHostInpage || isMobileDevice()) {
        // 页内浮窗贴底时，菜单向上展开，避免被软键盘或屏幕边缘截断
        posStyle = `right: 10px; bottom: calc(65px + env(safe-area-inset-bottom, 0px));`;
      } else {
        const posX = Math.min(docW - 240, Math.max(10, STATE.contextMenuPos.x || (docW - 240)));
        const posY = Math.min(docH - 280, Math.max(5, STATE.contextMenuPos.y || 25));
        posStyle = `left: ${posX}px; top: ${posY}px;`;
      }
      contextMenuHtml = `
        <div id="tb-context-menu" style="${posStyle}">
          <div class="tb-menu-item" id="menu-toggle-minimal">
            <div class="tb-menu-item-left"><span class="tb-menu-mark">${CONFIG.minimalMode ? '✓' : ''}</span><span>极简模式</span></div>
            <span class="tb-menu-shortcut">${CONFIG.minimalMode ? '已开启' : ''}</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-privacy">
            <div class="tb-menu-item-left"><span class="tb-menu-mark">${CONFIG.privacyMode ? '✓' : ''}</span><span>隐私模式 (悬停显示)</span></div>
            <span class="tb-menu-shortcut">${CONFIG.privacyMode ? '已开启' : ''}</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-layout">
            <div class="tb-menu-item-left"><span class="tb-menu-mark">${CONFIG.layoutMode === 'double' ? '✓' : ''}</span><span>双行布局 (含回复框)</span></div>
            <span class="tb-menu-shortcut">${CONFIG.layoutMode === 'double' ? '双行' : '单行'}</span>
          </div>
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-prev">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>上一句</span></div>
            <span class="tb-menu-shortcut">←</span>
          </div>
          <div class="tb-menu-item" id="menu-next">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>下一句</span></div>
            <span class="tb-menu-shortcut">→</span>
          </div>
          <div class="tb-menu-item" id="menu-swipe">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>重新生成</span></div>
            <span class="tb-menu-shortcut">Alt+S</span>
          </div>
          ${STATE.isGenerating ? `
          <div class="tb-menu-item" id="menu-stop" style="color:#f44747;">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>中止生成</span></div>
            <span class="tb-menu-shortcut">Alt+X</span>
          </div>
          ` : ''}
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-floor-prev">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>上一楼</span></div>
            <span class="tb-menu-shortcut">PageUp</span>
          </div>
          <div class="tb-menu-item" id="menu-floor-next">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>下一楼</span></div>
            <span class="tb-menu-shortcut">PageDown</span>
          </div>
          <div class="tb-menu-item" id="menu-floor-jump">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>跳转楼层...</span></div>
            <span class="tb-menu-shortcut">#${displayFloor}</span>
          </div>
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-toggle-wrap">
            <div class="tb-menu-item-left"><span class="tb-menu-mark">${CONFIG.wrapMode === 'wrap' ? '✓' : ''}</span><span>自动折行全显</span></div>
          </div>
          <div class="tb-menu-item" id="menu-toggle-user-messages">
            <div class="tb-menu-item-left"><span class="tb-menu-mark">${CONFIG.showUserMessages ? '✓' : ''}</span><span>显示用户消息</span></div>
          </div>
          <div class="tb-menu-item" id="menu-toggle-width">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>窗口长度</span></div>
            <span class="tb-menu-shortcut">${CONFIG.barWidth}px</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-char">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>角色名模式</span></div>
            <span class="tb-menu-shortcut">${CONFIG.charNameMode === 'compact' ? '精简' : (CONFIG.charNameMode === 'hidden' ? '隐藏' : '完整')}</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-filter">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>过滤模式</span></div>
            <span class="tb-menu-shortcut">${CONFIG.filterMode === 'pure' ? '纯净' : '正则'}</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-desktopsync">
            <div class="tb-menu-item-left"><span class="tb-menu-mark">${CONFIG.enableDesktopSync ? '✓' : ''}</span><span>桌面端同步</span></div>
            <span class="tb-menu-shortcut">${CONFIG.enableDesktopSync ? (STATE.wsClient ? '已连接' : '未连接') : '未开启'}</span>
          </div>
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-boss">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>老板键 (伪装)</span></div>
            <span class="tb-menu-shortcut">Esc</span>
          </div>
          <div class="tb-menu-item" id="menu-settings">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>设置...</span></div>
          </div>
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-inpage-close" style="color:#e06c75;">
            <div class="tb-menu-item-left"><span class="tb-menu-mark"></span><span>退出摸鱼条</span></div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="tb-row-reading">
        <div class="tb-section-left">${leftIconHtml}</div>
        ${centerHtml}
        ${rightHtml}
      </div>
      ${replyRowHtml}
      ${floorPopoverHtml}
      ${contextMenuHtml}
    `;

    doc.getElementById('tb-text-wrapper')?.addEventListener('click', nextSentence);
    doc.getElementById('tb-char-badge')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleCharNameMode();
    });
    doc.getElementById('btn-floor-prev')?.addEventListener('click', e => {
      e.stopPropagation();
      changeMessageFloor(-1);
    });
    doc.getElementById('btn-floor-next')?.addEventListener('click', e => {
      e.stopPropagation();
      changeMessageFloor(1);
    });
    doc.getElementById('btn-floor-picker')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleFloorPicker();
    });
    doc.getElementById('btn-context-menu')?.addEventListener('click', e => {
      e.stopPropagation();
      if (STATE.isContextMenuOpen) {
        closeContextMenu();
      } else {
        const rect = e.target.getBoundingClientRect();
        openContextMenu(rect.left - 200, rect.bottom + 4);
      }
    });
    doc.getElementById('btn-inpage-close')?.addEventListener('click', e => {
      e.stopPropagation();
      closeThiefBar();
    });
    doc.getElementById('tb-drag-handle')?.addEventListener('dblclick', e => {
      e.stopPropagation();
      if (STATE.isHostInpage && STATE.inpageContainer) {
        STATE.inpageContainer.style.bottom = 'max(0px, env(safe-area-inset-bottom, 0px))';
        try { localStorage.removeItem('ST_THIEF_INPAGE_BOTTOM'); } catch (err) {}
        flashStatusHint('摸鱼条已贴底复位');
      }
    });

    // 右键上下文菜单项事件绑定
    if (STATE.isContextMenuOpen) {
      doc.getElementById('menu-toggle-minimal')?.addEventListener('click', () => { closeContextMenu(); toggleMinimalMode(); });
      doc.getElementById('menu-toggle-privacy')?.addEventListener('click', () => { closeContextMenu(); togglePrivacyMode(); });
      doc.getElementById('menu-toggle-user-messages')?.addEventListener('click', () => { closeContextMenu(); toggleShowUserMessages(); });
      doc.getElementById('menu-prev')?.addEventListener('click', () => { closeContextMenu(); prevSentence(); });
      doc.getElementById('menu-next')?.addEventListener('click', () => { closeContextMenu(); nextSentence(); });
      doc.getElementById('menu-floor-prev')?.addEventListener('click', () => { closeContextMenu(); changeMessageFloor(-1); });
      doc.getElementById('menu-floor-next')?.addEventListener('click', () => { closeContextMenu(); changeMessageFloor(1); });
      doc.getElementById('menu-floor-jump')?.addEventListener('click', () => { closeContextMenu(); toggleFloorPicker(true); });
      doc.getElementById('menu-swipe')?.addEventListener('click', () => { closeContextMenu(); swipeMessage(); });
      doc.getElementById('menu-stop')?.addEventListener('click', () => { closeContextMenu(); stopGeneration(); });
      doc.getElementById('menu-toggle-char')?.addEventListener('click', () => { closeContextMenu(); toggleCharNameMode(); });
      doc.getElementById('menu-toggle-wrap')?.addEventListener('click', () => { closeContextMenu(); toggleWrapMode(); });
      doc.getElementById('menu-toggle-width')?.addEventListener('click', () => { closeContextMenu(); cycleBarWidth(); });
      doc.getElementById('menu-toggle-filter')?.addEventListener('click', () => { closeContextMenu(); toggleFilterMode(); });
      doc.getElementById('menu-toggle-desktopsync')?.addEventListener('click', () => { closeContextMenu(); toggleDesktopSync(); });
      doc.getElementById('menu-toggle-layout')?.addEventListener('click', () => { closeContextMenu(); toggleLayoutMode(); });
      doc.getElementById('menu-boss')?.addEventListener('click', () => { closeContextMenu(); toggleBossKey(true); });
      doc.getElementById('menu-settings')?.addEventListener('click', () => { closeContextMenu(); openSettingsModal(); });
      doc.getElementById('menu-inpage-close')?.addEventListener('click', () => { closeContextMenu(); closeThiefBar(); });
    }

    const input = doc.getElementById('tb-input');
    const sendBtn = doc.getElementById('btn-send');

    if (input) {
      input.addEventListener('focus', () => {
        const targetEl = STATE.isHostInpage ? STATE.inpageContainer : doc.body;
        if (targetEl) targetEl.classList.add('tb-privacy-active');
      });
      input.addEventListener('blur', () => {
        const targetEl = STATE.isHostInpage ? STATE.inpageContainer : doc.body;
        if (targetEl) targetEl.classList.remove('tb-privacy-active');
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = input.value;
          input.value = '';
          submitReply(val);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          input.value = '';
          input.blur();
        }
      });
    }

    if (sendBtn && input) {
      sendBtn.addEventListener('click', () => {
        const val = input.value;
        input.value = '';
        submitReply(val);
      });
    }

    // 楼层跳转快速浮窗事件绑定
    if (STATE.isFloorPickerOpen) {
      doc.getElementById('btn-close-floor-popover')?.addEventListener('click', () => toggleFloorPicker(false));
      doc.getElementById('btn-floor-first')?.addEventListener('click', () => jumpToMessageFloor(0));
      doc.getElementById('btn-floor-pop-prev')?.addEventListener('click', () => changeMessageFloor(-1));
      doc.getElementById('btn-floor-pop-next')?.addEventListener('click', () => changeMessageFloor(1));
      doc.getElementById('btn-floor-last')?.addEventListener('click', () => jumpToMessageFloor(lastId));

      const floorInput = doc.getElementById('tb-floor-input');
      const floorGo = doc.getElementById('btn-floor-go');
      if (floorInput && floorGo) {
        const doJump = () => {
          const val = parseInt(floorInput.value, 10);
          if (!isNaN(val)) jumpToMessageFloor(val);
        };
        floorGo.addEventListener('click', doJump);
        floorInput.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            doJump();
          } else if (e.key === 'Escape') {
            toggleFloorPicker(false);
          }
        });
      }
    }

  }

  // ------------------------------------------------------------------------------------
  // 窗口按键与鼠标事件监听
  // ------------------------------------------------------------------------------------
  function bindWindowEvents(win) {
    if (!win || !win.document) return;
    if (win.document._tbEventsBound) return;
    win.document._tbEventsBound = true;

    // 1. 键盘快捷键监听
    win.document.addEventListener('keydown', e => {
      if (STATE.isContextMenuOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeContextMenu();
          return;
        }
      }

      if (STATE.isSettingsOpen) {
        if (e.key === 'Escape') {
          closeSettingsModal();
        }
        return;
      }

      if (STATE.isFloorPickerOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          toggleFloorPicker(false);
          return;
        }
      }

      const activeEl = win.document.activeElement;
      const isInputActive = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);

      if (isInputActive) {
        if (e.key === 'Escape') {
          activeEl.blur();
        }
        return;
      }

      // 页内模式作用域保护：若摸鱼条未显示，或者鼠标/焦点并未位于摸鱼条内部，绝不拦截单键导航快捷键 (j, k, 方向键, Enter 等)
      if (STATE.isHostInpage) {
        const inpage = STATE.inpageContainer || win.document.getElementById('st-thief-inpage-container');
        if (!inpage || inpage.style.display === 'none') return;

        const isHovered = inpage.matches(':hover') || inpage.classList.contains('tb-mouse-over');
        const isFocusedInside = inpage.contains(activeEl);

        // 未与摸鱼条交互时，放行所有单键快捷键，避免破坏酒馆正常操作
        if (!isHovered && !isFocusedInside) {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeThiefBar();
          }
          return;
        }
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          if (STATE.isHostInpage) {
            closeThiefBar();
          } else {
            toggleBossKey();
          }
          break;
        case 'ArrowRight':
        case 'k':
        case 'K':
          e.preventDefault();
          nextSentence();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault();
          prevSentence();
          break;
        case 'Enter':
          e.preventDefault();
          win.document.getElementById('tb-input')?.focus();
          break;
        case 'PageDown':
          e.preventDefault();
          changeMessageFloor(1);
          break;
        case 'PageUp':
          e.preventDefault();
          changeMessageFloor(-1);
          break;
      }

      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        swipeMessage();
      }
      if (e.altKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        stopGeneration();
      }
    });

    // 2. 鼠标滚轮翻句：严格限制作用域，杜绝劫持酒馆页面/聊天历史/弹窗列表等任何滚动组件
    const onWheelHandler = e => {
      if (STATE.isSettingsOpen) return;
      const activeEl = win.document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;

      // 仅在明确滚轮发生在摸鱼条上方时翻句
      e.preventDefault();
      if (e.deltaY > 0) {
        nextSentence();
      } else if (e.deltaY < 0) {
        prevSentence();
      }
    };

    // 如果是页内模式，滚轮事件监听器严格只绑定到摸鱼条容器元素上；绝不挂载到 window.document，确保酒馆主界面任何组件滚动零干扰
    if (STATE.isHostInpage) {
      const inpage = STATE.inpageContainer || win.document.getElementById('st-thief-inpage-container');
      if (inpage && !inpage._tbWheelBound) {
        inpage._tbWheelBound = true;
        inpage.addEventListener('wheel', onWheelHandler, { passive: false });
      }
    } else {
      win.document.addEventListener('wheel', onWheelHandler, { passive: false });
    }

    // 3. 点击菜单外部关闭右键上下文菜单
    win.document.addEventListener('click', e => {
      if (STATE.isContextMenuOpen) {
        const menu = win.document.getElementById('tb-context-menu');
        const trigger = win.document.getElementById('btn-context-menu');
        if (menu && !menu.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
          closeContextMenu();
        }
      }
    });

    // 4. 右键呼出摸鱼条专属上下文菜单：仅在摸鱼条范围内生效，坚决不劫持酒馆全局右键菜单
    const onContextMenuHandler = e => {
      if (STATE.isSettingsOpen || STATE.isFloorPickerOpen) return;
      const target = e.target;
      // 输入框内右键保留系统原生编辑菜单 (复制/粘贴/剪切)
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY);
    };

    // 页内模式下右键事件严格只绑定至摸鱼条容器，绝不拦截酒馆聊天内容或其他区域的原生右键操作
    if (STATE.isHostInpage) {
      const inpage = STATE.inpageContainer || win.document.getElementById('st-thief-inpage-container');
      if (inpage && !inpage._tbContextMenuBound) {
        inpage._tbContextMenuBound = true;
        inpage.addEventListener('contextmenu', onContextMenuHandler);
      }
    } else {
      win.document.addEventListener('contextmenu', onContextMenuHandler);
    }

    // 5. 隐私模式鼠标悬停与移开显隐联动
    let mouseLeaveTimer = null;
    const updateHoverState = isHovering => {
      if (mouseLeaveTimer) {
        clearTimeout(mouseLeaveTimer);
        mouseLeaveTimer = null;
      }
      const targetEl = STATE.isHostInpage ? STATE.inpageContainer : win.document.body;
      if (!targetEl) return;
      if (isHovering) {
        targetEl.classList.add('tb-mouse-over');
      } else {
        mouseLeaveTimer = setTimeout(() => {
          const isInteracting = STATE.isContextMenuOpen || STATE.isSettingsOpen || STATE.isFloorPickerOpen || (win.document.activeElement && win.document.activeElement.tagName === 'INPUT');
          if (!isInteracting) {
            targetEl.classList.remove('tb-mouse-over');
          }
        }, 120);
      }
    };

    if (STATE.isHostInpage && STATE.inpageContainer) {
      STATE.inpageContainer.addEventListener('mouseenter', () => updateHoverState(true));
      STATE.inpageContainer.addEventListener('mouseleave', () => updateHoverState(false));
      STATE.inpageContainer.addEventListener('mousemove', () => updateHoverState(true));
    } else {
      win.document.addEventListener('mouseenter', () => updateHoverState(true));
      win.document.addEventListener('mouseleave', () => updateHoverState(false));
      win.document.addEventListener('mousemove', () => updateHoverState(true));
      if (win.document.body) {
        win.document.body.addEventListener('mouseenter', () => updateHoverState(true));
        win.document.body.addEventListener('mouseleave', () => updateHoverState(false));
        win.document.body.addEventListener('mousemove', () => updateHoverState(true));
      }
    }

    if (typeof win.addEventListener === 'function') {
      win.addEventListener('blur', () => {
        if (CONFIG.privacyMode) {
          const isInteracting = STATE.isContextMenuOpen || STATE.isSettingsOpen || STATE.isFloorPickerOpen || (win.document.activeElement && win.document.activeElement.tagName === 'INPUT');
          if (!isInteracting) {
            updateHoverState(false);
          }
        }
      });
    }
  }

  // ------------------------------------------------------------------------------------
  // 酒馆网页常驻悬浮入口注入 (完美跟随页面变化与移动端触控)
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

  function clampFloatingButton(btn) {
    if (!btn) return;
    try {
      const topDoc = getSafeTopDoc();
      const topWin = getSafeTopWin();
      const vp = topWin.visualViewport;
      const winW = (vp ? vp.width : topWin.innerWidth) || topDoc.documentElement.clientWidth || 360;
      const winH = (vp ? vp.height : topWin.innerHeight) || topDoc.documentElement.clientHeight || 640;
      const rect = btn.getBoundingClientRect();
      const btnW = rect.width || btn.offsetWidth || 38;
      const btnH = rect.height || btn.offsetHeight || 38;
      const margin = 6;

      // 如果按钮被拖拽过（设置了具体的 left/top），确保其绝不会超出当前视口
      if (btn.style.left && btn.style.left !== 'auto') {
        let curLeft = parseFloat(btn.style.left) || 0;
        let curTop = parseFloat(btn.style.top) || 0;
        let safeLeft = Math.max(margin, Math.min(curLeft, winW - btnW - margin));
        let safeTop = Math.max(margin, Math.min(curTop, winH - btnH - margin));
        btn.style.left = `${safeLeft}px`;
        btn.style.top = `${safeTop}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
      } else {
        // 默认贴在右下角安全区
        btn.style.right = 'max(15px, env(safe-area-inset-right, 15px))';
        btn.style.bottom = 'max(80px, calc(80px + env(safe-area-inset-bottom, 0px)))';
      }
    } catch (e) {}
  }

  function injectSillyTavernEntrance() {
    try {
      const topDoc = getSafeTopDoc();
      if (!topDoc || topDoc.getElementById('st-thief-floating-btn')) return;

      const btn = topDoc.createElement('div');
      btn.id = 'st-thief-floating-btn';
      btn.innerHTML = `🐟`;
      btn.title = '🐟 Thief摸鱼条\n[左键点击]：展开 / 收起摸鱼条 (Alt+M)\n[右键点击]：直接打开设置面板\n[按住拖拽]：高效移动位置 (双击复位)';
      btn.style.cssText = `
        position: fixed;
        bottom: max(80px, calc(80px + env(safe-area-inset-bottom, 0px)));
        right: max(15px, env(safe-area-inset-right, 15px));
        z-index: 999999;
        width: 38px;
        height: 38px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #252830 0%, #17181c 100%);
        color: #4ec9b0;
        border: 1.5px solid rgba(78, 201, 176, 0.45);
        border-radius: 50%;
        font-size: 19px;
        line-height: 1;
        cursor: grab;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.65), 0 0 10px rgba(78, 201, 176, 0.2);
        user-select: none;
        -webkit-user-select: none;
        opacity: 0.92;
        transition: transform 0.15s ease, opacity 0.2s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        touch-action: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Consolas, sans-serif;
      `;

      // 还原拖拽记忆位置
      try {
        const savedPos = JSON.parse(localStorage.getItem('ST_THIEF_PILL_POS') || 'null');
        if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
          btn.style.left = `${savedPos.left}px`;
          btn.style.top = `${savedPos.top}px`;
          btn.style.right = 'auto';
          btn.style.bottom = 'auto';
        }
      } catch (err) {}

      btn.addEventListener('mouseenter', () => {
        if (!isDragging) {
          btn.style.opacity = '1';
          btn.style.borderColor = '#4ec9b0';
          btn.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.8), 0 0 14px rgba(78, 201, 176, 0.4)';
          btn.style.transform = 'scale(1.12)';
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (!isDragging) {
          btn.style.opacity = '0.92';
          btn.style.borderColor = 'rgba(78, 201, 176, 0.45)';
          btn.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.65), 0 0 10px rgba(78, 201, 176, 0.2)';
          btn.style.transform = 'scale(1)';
        }
      });

      function resetBtnPosition() {
        btn.style.left = 'auto';
        btn.style.top = 'auto';
        btn.style.right = 'max(15px, env(safe-area-inset-right, 15px))';
        btn.style.bottom = 'max(80px, calc(80px + env(safe-area-inset-bottom, 0px)))';
        try {
          localStorage.removeItem('ST_THIEF_PILL_POS');
        } catch (err) {}
        flashStatusHint('悬浮入口已复位至右下角安全区');
      }

      // 现代高性能 Pointer Events 交互模型 (GPU 加速、requestAnimationFrame 节流防掉帧)
      let activePointerId = null;
      let startX = 0, startY = 0;
      let origLeft = 0, origTop = 0;
      let isDragging = false;
      let hasTriggeredLongPress = false;
      let longPressTimer = null;
      let lastTapTime = 0;
      let rafPending = false;
      let nextTargetX = 0, nextTargetY = 0;
      let cachedWinW = 360, cachedWinH = 640;
      let cachedBtnW = 38, cachedBtnH = 38;

      function applyPosition() {
        btn.style.left = `${nextTargetX}px`;
        btn.style.top = `${nextTargetY}px`;
        rafPending = false;
      }

      btn.addEventListener('pointerdown', e => {
        // 仅处理鼠标左键 (0) 或触屏/手写笔
        if (e.button !== 0) return;

        activePointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        isDragging = false;
        hasTriggeredLongPress = false;

        const rect = btn.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;

        // 一次性预缓存窗口与按钮几何尺寸，彻底杜绝 pointermove 过程中的 DOM layout thrashing 回流
        const topWin = getSafeTopWin();
        const topDoc = getSafeTopDoc();
        const vp = topWin.visualViewport;
        cachedWinW = (vp ? vp.width : topWin.innerWidth) || topDoc.documentElement.clientWidth || 360;
        cachedWinH = (vp ? vp.height : topWin.innerHeight) || topDoc.documentElement.clientHeight || 640;
        cachedBtnW = rect.width || 38;
        cachedBtnH = rect.height || 38;

        try {
          btn.setPointerCapture(e.pointerId);
        } catch (err) {}

        btn.style.willChange = 'left, top, transform';

        // 移动端长按检测 (480ms)：触屏长按可直接唤起设置面板
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          if (!isDragging && activePointerId === e.pointerId) {
            hasTriggeredLongPress = true;
            if (activePointerId !== null) {
              try { btn.releasePointerCapture(activePointerId); } catch (err) {}
              activePointerId = null;
            }
            openSettingsModal();
          }
        }, 480);

        // 阻止原生文字选中与 HTML 拖拽，防止事件被浏览器抢占中断
        e.preventDefault();
      });

      btn.addEventListener('pointermove', e => {
        if (activePointerId !== e.pointerId) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const dist = Math.hypot(dx, dy);

        // 4px 响应阈值：既能过滤人类手指极微小颤动，又能实现一触即发的高性能即时拖拽反馈
        if (!isDragging && dist > 4) {
          isDragging = true;
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
          btn.style.transition = 'none';
          btn.style.cursor = 'grabbing';
          btn.style.transform = 'scale(1.1)';
          btn.style.right = 'auto';
          btn.style.bottom = 'auto';
        }

        if (isDragging) {
          const margin = 4;
          let targetX = origLeft + dx;
          let targetY = origTop + dy;

          targetX = Math.max(margin, Math.min(targetX, cachedWinW - cachedBtnW - margin));
          targetY = Math.max(margin, Math.min(targetY, cachedWinH - cachedBtnH - margin));

          nextTargetX = targetX;
          nextTargetY = targetY;

          if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(applyPosition);
          }
        }
      });

      function onPointerEnd(e, isCancel) {
        if (activePointerId !== e.pointerId) return;

        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }

        try {
          btn.releasePointerCapture(e.pointerId);
        } catch (err) {}
        activePointerId = null;

        btn.style.willChange = 'auto';
        btn.style.cursor = 'grab';
        btn.style.transition = 'transform 0.15s ease, opacity 0.2s ease, border-color 0.15s ease, box-shadow 0.15s ease';
        btn.style.transform = 'scale(1)';

        if (hasTriggeredLongPress) {
          hasTriggeredLongPress = false;
          isDragging = false;
          return;
        }

        if (isDragging && !isCancel) {
          if (rafPending) {
            applyPosition();
          }
          clampFloatingButton(btn);
          try {
            const curLeft = parseFloat(btn.style.left) || 0;
            const curTop = parseFloat(btn.style.top) || 0;
            localStorage.setItem('ST_THIEF_PILL_POS', JSON.stringify({ left: curLeft, top: curTop }));
          } catch (err) {}
          isDragging = false;
          return;
        }

        const wasDragging = isDragging;
        isDragging = false;

        if (isCancel || wasDragging) return;

        // 双击/双触快速复位 (350ms 内连续两次点击)
        const now = Date.now();
        if (now - lastTapTime < 350) {
          lastTapTime = 0;
          resetBtnPosition();
          return;
        }
        lastTapTime = now;

        // 左键干净点击 / 触屏轻触：开启或收起摸鱼条
        toggleThiefBar();
      }

      btn.addEventListener('pointerup', e => onPointerEnd(e, false));
      btn.addEventListener('pointercancel', e => onPointerEnd(e, true));

      // 右键悬浮窗直接打开设置
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        openSettingsModal();
      });

      // 阻止原生合成点击事件二次触发干扰
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
      });

      // 双击鼠标一键复位
      btn.addEventListener('dblclick', e => {
        e.stopPropagation();
        resetBtnPosition();
      });

      topDoc.body.appendChild(btn);
      clampFloatingButton(btn);

      // 监听屏幕尺寸、旋转与视口缩放变化，确保悬浮窗始终紧紧跟随页面变化
      const topWin = getSafeTopWin();
      const onViewportChange = () => {
        clampFloatingButton(btn);
        if (STATE.isHostInpage) {
          updateInpageFloatingPosition();
          refreshLatestMessage(false);
        }
      };
      topWin.addEventListener('resize', onViewportChange);
      topWin.addEventListener('orientationchange', onViewportChange);
      if (topWin.visualViewport) {
        topWin.visualViewport.addEventListener('resize', onViewportChange);
        topWin.visualViewport.addEventListener('scroll', onViewportChange);
      }

      console.log('[ST-Thief-Book] 成功在酒馆主界面注入“🐟”精简图标入口 (右键直接设置 / 移动超高效)');
    } catch (e) {
      console.warn('[ST-Thief-Book] 注入悬浮入口异常:', e);
    }
  }

  function setupHostGlobalShortcuts() {
    try {
      const topDoc = getSafeTopDoc();
      if (topDoc._tbHostShortcutsBound) return;
      topDoc._tbHostShortcutsBound = true;

      topDoc.addEventListener('keydown', e => {
        if (e.altKey && (e.key === 'm' || e.key === 'M')) {
          e.preventDefault();
          toggleThiefBar();
          return;
        }
        if (e.key === 'Escape') {
          const activeEl = topDoc.activeElement;
          const isInputActive = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
          if (isInputActive) return;

          if (STATE.isSettingsOpen) {
            e.preventDefault();
            closeSettingsModal();
            return;
          }
          if (STATE.isContextMenuOpen) {
            e.preventDefault();
            closeContextMenu();
            return;
          }
          if (STATE.isFloorPickerOpen) {
            e.preventDefault();
            toggleFloorPicker(false);
            return;
          }
          if (STATE.isHostInpage && STATE.inpageContainer && STATE.inpageContainer.style.display !== 'none') {
            closeThiefBar();
          } else if (STATE.thiefWindow && !STATE.thiefWindow.closed && !STATE.isHostInpage) {
            toggleBossKey();
          }
        }
      });

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
  // 画中画（Document Picture-in-Picture）、独立弹窗与页内原生悬浮条支持
  // ------------------------------------------------------------------------------------
  function setupInpageDraggable(inpage) {
    if (!inpage || inpage.dataset.dragInit === 'true') return;
    inpage.dataset.dragInit = 'true';

    // 还原历史记录的垂直高度位置
    try {
      const savedBottom = localStorage.getItem('ST_THIEF_INPAGE_BOTTOM');
      if (savedBottom !== null && !isNaN(parseFloat(savedBottom))) {
        inpage.style.bottom = `${Math.max(0, parseFloat(savedBottom))}px`;
      }
    } catch (e) {}

    let isDragging = false;
    let startY = 0;
    let origBottom = 0;
    let dragPointerId = null;
    let lastHandleTap = 0;

    function onPointerDown(e) {
      const target = e.target;
      const isHandle = target && (target.id === 'tb-drag-handle' || target.classList?.contains('tb-drag-handle'));
      const isReadingRow = target && target.classList?.contains('tb-row-reading');
      const isSectionLeft = target && target.classList?.contains('tb-section-left');
      if (!isHandle && !isReadingRow && !isSectionLeft) return;

      if (e.button !== 0) return;
      dragPointerId = e.pointerId;
      try {
        target.setPointerCapture(e.pointerId);
      } catch (err) {}

      isDragging = false;
      startY = e.clientY;
      origBottom = parseFloat(inpage.style.bottom) || 0;
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (dragPointerId !== e.pointerId) return;
      const dy = startY - e.clientY; // 向上拖动 clientY 变小，dy 为正，bottom 应增大
      if (!isDragging && Math.abs(dy) > 5) {
        isDragging = true;
        inpage.style.transition = 'none';
      }

      if (isDragging) {
        const topWin = getSafeTopWin();
        const maxBottom = Math.max(0, (topWin.innerHeight || 600) - 50);
        const newBottom = Math.max(0, Math.min(origBottom + dy, maxBottom));
        inpage.style.bottom = `${newBottom}px`;
      }
    }

    function onPointerUp(e) {
      if (dragPointerId !== e.pointerId) return;
      const target = e.target;
      try {
        target.releasePointerCapture(e.pointerId);
      } catch (err) {}
      dragPointerId = null;
      inpage.style.transition = 'bottom 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.15s ease';

      if (isDragging) {
        isDragging = false;
        try {
          const curBottom = parseFloat(inpage.style.bottom) || 0;
          localStorage.setItem('ST_THIEF_INPAGE_BOTTOM', curBottom.toString());
        } catch (err) {}
        return;
      }

      isDragging = false;
      // 双击/双触拖拽手柄 ⠿ 一键贴底复位
      const isHandle = target && (target.id === 'tb-drag-handle' || target.classList?.contains('tb-drag-handle'));
      if (isHandle) {
        const now = Date.now();
        if (now - lastHandleTap < 350) {
          lastHandleTap = 0;
          inpage.style.bottom = 'max(0px, env(safe-area-inset-bottom, 0px))';
          try {
            localStorage.removeItem('ST_THIEF_INPAGE_BOTTOM');
          } catch (err) {}
          flashStatusHint('摸鱼条已贴底复位');
          return;
        }
        lastHandleTap = now;
      }
    }

    inpage.addEventListener('pointerdown', onPointerDown);
    inpage.addEventListener('pointermove', onPointerMove);
    inpage.addEventListener('pointerup', onPointerUp);
    inpage.addEventListener('pointercancel', onPointerUp);
  }

  function updateInpageFloatingPosition() {
    if (!STATE.isHostInpage || !STATE.inpageContainer) return;
    try {
      const topWin = getSafeTopWin();
      const vp = topWin.visualViewport;
      if (vp) {
        // 手机端软键盘弹起时，自适应升至软键盘上方，不遮挡不丢失
        const keyboardHeight = Math.max(0, topWin.innerHeight - (vp.offsetTop + vp.height));
        const savedBottom = parseFloat(localStorage.getItem('ST_THIEF_INPAGE_BOTTOM') || '0') || 0;
        const totalBottom = savedBottom + keyboardHeight;
        STATE.inpageContainer.style.bottom = `${totalBottom}px`;
      }
    } catch (e) {}
  }

  function openInpageThiefBar() {
    const topDoc = getSafeTopDoc();
    let inpage = topDoc.getElementById('st-thief-inpage-container');
    if (!inpage) {
      inpage = topDoc.createElement('div');
      inpage.id = 'st-thief-inpage-container';
      topDoc.body.appendChild(inpage);
    }

    inpage.style.display = 'block';
    STATE.isHostInpage = true;
    STATE.inpageContainer = inpage;

    // 虚拟 window 适配器，衔接 renderThiefBar
    STATE.thiefWindow = {
      document: topDoc,
      closed: false,
      isHostInpage: true,
      focus: () => {
        if (STATE.inpageContainer) STATE.inpageContainer.style.display = 'block';
      },
      close: () => {
        closeThiefBar();
      },
      resizeTo: () => {}
    };

    setupInpageDraggable(inpage);
    updateInpageFloatingPosition();
    renderThiefBar();

    // 唤起时保持临时可见高亮，防止隐私模式下立即变为完全透明看不到
    if (inpage) {
      inpage.classList.add('tb-privacy-active');
      setTimeout(() => {
        const isInteracting = STATE.isContextMenuOpen || STATE.isSettingsOpen || STATE.isFloorPickerOpen || (topDoc.activeElement && topDoc.activeElement.tagName === 'INPUT');
        if (!isInteracting && STATE.inpageContainer) {
          STATE.inpageContainer.classList.remove('tb-privacy-active');
        }
      }, 3500);
    }

    flashStatusHint('摸鱼状态栏已展开 (轻触文字阅读，可拖拽调节高度)');
  }

  async function openThiefBar() {
    if (STATE.isHostInpage && STATE.inpageContainer && STATE.inpageContainer.style.display !== 'none') {
      return;
    }
    if (STATE.thiefWindow && !STATE.thiefWindow.closed && !STATE.isHostInpage) {
      try { STATE.thiefWindow.focus(); } catch (e) {}
      return;
    }

    refreshLatestMessage(false);

    // 1. 移动端/小屏环境检测：优先使用页内原生悬浮条，彻底解决手机端看不见与弹窗被拦问题
    if (isMobileDevice()) {
      openInpageThiefBar();
      return;
    }

    const baseH = CONFIG.minimalMode
      ? (CONFIG.layoutMode === 'double' ? 56 : 30)
      : (CONFIG.layoutMode === 'double' ? CONFIG.doubleHeight : CONFIG.singleHeight);
    const winHeight = baseH;

    // 2. 桌面端优先支持画中画 (Picture-in-Picture)
    if ('documentPictureInPicture' in window) {
      try {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width: CONFIG.barWidth,
          height: winHeight
        });

        STATE.isHostInpage = false;
        STATE.thiefWindow = pipWin;
        pipWin.addEventListener('unload', () => {
          STATE.thiefWindow = null;
        });
        pipWin.addEventListener('pagehide', () => {
          STATE.thiefWindow = null;
        });
        pipWin.addEventListener('resize', () => {
          if (pipWin.innerWidth && pipWin.innerWidth >= 360) {
            CONFIG.barWidth = pipWin.innerWidth;
            saveCurrentConfig();
            syncToDesktop();
          }
        });

        renderThiefBar();
        return;
      } catch (err) {
        console.warn('[ST-Thief-Book] Document Picture-in-Picture 启动失败，降级使用页内原生悬浮条:', err);
      }
    }

    // 3. 终极自适应保底：若不支持画中画或启动失败，直接开启页内原生悬浮窗 (稳定可靠，绝不被弹窗拦截器阻拦)
    openInpageThiefBar();
  }

  function toggleThiefBar() {
    if (STATE.isHostInpage && STATE.inpageContainer && STATE.inpageContainer.style.display !== 'none') {
      closeThiefBar();
    } else if (STATE.thiefWindow && !STATE.thiefWindow.closed && !STATE.isHostInpage) {
      closeThiefBar();
    } else {
      openThiefBar();
    }
  }

  function closeThiefBar() {
    if (STATE.isHostInpage && STATE.inpageContainer) {
      STATE.inpageContainer.style.display = 'none';
      STATE.isHostInpage = false;
      STATE.thiefWindow = null;
    } else if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      try {
        STATE.thiefWindow.close();
      } catch (e) {}
      STATE.thiefWindow = null;
    }
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
  }

  function toggleDesktopSync(forcedState) {
    STATE.isContextMenuOpen = false;
    const target = typeof forcedState === 'boolean' ? forcedState : !CONFIG.enableDesktopSync;
    CONFIG.enableDesktopSync = target;
    saveCurrentConfig();

    if (CONFIG.enableDesktopSync) {
      flashStatusHint('🖥️ 已手动开启桌面同步，正在连接 127.0.0.1:18899...');
      initDesktopBridge(true);
    } else {
      stopDesktopBridge();
      flashStatusHint('⚪ 已关闭桌面同步 (纯网页模式)');
    }
    renderThiefBar();
  }

  function initDesktopBridge(isManual = false) {
    // 关键守卫：如果未手动开启桌面端同步，绝不发起任何 WebSocket 连接与重连！
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
        console.log('[ST-Thief-Book] 成功连接到 Python 桌面摸鱼客户端');
        flashStatusHint('🟢 成功连接到 Python 桌面摸鱼客户端');
        renderThiefBar();
        syncToDesktop();
      };

      ws.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          if (data.action === 'next') nextSentence();
          else if (data.action === 'prev') prevSentence();
          else if (data.action === 'boss') toggleBossKey();
          else if (data.action === 'swipe') swipeMessage();
          else if (data.action === 'stop') stopGeneration();
          else if (data.action === 'reply') submitReply(data.text);
          else if (data.action === 'open_settings') openSettingsModal();
          else if (data.action === 'jump_floor') jumpToMessageFloor(data.floor);
          else if (data.action === 'change_floor') changeMessageFloor(data.delta || 1);
          else if (data.action === 'toggle_user_messages') toggleShowUserMessages();
          else if (data.action === 'toggle_char_mode') toggleCharNameMode();
          else if (data.action === 'toggle_wrap_mode') toggleWrapMode();
          else if (data.action === 'toggle_minimal_mode') toggleMinimalMode(data.minimalMode);
          else if (data.action === 'toggle_layout_mode') toggleLayoutMode();
          else if (data.action === 'set_window_width' && typeof data.barWidth === 'number') {
            CONFIG.barWidth = data.barWidth;
            saveCurrentConfig();
            if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
              try {
                STATE.thiefWindow.resizeTo(CONFIG.barWidth, STATE.thiefWindow.outerHeight || 74);
              } catch (e) {}
            }
          }
          else if (data.action === 'update_config' && data.config) {
            if (typeof data.config.showUserMessages === 'boolean') CONFIG.showUserMessages = data.config.showUserMessages;
            if (typeof data.config.enableWhitelist === 'boolean') CONFIG.enableWhitelist = data.config.enableWhitelist;
            if (Array.isArray(data.config.tagWhitelist)) CONFIG.tagWhitelist = data.config.tagWhitelist;
            if (Array.isArray(data.config.tagBlacklist)) CONFIG.tagBlacklist = data.config.tagBlacklist;
            if (typeof data.config.filterActions === 'boolean') CONFIG.filterActions = data.config.filterActions;
            if (data.config.filterMode) CONFIG.filterMode = data.config.filterMode;
            if (data.config.charNameMode) CONFIG.charNameMode = data.config.charNameMode;
            if (data.config.wrapMode) CONFIG.wrapMode = data.config.wrapMode;
            if (typeof data.config.minimalMode === 'boolean') CONFIG.minimalMode = data.config.minimalMode;
            if (typeof data.config.privacyMode === 'boolean') CONFIG.privacyMode = data.config.privacyMode;
            if (data.config.layoutMode) CONFIG.layoutMode = data.config.layoutMode;
            if (typeof data.config.opacity === 'number') CONFIG.opacity = data.config.opacity;
            if (typeof data.config.barWidth === 'number') CONFIG.barWidth = data.config.barWidth;
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
        renderThiefBar();

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
        if (isManual) {
          flashStatusHint('⚠️ 桌面端未开启，请先运行 start_desktop.bat');
        }
      };
    } catch (e) {
      STATE.wsClient = null;
      STATE.wsConnecting = false;
    }
  }

  function syncToDesktop() {
    if (!CONFIG.enableDesktopSync || !STATE.wsClient || STATE.wsClient.readyState !== WebSocket.OPEN) return;

    try {
      const payload = {
        type: 'sync',
        charName: STATE.characterName,
        userName: STATE.userName,
        floor: STATE.currentMsgId,
        curIdx: STATE.currentSentenceIndex + 1,
        totalSentences: STATE.sentences.length,
        currentSentence: STATE.sentences[STATE.currentSentenceIndex] || '',
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
    if (typeof replaceScriptButtons === 'function') {
      try {
        replaceScriptButtons([
          { name: '📖 Thief摸鱼条', visible: true },
          { name: '🕶️ 老板键', visible: true }
        ]);

        if (typeof getButtonEvent === 'function') {
          eventOn(getButtonEvent('📖 Thief摸鱼条'), () => toggleThiefBar());
          eventOn(getButtonEvent('🕶️ 老板键'), () => toggleBossKey());
        }
      } catch (e) {}
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
        renderThiefBar();
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
        eventOn(tavern_events.STREAM_TOKEN_RECEIVED, () => {
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
                renderThiefBar();
                syncToDesktop();
              }
            }
          } catch (e) {}
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
    injectSillyTavernEntrance();
    setInterval(injectSillyTavernEntrance, 3000);
    setupHostGlobalShortcuts();
    initDesktopBridge();
    refreshLatestMessage(false);
    console.log('[ST-Thief-Book] 初始化完成！已在主界面右下角注入悬浮按钮。');
  }

  setTimeout(init, 500);

  window.STThiefBook = {
    open: openThiefBar,
    toggle: toggleThiefBar,
    boss: toggleBossKey,
    next: nextSentence,
    prev: prevSentence,
    reply: submitReply,
    swipe: swipeMessage,
    stop: stopGeneration,
    toggleLayout: toggleLayoutMode,
    toggleFilter: toggleFilterMode,
    toggleFloorPicker: toggleFloorPicker,
    jumpFloor: jumpToMessageFloor,
    toggleUserMessages: toggleShowUserMessages,
    toggleCharMode: toggleCharNameMode,
    toggleWrap: toggleWrapMode,
    toggleMinimal: toggleMinimalMode,
    togglePrivacy: togglePrivacyMode,
    openMenu: openContextMenu,
    closeMenu: closeContextMenu,
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
