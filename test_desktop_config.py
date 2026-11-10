#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""桌面端配置清洗 / 原子写盘 / 桥接密钥持久化单测：python test_desktop_config.py"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from thief_desktop_bar import ThiefDesktopBar


def make_bar():
    # 绕过 __init__（不创建 Tk 窗口），只测纯逻辑
    bar = object.__new__(ThiefDesktopBar)
    bar.config = {}
    return bar


def main():
    passed = 0

    # 1. bool 键只接受真正的 bool
    bar = make_bar()
    bar._merge_sync_config({'minimalMode': True, 'showUserMessages': 'true',
                            'enableWhitelist': 1, 'filterActions': None})
    assert bar.config == {'minimalMode': True}, "非 bool 值不应写入"
    bar._merge_sync_config({'minimalMode': False})
    assert bar.config['minimalMode'] is False
    passed += 1
    print("[PASS] bool 键类型校验")

    # 2. 枚举键只接受合法字符串
    bar = make_bar()
    bar._merge_sync_config({'layoutMode': 'single', 'charNameMode': 'hidden',
                            'wrapMode': 'wrap', 'filterMode': 'regex'})
    assert bar.config == {'layoutMode': 'single', 'charNameMode': 'hidden',
                          'wrapMode': 'wrap', 'filterMode': 'regex'}
    bar._merge_sync_config({'layoutMode': 'triple', 'charNameMode': 123, 'filterMode': 'PURE'})
    assert bar.config['layoutMode'] == 'single' and bar.config['filterMode'] == 'regex', "非法枚举不应覆盖"
    assert bar.config['charNameMode'] == 'hidden'
    passed += 1
    print("[PASS] 枚举键取值校验")

    # 3. 未知键（含敏感键）一律忽略
    bar = make_bar()
    bar._merge_sync_config({'bridge_token': 'x', 'width': 9999, '__class__': 'x', 'config_file': '/tmp/x'})
    assert bar.config == {}, "未知键不应写入 config"
    passed += 1
    print("[PASS] 未知键忽略")

    # 4. 标签列表清洗：去空白 / 去非字符串 / 去空串 / 去超长
    bar = make_bar()
    bar._merge_sync_config({'tagBlacklist': ['  think  ', '', 123, 'x' * 65, 'ok', None],
                            'tagWhitelist': 'content'})
    assert bar.config['tagBlacklist'] == ['think', 'ok']
    assert 'tagWhitelist' not in bar.config, "非列表不应写入"
    passed += 1
    print("[PASS] 标签列表清洗")

    # 5. 标签数量上限 100
    bar = make_bar()
    bar._merge_sync_config({'tagWhitelist': [f't{i}' for i in range(150)]})
    assert len(bar.config['tagWhitelist']) == 100
    passed += 1
    print("[PASS] 标签数量上限")

    # 6. 原子写盘：内容可回读、覆盖生效、无 .tmp 残留
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, 'cfg.json')
        ThiefDesktopBar._atomic_write_json(path, {'a': 1})
        ThiefDesktopBar._atomic_write_json(path, {'a': 2, 'b': '中文'})
        with open(path, 'r', encoding='utf-8') as f:
            assert json.load(f) == {'a': 2, 'b': '中文'}
        assert not os.path.exists(path + '.tmp'), "不应留下临时文件"
    passed += 1
    print("[PASS] 原子写盘回读与覆盖")

    # 7. 桥接密钥：自动生成 32 位 hex、独立文件存放、重启复用、不覆盖已有密钥
    with tempfile.TemporaryDirectory() as td:
        cfg = os.path.join(td, 'thief_bar_config.json')
        bar = make_bar()
        bar.config_file = cfg
        bar.bridge_token = ''
        bar._load_or_create_bridge_token()
        token = bar.bridge_token
        assert len(token) == 32 and all(c in '0123456789abcdef' for c in token)
        token_path = os.path.join(td, 'thief_bar_bridge.token')
        assert os.path.exists(token_path) and not os.path.exists(cfg), "密钥必须独立于 config 存放"
        with open(token_path, 'r', encoding='utf-8') as f:
            assert f.read().strip() == token
        bar2 = make_bar()
        bar2.config_file = cfg
        bar2.bridge_token = ''
        bar2._load_or_create_bridge_token()
        assert bar2.bridge_token == token, "重启应复用同一密钥"
    passed += 1
    print("[PASS] 桥接密钥生成 / 独立存放 / 复用")

    print(f"\n全部 {passed} 项测试通过")


if __name__ == '__main__':
    main()