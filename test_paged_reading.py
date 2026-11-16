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

    print(f"\n全部 {passed} 项测试通过")


if __name__ == '__main__':
    main()