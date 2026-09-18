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
    'bbi_image', 'fox_hugou', 'fox_selc', 'fox_tip', 'so_seq', 'details'
  ];

  // 默认白名单容器标签预设 (用于提取包裹在特定标签内的正文，如 <content>、<output>、<response>、<dialogue>)
  const DEFAULT_TAG_WHITELIST = [
    'content', 'output', 'response', 'dialogue', 'story', 'reply', 'text', 'narration', 'message', '正文'
  ];

  // ------------------------------------------------------------------------------------
  // 配置与状态管理
  // ------------------------------------------------------------------------------------
  const CONFIG = {
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
    wsClient: null
  };

  // 读取持久化配置
  function loadSavedConfig() {
    try {
      const raw = localStorage.getItem('ST_THIEF_CONFIG_V3') || localStorage.getItem('ST_THIEF_CONFIG_V2');
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved.showUserMessages === 'boolean') {
          CONFIG.showUserMessages = saved.showUserMessages;
        }
        if (Array.isArray(saved.tagBlacklist)) {
          const cleanedBlacklist = saved.tagBlacklist
            .map(t => String(t).trim().replace(/^[<\[]+|[>\]]+$/g, ''))
            .filter(Boolean);
          CONFIG.tagBlacklist = cleanedBlacklist.length > 0 ? cleanedBlacklist : [...DEFAULT_TAG_BLACKLIST];
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
        doc.querySelectorAll('.mes_reasoning, .reasoning_block, .thinking, .thinking-block, details').forEach(el => el.remove());
        doc.querySelectorAll('.avatar, .avatar-container, .mes_button_menu, .badge, .extra-badges').forEach(el => el.remove());

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

      // 冒号或指令型单标签 (常见于用户输入 [system: ...] 或 [system：...] 或 <system: ...>)
      text = text.replace(new RegExp('\\[\\s*' + escaped + '\\s*[:：][^\\]]*\\]', 'gi'), '');
      text = text.replace(new RegExp('<\\s*' + escaped + '\\s*[:：][^>]*>', 'gi'), '');

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
            const rendered = $clone.html();
            if (rendered && rendered.trim()) {
              result = cleanHtmlAndStyles(processWhitelistAndBlacklist(rendered));
            }
          }
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

    // 根据当前窗口宽度动态评估单行最大字数容纳量 (约每字15px)
    const lineCapChars = Math.max(18, Math.min(60, Math.floor(((CONFIG.barWidth || 840) - 180) / 16)));

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
      STATE.cachedMessage = latest;
      STATE.currentMsgId = targetId;

      STATE.characterName = latest.name || (typeof SillyTavern !== 'undefined' ? SillyTavern.name2 : 'AI');
      STATE.userName = typeof SillyTavern !== 'undefined' ? SillyTavern.name1 : 'User';

      let rawText = latest.message || '';
      if (latest.swipes && latest.swipes.length > 0 && typeof latest.swipe_id === 'number') {
        rawText = latest.swipes[latest.swipe_id] || rawText;
      }

      const cleanText = filterThinkingAndTags(rawText, latest.message_id);
      const newSentences = splitIntoSentences(cleanText);
      STATE.sentences = newSentences;

      if (forceJumpToEnd) {
        STATE.currentSentenceIndex = Math.max(0, newSentences.length - 1);
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

      const cleanText = filterThinkingAndTags(rawText, msg.message_id);
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

      const cleanText = filterThinkingAndTags(rawText, msg.message_id);
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
    if (STATE.thiefWindow && !STATE.thiefWindow.closed && !STATE.isSettingsOpen) {
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
    if (STATE.thiefWindow && !STATE.thiefWindow.closed && !STATE.isSettingsOpen) {
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
      STATE.isGenerating = false;
      flashStatusHint('发送失败: ' + (err.message || '未知错误'));
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
      STATE.isGenerating = false;
      renderThiefBar();
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
    if (STATE.thiefWindow && !STATE.thiefWindow.closed && !STATE.isSettingsOpen) {
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

  function openSettingsModal() {
    STATE.isSettingsOpen = true;
    if (!STATE.thiefWindow || STATE.thiefWindow.closed) {
      openThiefBar();
      return;
    }
    try {
      STATE.thiefWindow.resizeTo(CONFIG.barWidth, 500);
    } catch (e) {}
    renderThiefBar();
  }

  function closeSettingsModal() {
    STATE.isSettingsOpen = false;
    if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      const baseH = CONFIG.minimalMode
        ? (CONFIG.layoutMode === 'double' ? 56 : 30)
        : (CONFIG.layoutMode === 'double' ? CONFIG.doubleHeight : CONFIG.singleHeight);
      const targetHeight = baseH + 35;
      try {
        STATE.thiefWindow.resizeTo(CONFIG.barWidth, targetHeight);
      } catch (e) {}
    }
    renderThiefBar();
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

    body.theme-vscode-dark {
      background-color: #181818;
      color: #cccccc;
      border-top: 1px solid #2d2d2d;
    }
    body.theme-vscode-blue {
      background-color: #007acc;
      color: #ffffff;
      border-top: 1px solid #0062a3;
    }
    body.theme-terminal {
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

    /* 设置模态弹窗 */
    #tb-settings-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.88);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      padding: 6px;
      animation: tbFadeIn 0.15s ease-out;
    }
    .tb-settings-card {
      background: #1e1e1e;
      color: #cccccc;
      border: 1px solid #3c3c3c;
      border-radius: 5px;
      width: 100%;
      height: 100%;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow-y: auto;
      font-size: 11px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.8);
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

    doc.body.className = `theme-${CONFIG.theme} ${CONFIG.hoverBlur ? 'tb-blur-mode' : ''} ${CONFIG.layoutMode === 'single' ? 'single-mode' : 'double-mode'} ${CONFIG.minimalMode ? 'minimal-mode' : ''}`;
    doc.body.style.opacity = CONFIG.opacity;

    let container = doc.getElementById('tb-container');
    if (!container) {
      container = doc.createElement('div');
      container.id = 'tb-container';
      doc.body.appendChild(container);
      bindWindowEvents(STATE.thiefWindow);
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
      ? `<span class="tb-spin-icon" title="AI 生成中...">⟳</span> <span style="color:#dcdcaa;font-size:11px;">Building...</span>`
      : `
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

    // 设置弹窗 HTML
    let settingsOverlayHtml = '';
    if (STATE.isSettingsOpen) {
      settingsOverlayHtml = `
        <div id="tb-settings-overlay">
          <div class="tb-settings-card">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:5px;">
              <span style="font-weight:600; color:#4ec9b0; font-size:12px;">⚙️ ST-Thief-Book 摸鱼过滤与白名单/黑名单设置</span>
              <span id="btn-close-settings" title="关闭设置" style="cursor:pointer; font-weight:bold; font-size:14px; padding:0 6px; color:#aaa;">✕</span>
            </div>

            <!-- 白名单提取容器设置 -->
            <div style="margin-top:6px; background:#1c1e22; padding:6px 8px; border-radius:4px; border:1px solid #2d3139;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label style="font-size:11px; color:#4ec9b0; font-weight:600; display:flex; align-items:center; gap:5px; cursor:pointer;">
                  <input type="checkbox" id="setting-enable-whitelist" ${CONFIG.enableWhitelist ? 'checked' : ''} />
                  <span>🎯 启用正文白名单容器提取 (推荐)</span>
                </label>
                <span id="btn-clear-whitelist" style="cursor:pointer; font-size:10px; color:#ce9178; text-decoration:underline;">清空白名单</span>
              </div>
              <textarea id="setting-whitelist" style="
                width:100%; height:38px; background:#141414; color:#d4d4d4;
                border:1px solid #3c3c3c; border-radius:3px; padding:4px 6px;
                font-family:Consolas, monospace; font-size:11px; resize:none; outline:none; line-height:1.4;
              ">${escapeHtml(CONFIG.tagWhitelist.join(', '))}</textarea>
              <div style="margin-top:3px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                <span style="font-size:10px; opacity:0.65;">白名单快选:</span>
                <span class="tb-wl-chip" data-tag="content">+content</span>
                <span class="tb-wl-chip" data-tag="output">+output</span>
                <span class="tb-wl-chip" data-tag="response">+response</span>
                <span class="tb-wl-chip" data-tag="dialogue">+dialogue</span>
                <span class="tb-wl-chip" data-tag="story">+story</span>
                <span class="tb-wl-chip" data-tag="reply">+reply</span>
                <span class="tb-wl-chip" data-tag="text">+text</span>
                <span class="tb-wl-chip" data-tag="正文">+正文</span>
              </div>
              <div style="font-size:10px; opacity:0.6; margin-top:2px;">
                💡 规则：若消息含有白名单标签，只提取其中正文；若未包含任何白名单标签，则安全降级读取全文。
              </div>
            </div>

            <!-- 黑名单彻底剥离设置 -->
            <div style="margin-top:6px; background:#1c1c1c; padding:6px 8px; border-radius:4px; border:1px solid #2d2d2d;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label style="font-size:11px; color:#f48771; font-weight:600;">
                  🚫 思考与元数据黑名单 (这些标签及内部内容将被彻底清除):
                </label>
                <span id="btn-clear-blacklist" style="cursor:pointer; font-size:10px; color:#ce9178; text-decoration:underline;">清空黑名单</span>
              </div>
              <textarea id="setting-blacklist" style="
                width:100%; height:40px; background:#141414; color:#d4d4d4;
                border:1px solid #3c3c3c; border-radius:3px; padding:4px 6px;
                font-family:Consolas, monospace; font-size:11px; resize:none; outline:none; line-height:1.4;
              ">${escapeHtml(CONFIG.tagBlacklist.join(', '))}</textarea>
              <div style="margin-top:3px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
                <span style="font-size:10px; opacity:0.65;">黑名单快选:</span>
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
              <div style="font-size:10px; opacity:0.6; margin-top:2px;">
                💡 规则：在正文中，彻底清除所有黑名单标签块；其他普通排版标签仅剥除尖括号保留纯文字。
              </div>
            </div>

            <!-- 阅读与展示参数 -->
            <div style="margin-top:6px; padding:4px 8px; border-top:1px solid #2d2d2d; display:flex; flex-direction:column; gap:5px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:11px; color:#9cdcfe; font-weight:600;">阅读模式:</span>
                <select id="setting-filtermode" style="background:#252526; color:#ccc; border:1px solid #3c3c3c; border-radius:3px; padding:2px 6px; font-size:11px; outline:none;">
                  <option value="pure" ${CONFIG.filterMode === 'pure' ? 'selected' : ''}>🧹 纯净小说模式 (强烈推荐：剔除CSS美化与多余标签，短小精炼)</option>
                  <option value="regex" ${CONFIG.filterMode === 'regex' ? 'selected' : ''}>🎨 酒馆正则清洗模式 (执行酒馆正则后再剥离黑名单)</option>
                </select>
              </div>

              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:11px; color:#9cdcfe; font-weight:600;">角色名显示:</span>
                <select id="setting-charmode" style="background:#252526; color:#ccc; border:1px solid #3c3c3c; border-radius:3px; padding:2px 6px; font-size:11px; outline:none;">
                  <option value="compact" ${CONFIG.charNameMode === 'compact' ? 'selected' : ''}>🏷️ 精简胶囊 (推荐：最宽68px，自动省略不占位)</option>
                  <option value="hidden" ${CONFIG.charNameMode === 'hidden' ? 'selected' : ''}>🙈 完全隐藏 (最大正文空间，最隐蔽)</option>
                  <option value="full" ${CONFIG.charNameMode === 'full' ? 'selected' : ''}>📜 完整展示 (显示全部名字)</option>
                </select>
              </div>

              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:11px; color:#9cdcfe; font-weight:600;">换行展示:</span>
                <select id="setting-wrapmode" style="background:#252526; color:#ccc; border:1px solid #3c3c3c; border-radius:3px; padding:2px 6px; font-size:11px; outline:none;">
                  <option value="wrap" ${CONFIG.wrapMode === 'wrap' ? 'selected' : ''}>↩️ 自动折行全显 (长句自动折行显示全部文字，绝不截断丢字)</option>
                  <option value="single" ${CONFIG.wrapMode === 'single' ? 'selected' : ''}>↔️ 强制单行模式 (超长截断)</option>
                </select>
              </div>

              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:11px; color:#9cdcfe; font-weight:600;">窗口宽度:</span>
                <input type="number" id="setting-barwidth" value="${CONFIG.barWidth}" min="360" max="2560" step="20" style="width:70px; background:#252526; color:#ccc; border:1px solid #3c3c3c; border-radius:3px; padding:2px 6px; font-size:11px; outline:none;" />
                <span style="font-size:10px; opacity:0.6;">px (支持直接拖拽弹窗边缘缩放长度)</span>
              </div>

              <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:11px;">
                <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                  <input type="checkbox" id="setting-minimal-mode" ${CONFIG.minimalMode ? 'checked' : ''} />
                  <span>✨ 极简模式 (纯文字+背景，完全符合参考图)</span>
                </label>
                <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                  <input type="checkbox" id="setting-show-user-messages" ${CONFIG.showUserMessages ? 'checked' : ''} />
                  <span>💬 显示用户消息 (默认关闭，仅阅读AI/小说回复)</span>
                </label>
                <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                  <input type="checkbox" id="setting-filter-actions" ${CONFIG.filterActions ? 'checked' : ''} />
                  <span>过滤动作描写 (*xxx*)</span>
                </label>
                <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                  <input type="checkbox" id="setting-hover-blur" ${CONFIG.hoverBlur ? 'checked' : ''} />
                  <span>防窥毛玻璃 (鼠标移开模糊)</span>
                </label>
              </div>
            </div>

            <!-- 底部保存按钮 -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; padding-top:6px; border-top:1px solid #2d2d2d;">
              <button id="btn-reset-settings" style="padding:4px 10px; background:#333; color:#ccc; border:none; border-radius:3px; cursor:pointer; font-size:11px;">恢复默认预设</button>
              <div style="display:flex; gap:8px;">
                <button id="btn-cancel-settings" style="padding:4px 12px; background:#2a2a2a; color:#aaa; border:1px solid #444; border-radius:3px; cursor:pointer; font-size:11px;">取消</button>
                <button id="btn-save-settings" style="padding:4px 16px; background:#0e639c; color:#fff; border:none; border-radius:3px; cursor:pointer; font-size:11px; font-weight:600;">💾 保存并立即生效</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 右键上下文菜单 HTML
    let contextMenuHtml = '';
    if (STATE.isContextMenuOpen) {
      const docW = doc.documentElement.clientWidth || 800;
      const docH = doc.documentElement.clientHeight || 200;
      const posX = Math.min(docW - 240, Math.max(10, STATE.contextMenuPos.x || (docW - 240)));
      const posY = Math.min(docH - 280, Math.max(5, STATE.contextMenuPos.y || 25));
      contextMenuHtml = `
        <div id="tb-context-menu" style="left:${posX}px; top:${posY}px;">
          <div class="tb-menu-item" id="menu-toggle-minimal">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">✨</span><span>极简模式: ${CONFIG.minimalMode ? '✓ 已开启' : '未开启'}</span></div>
            <span class="tb-menu-tag">点击切换</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-layout">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">↕</span><span>布局: ${CONFIG.layoutMode === 'double' ? '双行回复' : '单行极窄'}</span></div>
            <span class="tb-menu-tag">点击切换</span>
          </div>
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-prev">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">‹</span><span>上一句</span></div>
            <span class="tb-menu-shortcut">← / J</span>
          </div>
          <div class="tb-menu-item" id="menu-next">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">›</span><span>下一句</span></div>
            <span class="tb-menu-shortcut">→ / K</span>
          </div>
          <div class="tb-menu-item" id="menu-floor-prev">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">▲</span><span>上一楼</span></div>
            <span class="tb-menu-shortcut">PageUp</span>
          </div>
          <div class="tb-menu-item" id="menu-floor-next">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">▼</span><span>下一楼</span></div>
            <span class="tb-menu-shortcut">PageDown</span>
          </div>
          <div class="tb-menu-item" id="menu-floor-jump">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">📖</span><span>快速楼层跳转...</span></div>
          </div>
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-swipe">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">⟲</span><span>重新生成回复 (Swipe)</span></div>
            <span class="tb-menu-shortcut">Alt+S</span>
          </div>
          ${STATE.isGenerating ? `
          <div class="tb-menu-item" id="menu-stop" style="color:#f44747;">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">■</span><span>中止生成</span></div>
            <span class="tb-menu-shortcut">Alt+X</span>
          </div>
          ` : ''}
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-toggle-user-messages">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">💬</span><span>用户消息: ${CONFIG.showUserMessages ? '✓ 允许显示' : '已过滤隐藏'}</span></div>
            <span class="tb-menu-tag">点击切换</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-char">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">👤</span><span>角色名: ${CONFIG.charNameMode === 'compact' ? '精简胶囊' : (CONFIG.charNameMode === 'hidden' ? '完全隐藏' : '完整展示')}</span></div>
            <span class="tb-menu-tag">点击切换</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-wrap">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">↩️</span><span>换行: ${CONFIG.wrapMode === 'wrap' ? '自动折行全显' : '强制单行'}</span></div>
            <span class="tb-menu-tag">点击切换</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-width">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">📏</span><span>长度: ${CONFIG.barWidth}px</span></div>
            <span class="tb-menu-tag">点击切换</span>
          </div>
          <div class="tb-menu-item" id="menu-toggle-filter">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">🧹</span><span>模式: ${CONFIG.filterMode === 'pure' ? '纯净小说' : '酒馆正则'}</span></div>
            <span class="tb-menu-tag">点击切换</span>
          </div>
          <div class="tb-menu-separator"></div>
          <div class="tb-menu-item" id="menu-boss">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">🕶️</span><span>一键老板键</span></div>
            <span class="tb-menu-shortcut">Esc</span>
          </div>
          <div class="tb-menu-item" id="menu-settings">
            <div class="tb-menu-item-left"><span class="tb-menu-item-icon">⚙️</span><span>摸鱼过滤与黑白名单设置...</span></div>
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
      ${settingsOverlayHtml}
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

    // 右键上下文菜单项事件绑定
    if (STATE.isContextMenuOpen) {
      doc.getElementById('menu-toggle-minimal')?.addEventListener('click', () => { closeContextMenu(); toggleMinimalMode(); });
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
      doc.getElementById('menu-toggle-layout')?.addEventListener('click', () => { closeContextMenu(); toggleLayoutMode(); });
      doc.getElementById('menu-boss')?.addEventListener('click', () => { closeContextMenu(); toggleBossKey(true); });
      doc.getElementById('menu-settings')?.addEventListener('click', () => { closeContextMenu(); openSettingsModal(); });
    }

    const input = doc.getElementById('tb-input');
    const sendBtn = doc.getElementById('btn-send');

    if (input) {
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

    // 设置弹窗内事件绑定
    if (STATE.isSettingsOpen) {
      doc.getElementById('btn-close-settings')?.addEventListener('click', closeSettingsModal);
      doc.getElementById('btn-cancel-settings')?.addEventListener('click', closeSettingsModal);

      // 清空白名单输入框
      doc.getElementById('btn-clear-whitelist')?.addEventListener('click', () => {
        const area = doc.getElementById('setting-whitelist');
        if (area) {
          area.value = '';
          area.focus();
        }
      });

      // 清空黑名单输入框
      doc.getElementById('btn-clear-blacklist')?.addEventListener('click', () => {
        const area = doc.getElementById('setting-blacklist');
        if (area) {
          area.value = '';
          area.focus();
        }
      });

      // 白名单 chip 点击
      doc.querySelectorAll('.tb-wl-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const tag = chip.getAttribute('data-tag');
          const area = doc.getElementById('setting-whitelist');
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

      // 黑名单 chip 点击
      doc.querySelectorAll('.tb-bl-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const tag = chip.getAttribute('data-tag');
          const area = doc.getElementById('setting-blacklist');
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

      doc.getElementById('btn-reset-settings')?.addEventListener('click', () => {
        const wlArea = doc.getElementById('setting-whitelist');
        if (wlArea) wlArea.value = DEFAULT_TAG_WHITELIST.join(', ');
        const blArea = doc.getElementById('setting-blacklist');
        if (blArea) blArea.value = DEFAULT_TAG_BLACKLIST.join(', ');
        const wlEnable = doc.getElementById('setting-enable-whitelist');
        if (wlEnable) wlEnable.checked = true;
        const charMode = doc.getElementById('setting-charmode');
        if (charMode) charMode.value = 'compact';
        const wrapMode = doc.getElementById('setting-wrapmode');
        if (wrapMode) wrapMode.value = 'wrap';
        const minMode = doc.getElementById('setting-minimal-mode');
        if (minMode) minMode.checked = false;
        const userMsg = doc.getElementById('setting-show-user-messages');
        if (userMsg) userMsg.checked = false;
        const actions = doc.getElementById('setting-filter-actions');
        if (actions) actions.checked = false;
        const blur = doc.getElementById('setting-hover-blur');
        if (blur) blur.checked = false;
        const mode = doc.getElementById('setting-filtermode');
        if (mode) mode.value = 'pure';
        const barW = doc.getElementById('setting-barwidth');
        if (barW) barW.value = '840';
      });

      doc.getElementById('btn-save-settings')?.addEventListener('click', () => {
        const wlArea = doc.getElementById('setting-whitelist');
        const blArea = doc.getElementById('setting-blacklist');
        const wlEnable = doc.getElementById('setting-enable-whitelist');
        const charMode = doc.getElementById('setting-charmode');
        const wrapMode = doc.getElementById('setting-wrapmode');
        const minMode = doc.getElementById('setting-minimal-mode');
        const userMsg = doc.getElementById('setting-show-user-messages');
        const actions = doc.getElementById('setting-filter-actions');
        const blur = doc.getElementById('setting-hover-blur');
        const mode = doc.getElementById('setting-filtermode');
        const barW = doc.getElementById('setting-barwidth');

        if (wlEnable) CONFIG.enableWhitelist = wlEnable.checked;
        if (charMode) CONFIG.charNameMode = charMode.value;
        if (wrapMode) CONFIG.wrapMode = wrapMode.value;
        if (minMode) CONFIG.minimalMode = minMode.checked;
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

        saveCurrentConfig();
        closeSettingsModal();
        flashStatusHint('设置已保存！已应用最新配置');
        refreshLatestMessage(false);
        syncToDesktop();
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------------------------------
  // 窗口按键与鼠标事件监听
  // ------------------------------------------------------------------------------------
  function bindWindowEvents(win) {
    if (!win || !win.document) return;

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
      const isInputActive = activeEl && activeEl.tagName === 'INPUT';

      if (isInputActive) {
        if (e.key === 'Escape') {
          activeEl.blur();
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          toggleBossKey();
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

    win.document.addEventListener(
      'wheel',
      e => {
        if (STATE.isSettingsOpen) return;
        const activeEl = win.document.activeElement;
        if (activeEl && activeEl.tagName === 'INPUT') return;

        e.preventDefault();
        if (e.deltaY > 0) {
          nextSentence();
        } else if (e.deltaY < 0) {
          prevSentence();
        }
      },
      { passive: false }
    );

    // 点击菜单外部关闭右键上下文菜单
    win.document.addEventListener('click', e => {
      if (STATE.isContextMenuOpen) {
        const menu = win.document.getElementById('tb-context-menu');
        const trigger = win.document.getElementById('btn-context-menu');
        if (menu && !menu.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
          closeContextMenu();
        }
      }
    });

    // 右键呼出摸鱼条专属上下文菜单
    win.document.addEventListener('contextmenu', e => {
      if (STATE.isSettingsOpen || STATE.isFloorPickerOpen) return;
      const target = e.target;
      // 输入框内右键保留系统原生编辑菜单 (复制/粘贴/剪切)
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY);
    });
  }

  // ------------------------------------------------------------------------------------
  // 酒馆网页常驻悬浮入口注入
  // ------------------------------------------------------------------------------------
  function injectSillyTavernEntrance() {
    try {
      const topDoc = window.top ? window.top.document : document;
      if (!topDoc || topDoc.getElementById('st-thief-floating-btn')) return;

      const btn = topDoc.createElement('div');
      btn.id = 'st-thief-floating-btn';
      btn.innerHTML = `🐟 Thief摸鱼条 <span id="st-thief-pill-gear" title="点击打开标签黑名单与设置" style="opacity:0.75; font-size:11px; margin-left:5px; padding:1px 3px; border-radius:3px;">⚙️</span>`;
      btn.title = '左键点击: 开启/收起摸鱼条 (快捷键: Alt + M)\n右键点击或点击齿轮: 打开标签黑名单设置\n支持鼠标按住随意拖拽位置';
      btn.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 25px;
        z-index: 999999;
        padding: 6px 14px;
        background: #181818;
        color: #4ec9b0;
        border: 1px solid #3c3c3c;
        border-radius: 18px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
        user-select: none;
        opacity: 0.9;
        transition: opacity 0.2s, transform 0.15s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Consolas, sans-serif;
      `;

      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '1';
        btn.style.transform = 'scale(1.05)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '0.9';
        btn.style.transform = 'scale(1)';
      });

      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsModal();
      });

      let isDragging = false;
      let startX = 0,
        startY = 0,
        origX = 0,
        origY = 0;

      btn.addEventListener('mousedown', e => {
        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = btn.getBoundingClientRect();
        origX = rect.left;
        origY = rect.top;

        function onMouseMove(ev) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
            isDragging = true;
          }
          if (isDragging) {
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.left = `${origX + (ev.clientX - startX)}px`;
            btn.style.top = `${origY + (ev.clientY - startY)}px`;
          }
        }

        function onMouseUp() {
          topDoc.removeEventListener('mousemove', onMouseMove);
          topDoc.removeEventListener('mouseup', onMouseUp);
        }

        topDoc.addEventListener('mousemove', onMouseMove);
        topDoc.addEventListener('mouseup', onMouseUp);
      });

      btn.addEventListener('click', e => {
        if (!isDragging) {
          e.stopPropagation();
          const target = e.target;
          if (target && target.id === 'st-thief-pill-gear') {
            openSettingsModal();
          } else {
            toggleThiefBar();
          }
        }
      });

      topDoc.body.appendChild(btn);
      console.log('[ST-Thief-Book] 成功在酒馆主界面注入“🐟 Thief摸鱼条”悬浮入口');
    } catch (e) {
      console.warn('[ST-Thief-Book] 注入悬浮入口异常:', e);
    }
  }

  function setupHostGlobalShortcuts() {
    try {
      const topDoc = window.top ? window.top.document : document;
      topDoc.addEventListener('keydown', e => {
        if (e.altKey && (e.key === 'm' || e.key === 'M')) {
          e.preventDefault();
          toggleThiefBar();
        }
        if (e.key === 'Escape' && STATE.thiefWindow && !STATE.thiefWindow.closed) {
          toggleBossKey();
        }
      });
    } catch (e) {
      console.warn('[ST-Thief-Book] 注入宿主按键监听受限:', e);
    }
  }

  // ------------------------------------------------------------------------------------
  // 画中画（Document Picture-in-Picture）与弹窗开启逻辑
  // ------------------------------------------------------------------------------------
  async function openThiefBar() {
    if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      STATE.thiefWindow.focus();
      return;
    }

    refreshLatestMessage(false);

    const baseH = CONFIG.minimalMode
      ? (CONFIG.layoutMode === 'double' ? 56 : 30)
      : (CONFIG.layoutMode === 'double' ? CONFIG.doubleHeight : CONFIG.singleHeight);
    const winHeight = STATE.isSettingsOpen ? 500 : baseH;

    if ('documentPictureInPicture' in window) {
      try {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width: CONFIG.barWidth,
          height: winHeight
        });

        STATE.thiefWindow = pipWin;
        pipWin.addEventListener('unload', () => {
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
        console.warn('[ST-Thief-Book] Document Picture-in-Picture 启动失败，降级使用独立弹窗:', err);
      }
    }

    const left = Math.max(0, Math.floor((window.screen.width - CONFIG.barWidth) / 2));
    const top = Math.max(0, window.screen.height - winHeight - 65);

    const popupWin = window.open(
      '',
      'ST_Thief_Bar',
      `width=${CONFIG.barWidth},height=${winHeight},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
    );

    if (!popupWin) {
      alert('无法弹出摸鱼条，请在浏览器地址栏允许弹出式窗口权限！');
      return;
    }

    STATE.thiefWindow = popupWin;
    popupWin.document.title = 'VSCode Status Bar';
    popupWin.addEventListener('unload', () => {
      STATE.thiefWindow = null;
    });
    popupWin.addEventListener('resize', () => {
      if (popupWin.innerWidth && popupWin.innerWidth >= 360) {
        CONFIG.barWidth = popupWin.innerWidth;
        saveCurrentConfig();
        syncToDesktop();
      }
    });

    renderThiefBar();
  }

  function toggleThiefBar() {
    if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      closeThiefBar();
    } else {
      openThiefBar();
    }
  }

  function closeThiefBar() {
    if (STATE.thiefWindow && !STATE.thiefWindow.closed) {
      STATE.thiefWindow.close();
      STATE.thiefWindow = null;
    }
  }

  // ------------------------------------------------------------------------------------
  // 本地桌面端 WebSocket 同步机制
  // ------------------------------------------------------------------------------------
  function initDesktopBridge() {
    try {
      const wsUrl = `ws://127.0.0.1:${CONFIG.wsPort}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[ST-Thief-Book] 成功连接到 Python 桌面摸鱼客户端');
        STATE.wsClient = ws;
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
        setTimeout(initDesktopBridge, 5000);
      };

      ws.onerror = () => {
        STATE.wsClient = null;
      };
    } catch (e) {}
  }

  function syncToDesktop() {
    if (!STATE.wsClient || STATE.wsClient.readyState !== WebSocket.OPEN) return;

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
    openMenu: openContextMenu,
    closeMenu: closeContextMenu,
    openSettings: openSettingsModal,
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
