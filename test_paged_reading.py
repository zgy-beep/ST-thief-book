#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""整段分屏阅读单测：python test_paged_reading.py"""
import os
import sys

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
    bar.font_main = FakeFont()
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

    # 11. 极窄宽度连一个字都放不下：至少显示省略号
    out = bar._truncate_to_width('abcdef', 5)
    assert out == '…', f"实际: {out}"
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

    # 14. 分屏：无句末标点时硬切，紧跟的标点留在本页
    pages = bar._compute_pages('abcdefghij，klmn', 100)
    assert pages == [(0, 11), (11, 15)], f"实际: {pages}"
    passed += 1
    print("[PASS] 分屏：硬切携带 trailing 标点")

    # 15. 分屏：无标点纯硬切，页页相接不丢字
    pages = bar._compute_pages('x' * 25, 100)
    assert pages == [(0, 10), (10, 20), (20, 25)]
    assert ''.join(('x' * 25)[a:b] for a, b in pages) == 'x' * 25
    passed += 1
    print("[PASS] 分屏：纯硬切无缝覆盖")

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

    print(f"\n全部 {passed} 项测试通过")


if __name__ == '__main__':
    main()