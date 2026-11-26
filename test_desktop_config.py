#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""桌面端配置清洗 / 原子写盘 / 桥接密钥持久化单测：python test_desktop_config.py"""
import json
import os
import sys
import tempfile
import time
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from thief_desktop_bar import ThiefDesktopBar


def make_bar():
    # 绕过 __init__（不创建 Tk 窗口），只测纯逻辑
    bar = object.__new__(ThiefDesktopBar)
    bar.config = {}
    bar._resume_offset = None
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
    bar._merge_sync_config({'tagWhitelist': ['&lt;game&gt;', '[GAME]', '&#x3c;story&#x3e;'],
                            'tagBlacklist': ['&amp;lt;meta&amp;gt;']})
    assert bar.config['tagWhitelist'] == ['game', 'story']
    assert bar.config['tagBlacklist'] == ['meta']
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

    # 8. 退出时立即提交尚未写入的翻页位置。
    with tempfile.TemporaryDirectory() as td:
        bar = make_bar()
        bar.config_file = os.path.join(td, 'thief_bar_config.json')
        bar.root = SimpleNamespace(mainloop=lambda: None, winfo_ismapped=lambda: True,
                                   winfo_x=lambda: 160, winfo_y=lambda: 220)
        bar._saved_window_position, bar._dock_pos, bar._slide_job = None, None, None
        bar._synced_once = True
        bar.floor, bar.cur_idx, bar._reading_offset = 7, 2, 128
        bar._chat_id = 'character:1/chat-a'
        bar._resume_pos = {'floor': 7, 'curIdx': 2, 'pageOffset': 0}
        bar.run()
        assert bar._load_position() == {
            'floor': 7, 'curIdx': 2, 'pageOffset': 128, 'chatId': 'character:1/chat-a'
        }
        assert not os.path.exists(bar._pid_file_path())
        assert bar._load_window_position() == (160, 220)
        bar._resume_offset = 128
        bar._reading_offset = 0
        bar._save_position_now()
        assert bar._load_position()['pageOffset'] == 128, "恢复期间的临时首屏不能覆盖书签"
    passed += 1
    print("[PASS] 正常退出即时保存最新阅读位置")

    # 自动隐藏时保存展开坐标，允许负坐标，拔掉副屏时回到现有屏幕。
    with tempfile.TemporaryDirectory() as td:
        bar.config_file = os.path.join(td, 'thief_bar_config.json')
        bar.width, bar.height = 600, 36
        bar._dock_pos = (-1550, 900)
        bar._hidden = True
        bar._save_window_position()
        assert bar._load_window_position() == (-1550, 900)
        bar._monitor_rect = lambda rect: (-1920, 0, 0, 1040)
        assert bar._initial_window_position() == (-1550, 900)
        bar._monitor_rect = lambda rect: (0, 0, 1920, 1040)
        assert bar._initial_window_position() == (0, 900)
        bar._atomic_write_json(bar._window_position_file(), {'x': True, 'y': 900})
        assert bar._load_window_position() is None
    passed += 1
    print("[PASS] 记住窗口坐标，兼容自动隐藏和显示器变更")

    # 9. 无操作自动伪装：秒数夹取与文案
    assert ThiefDesktopBar._clamp_auto_boss(None) is None
    assert ThiefDesktopBar._clamp_auto_boss(True) is None
    assert ThiefDesktopBar._clamp_auto_boss(-5) == 0
    assert ThiefDesktopBar._clamp_auto_boss(1) == 5
    assert ThiefDesktopBar._clamp_auto_boss(99999) == 3600
    assert ThiefDesktopBar._clamp_auto_boss(120.9) == 120
    assert ThiefDesktopBar._fmt_sec(0) == '关闭'
    assert ThiefDesktopBar._fmt_sec(45) == '45 秒'
    assert ThiefDesktopBar._fmt_sec(180) == '3 分钟'
    assert ThiefDesktopBar._fmt_sec(150) == '2 分 30 秒'
    passed += 1
    print("[PASS] 自动伪装秒数夹取与文案")

    # 10. 空闲判定：0 = 关闭；未到时不动；到点自动进伪装；伪装中不重复广播
    def make_idle_bar(sec, local_idle, system_idle=0.0, hovering=False):
        bar = make_bar()
        bar.config = {'autoBossSec': sec}
        bar.is_boss_key = False
        bar._hovering = hovering
        bar._settings_win = bar._auto_boss_win = bar._choices_window = None
        bar._last_activity = time.monotonic() - local_idle
        bar._system_idle_seconds = lambda: system_idle
        bar._note_activity = lambda *a: None
        bar._update_display = lambda: None
        bar.sent = []
        bar.server = SimpleNamespace(broadcast=lambda msg: bar.sent.append(msg))
        return bar

    bar = make_idle_bar(0, 9999)
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is False, "0 表示关闭"
    bar = make_idle_bar(60, 59.4)
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is False, "未到时长不应伪装"
    bar = make_idle_bar(60, 60.0)
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is True and {'action': 'boss'} in bar.sent
    bar = make_idle_bar(60, 9999)
    bar.is_boss_key = True
    bar._maybe_auto_disguise()
    assert bar.sent == [], "已在伪装中不应重复广播"
    bar = make_idle_bar(60, 9999)
    bar._settings_win = SimpleNamespace(winfo_exists=lambda: True)
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is False, "设置面板开着时不应抢着伪装"
    bar._settings_win = SimpleNamespace(winfo_exists=lambda: False)
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is True
    passed += 1
    print("[PASS] 无操作自动伪装触发 / 挂起 / 去重")

    # 10.1 两条时钟取"更大"：系统空闲被别的程序不断清零时，条内空闲照样能触发
    #      （取 min 的老逻辑在这里会永远差一点点，正是"一直不伪装"的原因）
    bar = make_idle_bar(60, local_idle=120, system_idle=0.5)
    assert bar._auto_boss_state()['idle'] == 120
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is True, "系统刚有输入但条内空闲已超时，也应伪装"
    bar = make_idle_bar(60, local_idle=5, system_idle=300)
    assert bar._auto_boss_state()['idle'] == 300
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is True, "人离开桌面时系统空闲也该触发"
    bar = make_idle_bar(60, local_idle=5, system_idle=0.5)
    assert bar._auto_boss_state()['phase'] == 'counting'
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is False, "两个时钟都没到时长就不该动"
    # 鼠标压在条上 = 人正在看，不触发
    bar = make_idle_bar(60, local_idle=999, hovering=True)
    assert bar._auto_boss_state()['phase'] == 'hovering'
    bar._maybe_auto_disguise()
    assert bar.is_boss_key is False, "鼠标停在条上时不应抢着伪装"
    # 状态快照的剩余秒数
    st = make_idle_bar(60, local_idle=20)._auto_boss_state()
    assert st['remaining'] == 40.0 and st['phase'] == 'counting'
    passed += 1
    print("[PASS] 空闲判定取双时钟最大值 + 悬停保护")

    # 11. 退出伪装会重置空闲计时，避免刚按 Esc 又立刻被判定成离开
    bar = make_idle_bar(60, 9999)
    resets = []
    bar._note_activity = lambda *a: resets.append(1)
    bar.toggle_boss(True)
    assert bar.is_boss_key is True and resets == []
    bar.toggle_boss(False)
    assert bar.is_boss_key is False and resets == [1]
    passed += 1
    print("[PASS] 退出伪装重置空闲计时")

    # 12. autoBossSec 落盘后能读回，非法值忽略
    with tempfile.TemporaryDirectory() as td:
        cfg = os.path.join(td, 'thief_bar_config.json')
        bar = make_bar()
        bar.config = {'autoBossSec': 180}
        bar.width, bar.alpha, bar.theme_name = 860, 0.95, 'vscode-dark'
        bar.config_file = cfg
        bar._save_config()
        with open(cfg, 'r', encoding='utf-8') as f:
            assert json.load(f)['autoBossSec'] == 180

        bar2 = make_bar()
        bar2.config_file = cfg
        bar2.root = SimpleNamespace(wm_attributes=lambda *a: None)
        bar2._load_config()
        assert bar2.config['autoBossSec'] == 180

        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'autoBossSec': 'abc'}, f)
        bar3 = make_bar()
        bar3.config_file = cfg
        bar3.root = SimpleNamespace(wm_attributes=lambda *a: None)
        bar3._load_config()
        assert 'autoBossSec' not in bar3.config, "非数字不应写入"
    passed += 1
    print("[PASS] autoBossSec 持久化与非法值忽略")

    # 13. WS action=toggle_boss：托盘全局老板键通过这条指令驱动伪装
    bar = make_bar()
    bar.is_boss_key = False
    sent = []
    bar.server = SimpleNamespace(broadcast=lambda msg: sent.append(msg))
    bar._update_display = lambda: None
    bar._note_activity = lambda *a: None
    bar._apply_ws_message(json.dumps({'action': 'toggle_boss'}))
    assert bar.is_boss_key is True and {'action': 'boss'} in sent
    bar._apply_ws_message(json.dumps({'action': 'toggle_boss'}))
    assert bar.is_boss_key is False, "再发一次应翻回来"
    bar._apply_ws_message(json.dumps({'action': 'toggle_boss', 'bossKey': True}))
    assert bar.is_boss_key is True, "带 bossKey 时应按指定状态幂等设置"
    bar._apply_ws_message(json.dumps({'action': 'toggle_boss', 'bossKey': False}))
    assert bar.is_boss_key is False
    passed += 1
    print("[PASS] WS toggle_boss 驱动伪装")

    # 14. 伪装风格：数据完整、切换落盘、非法值忽略、循环可用
    from thief_desktop_bar import BOSS_STYLES, BOSS_PLACEHOLDERS, BOSS_GROUPS, DEFAULT_BOSS_STYLE
    required = {'group', 'label', 'branch', 'text', 'right', 'prefix', 'reply'}
    optional = {'live'}          # 只有系统监控 / 时钟带：走真实采样
    group_ids = {gid for gid, _ in BOSS_GROUPS}
    assert len(BOSS_STYLES) >= 5, "至少要有几种风格可选"
    labels = set()
    replies = set()
    for sid, cfg in BOSS_STYLES.items():
        assert set(cfg) - optional == required, f"{sid} 字段不全: {(set(cfg) - optional) ^ required}"
        assert set(cfg) <= required | optional, f"{sid} 有多余字段: {set(cfg) - required - optional}"
        assert all(isinstance(cfg[k], str) and cfg[k] for k in required), f"{sid} 有空字段"
        assert cfg['group'] in group_ids, f"{sid} 的分组 {cfg['group']} 未登记在 BOSS_GROUPS"
        assert cfg['label'] not in labels, f"{sid} 标签重复"
        assert cfg['reply'] not in replies, f"{sid} 占位文案重复"
        labels.add(cfg['label'])
        replies.add(cfg['reply'])
    # 每组都要有成员，且至少包含办公/影音/系统里的非代码风格
    for gid in group_ids:
        assert any(c['group'] == gid for c in BOSS_STYLES.values()), f"{gid} 组为空"
    assert {c['group'] for c in BOSS_STYLES.values()} == group_ids, "有分组没被用上"
    assert any(c['group'] == 'office' for c in BOSS_STYLES.values()), "要有非代码的办公风格"
    assert any(c['group'] == 'media' for c in BOSS_STYLES.values()), "要有影音风格"
    assert DEFAULT_BOSS_STYLE in BOSS_STYLES
    assert BOSS_PLACEHOLDERS == frozenset(replies), "占位文案集合必须覆盖所有风格"

    with tempfile.TemporaryDirectory() as td:
        cfg = os.path.join(td, 'thief_bar_config.json')
        bar = make_bar()
        bar.config = {'bossStyle': DEFAULT_BOSS_STYLE}
        bar.width, bar.alpha, bar.theme_name = 860, 0.95, 'vscode-dark'
        bar.config_file = cfg
        displayed = []
        bar._update_display = lambda: displayed.append(1)
        bar._note_activity = lambda *a: None
        bar.is_boss_key = True

        bar.set_boss_style('docker', announce=False)
        assert bar.config['bossStyle'] == 'docker'
        assert bar._boss_style()['prefix'] == ' [compose]'
        assert displayed, "伪装中换风格应立刻重绘"
        with open(cfg, 'r', encoding='utf-8') as f:
            assert json.load(f)['bossStyle'] == 'docker'

        bar.set_boss_style('不存在的风格', announce=False)
        assert bar.config['bossStyle'] == 'docker', "非法风格不应写入"

        bar.cycle_boss_style()
        ids = list(BOSS_STYLES)
        assert bar.config['bossStyle'] == ids[(ids.index('docker') + 1) % len(ids)]
        bar.set_boss_style(ids[-1], announce=False)
        bar.cycle_boss_style()
        assert bar.config['bossStyle'] == ids[0], "循环应回到第一个"

        # 未进入伪装时换风格不重绘
        bar.is_boss_key = False
        displayed.clear()
        bar.set_boss_style('git', announce=False)
        assert displayed == []

        # 落盘后能读回，未知值忽略
        bar.is_boss_key = False
        bar2 = make_bar()
        bar2.config_file = cfg
        bar2.root = SimpleNamespace(wm_attributes=lambda *a: None)
        bar2._load_config()
        assert bar2.config['bossStyle'] == 'git'
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'bossStyle': 'nope'}, f)
        bar3 = make_bar()
        bar3.config_file = cfg
        bar3.root = SimpleNamespace(wm_attributes=lambda *a: None)
        bar3._load_config()
        assert 'bossStyle' not in bar3.config
    passed += 1
    print("[PASS] 伪装风格数据完整性 / 切换 / 持久化 / 循环")

    # 15. 主题已并入伪装风格：蓝色主题下线，Alt+T 循环的是伪装皮
    assert 'vscode-blue' not in ThiefDesktopBar.THEMES, "经典蓝主题应已下线"
    assert list(ThiefDesktopBar.THEMES) == ['vscode-dark'], "只保留深色一套基础配色"
    with tempfile.TemporaryDirectory() as td:
        cfg = os.path.join(td, 'thief_bar_config.json')
        bar = make_bar()
        bar.config = {'bossStyle': 'git'}
        bar.width, bar.alpha, bar.theme_name = 860, 0.95, 'vscode-dark'
        bar.config_file = cfg
        bar._note_activity = lambda *a: None
        bar._update_display = lambda: None
        bar.is_boss_key = False
        bar.cycle_theme()
        ids = list(BOSS_STYLES)
        assert bar.config['bossStyle'] == ids[(ids.index('git') + 1) % len(ids)], "Alt+T 应切下一套伪装皮"
        assert bar._boss_style()['label'] == BOSS_STYLES[bar.config['bossStyle']]['label']

        # 旧配置里存着 vscode-blue 也要安全回落，不崩、不改写别的
        with open(cfg, 'w', encoding='utf-8') as f:
            json.dump({'theme': 'vscode-blue', 'barWidth': 700}, f)
        bar2 = make_bar()
        bar2.config_file = cfg
        bar2.root = SimpleNamespace(wm_attributes=lambda *a: None)
        bar2.theme_name = 'vscode-dark'
        bar2.theme = ThiefDesktopBar.THEMES['vscode-dark']
        bar2._load_config()
        assert bar2.theme_name == 'vscode-dark', "蓝色主题配置应回落到深色"
        assert bar2.theme == ThiefDesktopBar.THEMES['vscode-dark']
    passed += 1
    print("[PASS] 主题并入伪装风格 / 蓝色主题下线 / 旧配置回落")

    # 16. live 主题：系统监控 / 时钟走真实数据，其余仍是静态文案
    from thief_desktop_bar import SysSampler, _fmt_rate, CLOCK_WEATHER
    live_styles = {sid for sid, cfg in BOSS_STYLES.items() if cfg.get('live')}
    assert live_styles == {'sysmon', 'clock'}, live_styles
    assert all(BOSS_STYLES[s]['live'] in ('sysmon', 'clock') for s in live_styles)
    assert _fmt_rate(0) == '0B' and _fmt_rate(900) == '900B'
    assert _fmt_rate(1536) == '1.5K' and _fmt_rate(2 * 1048576) == '2.0M'
    assert _fmt_rate(None) == '0B'

    sampler = SysSampler()
    first = sampler.read()
    time.sleep(1.05)
    data = sampler.read()
    for key in ('cpu', 'mem', 'gpu', 'disk'):
        value = data.get(key)
        assert value is None or 0.0 <= value <= 100.0, (key, value)
    if data.get('proc') is not None:
        assert data['proc'] > 0
    assert data.get('net_down', 0) >= 0 and data.get('net_up', 0) >= 0
    assert first['mem'] is not None, "内存占用应该随时可读"

    # 伪装条上的渲染：用假采样器核对格式化与降级
    bar = make_bar()
    bar.config = {'bossStyle': 'sysmon'}
    bar.is_boss_key = True
    bar._hovering = False
    bar._update_display = lambda: None
    bar._sampler_inst = SimpleNamespace(read=lambda: {
        'cpu': 12.6, 'mem': 41.4, 'gpu': None, 'disk': 3.2, 'proc': 214,
        'net_down': 1.2 * 1048576, 'net_up': 0.3 * 1048576})
    parts = bar._live_disguise_parts('sysmon')
    assert parts['branch'] == 'CPU 13%', parts
    assert parts['text'] == '内存 41%  磁盘 3%  进程 214', parts
    assert parts['right'] == '↓ 1.2M ↑ 307.2K', parts   # 314KB 不足 1M，按 K 显示

    bar._sampler_inst = SimpleNamespace(read=lambda: {
        'cpu': 55.0, 'mem': 70.0, 'gpu': 9.4, 'disk': 1.0, 'proc': 300,
        'net_down': 2048, 'net_up': 512})
    parts = bar._live_disguise_parts('sysmon')
    assert parts['text'] == '内存 70%  GPU 9%  进程 300', parts
    assert parts['right'] == '↓ 2.0K ↑ 512B', parts

    class _Boom:
        def read(self):
            raise RuntimeError('boom')

    bar._sampler_inst = _Boom()
    assert bar._live_disguise_parts('sysmon') is None, "采样异常必须返回 None 走静态兜底"

    # 时钟：真实时间 + 写死的天气
    clock = bar._live_disguise_parts('clock')
    now = time.localtime()
    assert clock['branch'] == f"{now.tm_hour:02d}:{now.tm_min:02d}"
    assert f"{now.tm_mon:02d}/{now.tm_mday:02d}" in clock['text']
    assert CLOCK_WEATHER in clock['text']
    assert clock['right'] is None, "城市沿用风格里的静态值"
    assert bar._live_disguise_parts(None) is None
    passed += 1
    print("[PASS] live 主题真实采样 / 格式化 / 降级")

    print(f"\n全部 {passed} 项测试通过")


if __name__ == '__main__':
    main()
