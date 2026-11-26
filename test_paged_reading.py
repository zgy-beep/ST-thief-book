#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""整段分屏阅读单测：python test_paged_reading.py"""
import json
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from thief_desktop_bar import ThiefDesktopBar


class FakeFont:
    """每字符恒定 10px，便于精确推算截断点"""
    def measure(self, s):
        return len(s) * 10


def make_bar():
    # 绕过 __init__（不创建 Tk 窗口），只测纯逻辑
    bar = object.__new__(ThiefDesktopBar)
    bar.config = {}
    bar.is_generating = False
    bar.font_main = FakeFont()
    bar._pending_floor_step = None
    bar._pending_floor_job = None
    bar._queued_navigation = None
    bar._floor_request_id = 0
    bar._chat_id = None
    bar._resume_floor = bar._resume_offset = bar._resume_chat_id = None
    bar._legacy_width = None
    bar._generation_status = ('idle', None, 'idle')
    bar._generation_hint = ''
    bar._generation_hint_job = None
    bar._can_retry_generation = False
    bar._choices_window = None
    bar.reply_choices = ()
    return bar


def main():
    passed = 0
    acc = ThiefDesktopBar._accumulate_stream

    # 1. 首句初始化
    parts, off = acc([], None, 5, 1, '你好。')
    assert parts == [(1, '你好。')] and off == 0
    passed += 1
    print("[PASS] 首句初始化")

    # 2. 顺序追加，偏移指向当前句
    parts, off = acc([(1, '你好。')], 5, 5, 2, '世界。')
    assert parts == [(1, '你好。'), (2, '世界。')] and off == 3
    passed += 1
    print("[PASS] 顺序追加与偏移")

    # 3. 回归：同一句文本更新必须刷新（流式增长/重新同步），不能沿用旧文本
    parts, off = acc([(1, '你好。'), (2, '旧。')], 5, 5, 2, '新新。')
    assert parts == [(1, '你好。'), (2, '新新。')], "同句更新被丢弃"
    assert off == 3
    passed += 1
    print("[PASS] 同句文本更新刷新")

    # 4. 乱序到达按句序插入
    parts, off = acc([(1, 'a'), (3, 'c')], 5, 5, 2, 'b')
    assert parts == [(1, 'a'), (2, 'b'), (3, 'c')] and off == 1
    passed += 1
    print("[PASS] 乱序插入排序")

    # 5. 换楼层 = 换消息：累计清空重来
    parts, off = acc([(1, 'a'), (2, 'b')], 5, 6, 3, 'x')
    assert parts == [(3, 'x')] and off == 0
    passed += 1
    print("[PASS] 换楼层重置")

    # 6. 回到首句重新开始（避免混入上一条消息的残句）
    parts, off = acc([(1, 'a'), (2, 'b')], 5, 5, 1, 'a改')
    assert parts == [(1, 'a改')] and off == 0
    passed += 1
    print("[PASS] 回首页重置")

    # 7. 中间句偏移 = 之前所有句长度之和
    parts, off = acc([(1, '你好。'), (2, '世界。')], 5, 5, 3, '！')
    assert off == 6
    passed += 1
    print("[PASS] 中间句偏移")

    # 8. 单行截断：未超宽原样返回
    bar = make_bar()
    assert bar._truncate_to_width('你好', 100) == '你好'
    assert bar._truncate_to_width('', 100) == ''
    passed += 1
    print("[PASS] 截断：短文本与空文本")

    # 9. 单行截断：超宽补省略号且总宽不超限（10px/字符，'…'占 10px）
    out = bar._truncate_to_width('abcdefghij', 55)
    assert out == 'abcd…', f"实际: {out}"
    assert bar.font_main.measure(out) <= 55
    passed += 1
    print("[PASS] 截断：补省略号且不超宽")

    # 10. 截断点落在空白上时先剥离再补省略号
    out = bar._truncate_to_width('ab     cdefghij', 45)
    assert out == 'ab…', f"实际: {out}"
    passed += 1
    print("[PASS] 截断：剥离尾部空白")

    # 11. 极窄宽度连省略号也放不下
    out = bar._truncate_to_width('abcdef', 5)
    assert out == '', f"实际: {out}"
    passed += 1
    print("[PASS] 截断：极窄宽度兜底")

    # 12. 分屏：空文本与恰好整屏
    assert bar._compute_pages('', 100) == [(0, 0)]
    assert bar._compute_pages('x' * 10, 100) == [(0, 10)]
    passed += 1
    print("[PASS] 分屏：空文本与恰好整屏")

    # 13. 分屏：本屏内有句末标点则自然断句（该屏可以不填满）
    pages = bar._compute_pages('ab。cdefghijklmn', 100)
    assert pages == [(0, 3), (3, 13), (13, 15)], f"实际: {pages}"
    passed += 1
    print("[PASS] 分屏：句末标点自然断句")

    # 14. 分屏：放不下的标点与前一字一起顺延
    pages = bar._compute_pages('abcdefghij，klmn', 100)
    assert pages == [(0, 9), (9, 15)], f"实际: {pages}"
    passed += 1
    print("[PASS] 分屏：硬切携带 trailing 标点")

    # 15. 分屏：无标点纯硬切，页页相接不丢字
    pages = bar._compute_pages('x' * 25, 100)
    assert pages == [(0, 10), (10, 20), (20, 25)]
    assert ''.join(('x' * 25)[a:b] for a, b in pages) == 'x' * 25
    passed += 1
    print("[PASS] 分屏：纯硬切无缝覆盖")

    text = 'Hello world'
    assert bar._compute_pages(text, 90) == [(0, 6), (6, 11)]
    passed += 1
    print("[PASS] 分屏：附近有空格时保留完整单词")

    # 16. 分屏：宽度不足一个字符也保证前进（不死循环）
    pages = bar._compute_pages('abc', 5)
    assert pages == [(0, 1), (1, 2), (2, 3)]
    passed += 1
    print("[PASS] 分屏：极窄宽度兜底")

    # 17. 偏移→页码映射：边界、句首、越界
    bar._pages = [(0, 3), (3, 13), (13, 15)]
    for off, want in [(0, 0), (2, 0), (3, 1), (12, 1), (13, 2), (14, 2), (15, 2), (99, 2)]:
        got = bar._page_index_for_offset(off)
        assert got == want, f"offset={off} 期望页 {want} 实际 {got}"
    bar._pages = []
    assert bar._page_index_for_offset(5) == 0
    passed += 1
    print("[PASS] 偏移→页码映射")

    # 18. 当前页起始偏移与越界钳制
    bar._pages = [(0, 3), (3, 13)]
    bar._page_idx = 1
    assert bar._page_start_offset() == 3
    bar._page_idx = 9
    assert bar._page_start_offset() == 3
    bar._page_idx = -1
    assert bar._page_start_offset() == 0
    passed += 1
    print("[PASS] 页起始偏移与钳制")

    # 19. 翻页可用性判断
    bar._pages = [(0, 3), (3, 13)]
    bar._page_idx = 0
    assert bar._has_more_pages() and not bar._has_prev_pages()
    bar._page_idx = 1
    assert not bar._has_more_pages() and bar._has_prev_pages()
    bar._pages = []
    assert not bar._has_more_pages() and not bar._has_prev_pages()
    passed += 1
    print("[PASS] 翻页可用性判断")

    # 20. 渲染当前页与 _stream 回退
    class FakeLabel:
        def configure(self, **kw):
            self.kwargs = kw
    bar.lbl_text = FakeLabel()
    bar.stream_text = 'abcdefghij'
    bar._pages = [(0, 4), (4, 10)]
    bar._page_idx = 1
    bar._render_page()
    assert bar.lbl_text.kwargs['text'] == 'efghij'
    assert bar.lbl_text.kwargs['wraplength'] == 0
    bar.stream_text = ''
    bar.current_sentence = '备用句'
    assert bar._stream() == '备用句'
    passed += 1
    print("[PASS] 渲染当前页与 _stream 回退")

    # 21. 进度指示：多屏时追加 屏x/y，单屏/关闭分屏只显示句号
    bar.cur_idx = 3
    bar.total_sentences = 84
    bar._pages = [(0, 4), (4, 8), (8, 12), (12, 16), (16, 20)]
    bar._page_idx = 1
    bar.config['pagedReading'] = True
    assert bar._progress_text() == '3/84 屏2/5'
    bar._pages = [(0, 20)]
    assert bar._progress_text() == '3/84'
    bar._pages = [(0, 4), (4, 20)]
    bar.config['pagedReading'] = False
    assert bar._progress_text() == '3/84'
    passed += 1
    print("[PASS] 进度指示：屏x/y 显隐")

    # 22. 进度指示：页码越界钳制
    bar.config['pagedReading'] = True
    bar._pages = [(0, 4), (4, 20)]
    bar._page_idx = 99
    assert bar._progress_text() == '3/84 屏2/2'
    passed += 1
    print("[PASS] 进度指示：越界钳制")

    # 23. 字号钳制：范围 8~12，非法类型拒绝
    clamp = ThiefDesktopBar._clamp_font_size
    assert clamp(7) == 8 and clamp(15) == 12 and clamp(10) == 10
    assert clamp(9.0) == 9
    assert clamp('x') is None and clamp(True) is None and clamp(None) is None
    passed += 1
    print("[PASS] 字号钳制与类型校验")

    # 24. 自动阅读暂停判定：伪装/生成中/悬停/回复聚焦任一即暂停
    bar = make_bar()
    bar.is_boss_key = False
    bar._hovering = False
    bar.entry_reply = object()
    assert not bar._auto_read_paused(None)
    assert not bar._auto_read_paused(object())
    assert bar._auto_read_paused(bar.entry_reply)
    bar._hovering = True
    assert bar._auto_read_paused(None)
    bar._hovering = False
    bar.is_generating = True
    assert bar._auto_read_paused(None)
    bar.is_generating = False
    bar.is_boss_key = True
    assert bar._auto_read_paused(None)
    passed += 1
    print("[PASS] 自动阅读暂停判定")

    # 25. 阅读位置校验：合法通过，缺键/越界/bool/非字典拒绝
    vp = ThiefDesktopBar._validate_position
    assert vp({'floor': 3, 'curIdx': 2, 'pageOffset': 40}) == {'floor': 3, 'curIdx': 2, 'pageOffset': 40}
    assert vp({'floor': 0, 'curIdx': 1, 'pageOffset': 0}) is not None
    assert vp({'floor': 3, 'curIdx': 2}) is None
    assert vp({'floor': -1, 'curIdx': 2, 'pageOffset': 0}) is None
    assert vp({'floor': 3, 'curIdx': 0, 'pageOffset': 0}) is None
    assert vp({'floor': True, 'curIdx': 2, 'pageOffset': 0}) is None
    assert vp({'floor': 3, 'curIdx': 2, 'pageOffset': -5}) is None
    assert vp(None) is None and vp('x') is None
    passed += 1
    print("[PASS] 阅读位置校验")

    # 26. 贴边判定：四边、阈值边界、屏幕中央不贴边
    pick = ThiefDesktopBar._pick_dock_edge
    rect = (0, 0, 1920, 1080)
    assert pick(100, 1010, 800, 68, rect) == 'bottom'   # 距底 2px
    assert pick(100, 5, 800, 68, rect) == 'top'
    assert pick(3, 500, 800, 68, rect) == 'left'
    assert pick(1110, 500, 800, 68, rect) == 'right'    # 距右 10px
    assert pick(500, 500, 800, 68, rect) is None
    assert pick(100, 1000, 800, 68, rect) == 'bottom'   # 距底恰好 12px
    assert pick(100, 999, 800, 68, rect) is None        # 距底 13px
    passed += 1
    print("[PASS] 贴边判定")

    # 27. 贴边判定：副屏负坐标
    assert pick(-1915, 500, 800, 68, (-1920, 0, 0, 1080)) == 'left'
    passed += 1
    print("[PASS] 贴边判定：副屏负坐标")

    # 28. 收起目标：四边都只留 3px 触发条
    ht = ThiefDesktopBar._hide_target
    assert ht('bottom', 100, 1010, 800, 68, rect) == (100, 1077)
    assert ht('top', 100, 5, 800, 68, rect) == (100, -65)
    assert ht('left', 3, 500, 800, 68, rect) == (-797, 500)
    assert ht('right', 1110, 500, 800, 68, rect) == (1917, 500)
    passed += 1
    print("[PASS] 收起目标坐标")

    # 29. 从实际正文宽度重排，连续缩放保留原来的字符位置。
    bar = make_bar()
    bar.lbl_text, bar.lbl_right_info = FakeLabel(), FakeLabel()
    width = 100
    bar.lbl_text.winfo_width = lambda: width
    bar._schedule_position_save = lambda: None
    bar.floor, bar.cur_idx, bar.total_sentences = 4, 1, 2
    bar.is_boss_key = bar.is_generating = False
    bar.current_sentence = 'x' * 15
    bar.stream_text = bar.current_sentence + 'y' * 15
    bar._reading_offset = 0
    bar._update_reading_view()
    bar.action_next()
    assert bar._reading_offset == 10
    assert bar.lbl_right_info.kwargs['text'] == '1/2 屏2/3'
    for width in (90, 80, 100):
        bar._update_reading_view()
        start, end = bar._pages[bar._page_idx]
        assert start <= 10 < end
        assert bar.font_main.measure(bar.lbl_text.kwargs['text']) <= width
    assert bar._page_idx == 1
    passed += 1
    print("[PASS] 正文宽度重排、阅读位置及本地翻页进度")

    # 30. 手动上一楼后立即下一页，必须先落到上一楼末屏，再进原楼首屏。
    events = []
    def broadcast(event):
        events.append(event)
        return True
    bar.server = SimpleNamespace(broadcast=broadcast)
    bar.root = SimpleNamespace(after=lambda ms, callback: 'floor-step', after_cancel=lambda job: None)
    bar._update_display = bar._update_reading_view
    bar._is_resizing = bar._has_full_text = False
    bar._synced_once = True
    bar.action_next()
    bar.action_next()
    assert events.pop() == {'action': 'next'}  # 旧版单句桥接
    bar._has_full_text = True
    bar.action_next()
    assert events.pop() == {'action': 'change_floor', 'delta': 1, 'fromFloor': 4,
                            'floorRequest': 1, 'quiet': False}
    next_floor = {'type': 'sync', 'floor': 6, 'curIdx': 1, 'totalSentences': 2,
                  'currentSentence': 'z' * 25, 'fullText': 'z' * 25 + '末句'}
    bar._apply_ws_message(json.dumps({**next_floor, 'pageEdge': 'first', 'floorRequest': 1}))
    assert (bar.floor, bar._page_idx) == (6, 0)
    bar.action_floor_prev()
    assert events.pop() == {'action': 'change_floor', 'delta': -1, 'fromFloor': 6,
                            'floorRequest': 2, 'quiet': False}
    bar.action_next()
    assert not events  # 等楼层切换完成再翻下一页。
    width = 60
    prev_floor = {**next_floor, 'floor': 4, 'curIdx': 2, 'currentSentence': 'y' * 15,
                  'fullText': 'x' * 15 + 'y' * 15, 'sentenceOffset': 15}
    # 旧桥接只返回末句的起始偏移，末句还会跨越多屏。
    bar._apply_ws_message(json.dumps(prev_floor))
    assert (bar.floor, bar._page_idx, bar.lbl_text.kwargs['text']) == (4, 4, 'y' * 6)
    assert events.pop() == {'action': 'change_floor', 'delta': 1, 'fromFloor': 4,
                            'floorRequest': 3, 'quiet': False}
    bar._apply_ws_message(json.dumps({**next_floor, 'pageEdge': 'first', 'floorRequest': 3}))
    assert (bar.floor, bar._page_idx) == (6, 0)
    bar.action_prev()
    assert events.pop()['delta'] == -1
    bar._apply_ws_message(json.dumps({**prev_floor, 'pageEdge': 'last', 'floorRequest': 4}))
    bar._apply_ws_message(json.dumps(prev_floor))
    assert bar._page_idx == 4  # 普通同步保留末屏
    bar.config['pagedReading'] = False
    bar._update_reading_view()
    assert bar.lbl_text.kwargs['text'] == 'yyyyy…'
    bar.action_next()
    assert events.pop() == {'action': 'next'}
    passed += 1
    print("[PASS] 双向跨楼、旧桥接兼容、连续点击和逐句截断")

    # 同号楼层换会话，旧的屏偏移和旧桥接的重复宽度都不能覆盖新状态。
    bar.config['pagedReading'] = True
    bar._chat_id = 'chat-a'
    bar._resume_floor, bar._resume_offset, bar._resume_chat_id = 4, 24, 'chat-a'
    bar.width = 670
    bar._legacy_width = 840
    bar._apply_ws_message(json.dumps({**prev_floor, 'curIdx': 1, 'sentenceOffset': 0,
                                     'chatId': 'chat-b', 'resumeFloor': 4, 'barWidth': 840}))
    assert (bar.floor, bar._page_idx, bar.width) == (4, 0, 670)
    assert bar._resume_offset is None
    bar.action_next()
    bookmark = bar._reading_offset
    for generating in (True, False):
        bar._apply_ws_message(json.dumps({**prev_floor, 'curIdx': 1, 'chatId': 'chat-b',
                                         'isGenerating': generating, 'followGenerating': False}))
        assert bar._reading_offset == bookmark
    bar._resume_floor, bar._resume_offset, bar._resume_chat_id = 4, 24, 'chat-b'
    bar._apply_ws_message(json.dumps({**prev_floor, 'curIdx': 1, 'chatId': 'chat-b', 'resumeFloor': None}))
    assert bar._reading_offset == bookmark
    bar._apply_ws_message(json.dumps({**prev_floor, 'curIdx': 1, 'chatId': 'chat-b', 'resumeFloor': 4}))
    assert bar._reading_offset == 24 and bar._resume_offset is None
    passed += 1
    print("[PASS] 换会话重置屏偏移，历史楼层分屏和宽度不受普通同步影响")

    # 新回复从首屏开始，流式增长和生成结束都保留手动读到的位置。
    new_reply = {**prev_floor, 'floor': 8, 'curIdx': 1, 'sentenceOffset': 0,
                 'chatId': 'chat-b', 'isGenerating': True}
    bar._apply_ws_message(json.dumps(new_reply))  # 兼容未发送 pageEdge 的旧桥接。
    assert (bar.floor, bar._page_idx, bar.is_generating) == (8, 0, True)
    bar.action_next()
    bookmark = bar._reading_offset
    new_reply['fullText'] += 'z' * 20
    bar._apply_ws_message(json.dumps(new_reply))
    assert bar._page_idx == 1 and bar._reading_offset == bookmark
    bar._apply_ws_message(json.dumps({**new_reply, 'isGenerating': False}))
    assert bar._page_idx == 1 and bar._reading_offset == bookmark and not bar.is_generating
    passed += 1
    print("[PASS] 新楼流式生成从首屏开始并保留手动翻页位置")

    # 31. 编辑回复时保留原有按键行为，断线不能清空输入。
    bar = make_bar()
    bar.is_boss_key = False
    actions = []
    draft = ['编辑中的回复']
    bar.entry_reply = SimpleNamespace(get=lambda: draft[0], delete=lambda *_: draft.clear())
    bar.root = SimpleNamespace(winfo_containing=lambda *_: bar.entry_reply)
    entry = SimpleNamespace(widget=bar.entry_reply, state=0, delta=-120, x_root=10, y_root=10)
    assert bar._reading_shortcut(entry, lambda: actions.append('page')) is None
    bar.action_next = lambda: actions.append('page')
    body = SimpleNamespace(widget=object(), state=0, delta=-120, x_root=10, y_root=10)
    bar._on_mousewheel(body)  # 聚焦在别处时，指针仍可能在回复框上。
    assert not actions
    assert bar._reading_shortcut(body, bar.action_next) == 'break'
    assert actions == ['page']
    bar.flash_hint = actions.append
    bar.server = SimpleNamespace(broadcast=lambda event: False)
    assert bar._submit_reply() == 'break'
    assert draft and '草稿已保留' in actions[-1]
    bar.server.broadcast = broadcast
    bar._submit_reply()
    assert not draft and events.pop() == {'action': 'reply', 'text': '编辑中的回复'}
    passed += 1
    print("[PASS] 回复编辑不触发翻页，桥接断开时保留草稿")

    bar._update_reply_indicators = lambda: None
    bar.root.after = lambda ms, callback: 'generation-hint'
    bar.root.after_cancel = lambda job: None
    failed = {'generationStatus': 'failed', 'generationId': 2, 'canRetryGeneration': True}
    bar._apply_generation_status(failed)
    assert bar._generation_hint == 'failed'
    bar.action_swipe()
    assert events.pop() == {'action': 'retry_generation'}
    bar._expire_generation_hint()
    bar._apply_generation_status(failed)
    assert bar._generation_hint == '' and bar._can_retry_generation
    passed += 1
    print("[PASS] 失败提示自动消失，重新同步不会让提示重复出现，重试仍可用")

    marks = []
    bar._chinese_punctuation = SimpleNamespace(get=lambda: True)
    bar._ime_composing = False
    bar._insert_reply_punctuation = marks.append
    for char in "()[]{}":
        assert bar._on_reply_key(SimpleNamespace(char=char, state=1)) == 'break'
    assert ''.join(marks) == '（）【】｛｝'
    assert bar._on_reply_key(SimpleNamespace(char='（', state=0)) is None
    passed += 1
    print("[PASS] 键入中文括号，保留输入法直接产生的全角字符")

    print(f"\n全部 {passed} 项测试通过")


if __name__ == '__main__':
    main()
