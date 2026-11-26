#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
======================================================================================
ST-Thief-Desktop-Bar: 酒馆助手桌面原生双行摸鱼状态栏 (仿 VS Code Thief-Book)
======================================================================================
特点：
1. 零第三方依赖：纯 Python 原生标准库实现（tkinter + socket + threading）
2. 双行边看边回：
   - 第一行：正文阅读行，整段分屏翻阅（整句优先成屏），展示角色名与 屏x/y 进度
   - 第二行：单行回复行，输入框常驻就地输入，回车直接发送触发 AI
3. 鼠标随意拖拽：按住状态栏空白处即可拖拽移动位置，左右边缘拖拽缩放条宽
4. 阅读体验：自动阅读定时翻屏、Ctrl+滚轮缩放字号、贴边自动隐藏、重启恢复阅读位置
5. 全套快捷键：
   - 方向键 ← / → 或 J / K: 上一屏 / 下一屏
   - 鼠标滚轮: 上一屏 / 下一屏；Ctrl + 滚轮: 缩放字号 (8 ~ 12pt)
   - 点击正文: 翻到下一屏
   - Enter (输入框内): 发送回复并触发 AI 续写
   - Esc: 一键老板键（秒变纯净代码编译与 Git 状态）
   - Alt + Y: 同 Alt+T，循环切换主题
   - 无操作自动伪装: 设置里拖时间滑块，空闲达到时长自动切伪装（Esc 退出）
   - Alt + S: 触发重 roll (Swipe)
   - Alt + X: 中止 AI 生成
   - Alt + T: 切换主题（= 伪装风格，16 套，伪装中按了立刻换皮）
   - Alt + 1 ~ 9: 快速调整透明度 (15% ~ 100%)
======================================================================================
"""

import sys
import os
import time
import json
import ctypes
import queue
import socket
import select
import struct
import base64
import hashlib
from html import unescape
import hmac
import ipaddress
import secrets
import threading
import tkinter as tk
from tkinter import font as tkfont
from tkinter import simpledialog
import re
from urllib.parse import urlparse

WS_HOST = '127.0.0.1'
WS_PORT = 18899
MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
WS_MAX_PAYLOAD = 1024 * 1024
WS_HANDSHAKE_LIMIT = 8192
PID_FILENAME = 'thief_bar.pid'
# ---------------- 老板键伪装方案：条的外观 + 输入框占位文案 ----------------
# 分四组：开发工具 / 办公软件 / 影音 / 系统工具，越像平时就摆在那儿的界面越不显眼。
# 想加新风格：往这里塞一项即可（group 决定挂在菜单哪一组），菜单 / 快捷键 / 设置面板会自动带上它。
BOSS_GROUPS = [('dev', '开发工具'), ('office', '办公软件'), ('media', '影音播放'), ('system', '系统工具')]
BOSS_STYLES = {
    'vscode-ts': {
        'group': 'dev',
        'label': 'VS Code · TypeScript',
        'branch': '⎇ main*  ✓ 0 ⨉ 0',
        'text': 'TypeScript 5.4.5  UTF-8  LF  Ln 142, Col 8  Ready',
        'right': 'Ln 142, Col 8',
        'prefix': ' [webpack]',
        'reply': 'Compiled successfully in 1240 ms. Watching for file changes...',
    },
    'git': {
        'group': 'dev',
        'label': 'Git · 仓库状态',
        'branch': '⎇ feature/refactor ↑2',
        'text': "Your branch is ahead of 'origin/main' by 2 commits.",
        'right': '4 changed',
        'prefix': ' [git]',
        'reply': 'nothing to commit, working tree clean',
    },
    'maven': {
        'group': 'dev',
        'label': 'Maven · Java 构建',
        'branch': '⎇ main  JDK 17',
        'text': '[INFO] BUILD SUCCESS  Tests run: 214, Failures: 0',
        'right': '00:41 min',
        'prefix': ' [mvn]',
        'reply': '[INFO] Total time: 00:41 min  Finished at: 14:32:07',
    },
    'npm': {
        'group': 'dev',
        'label': 'npm · 单元测试',
        'branch': '⎇ main  node 20',
        'text': 'PASS service.spec.ts  42 passed, 42 total',
        'right': '42/42',
        'prefix': ' [npm]',
        'reply': '> jest --coverage --silent  Done in 3.29s. Watching for changes...',
    },
    'docker': {
        'group': 'dev',
        'label': 'Docker · 容器编排',
        'branch': '⎇ main  compose v2',
        'text': '[+] Running 6/6  Container app-api-1 Started',
        'right': '6/6',
        'prefix': ' [compose]',
        'reply': 'Attaching to app-api-1, app-worker-1, app-db-1',
    },
    'pytest': {
        'group': 'dev',
        'label': 'Python · pytest',
        'branch': '⎇ main  py 3.12',
        'text': 'tests/test_pipeline.py  128 passed in 6.42s',
        'right': '128 passed',
        'prefix': ' [pytest]',
        'reply': 'collected 128 items  ===== 128 passed, 4 warnings in 6.42s =====',
    },
    'ci': {
        'group': 'dev',
        'label': 'CI · 流水线',
        'branch': '⎇ main  ✓ pipeline',
        'text': 'Pipeline #4821  build ✓  test ✓  deploy in progress',
        'right': '3/4',
        'prefix': ' [ci]',
        'reply': 'Waiting for runner-07 to finish deploy stage...',
    },
    # ---------------------------- 办公软件 ----------------------------
    'word': {
        'group': 'office',
        'label': 'Word · 文档状态',
        'branch': '页面 3/7',
        'text': '字数 1,284   字符数 1,102   段落 46',
        'right': '100%',
        'prefix': ' 中文(中国)',
        'reply': '已保存到 OneDrive - 个人  自动保存已开启',
    },
    'excel': {
        'group': 'office',
        'label': 'Excel · 表格状态',
        'branch': 'Sheet1',
        'text': '平均值: 42.7    计数: 128    求和: 5,465',
        'right': '就绪',
        'prefix': ' 常规',
        'reply': '正在计算 (8 个处理器): 100%',
    },
    # ---------------------------- 影音播放 ----------------------------
    'lyric': {
        'group': 'media',
        'label': '音乐 · 桌面歌词',
        'branch': '♪',
        'text': '窗外的麻雀 在电线杆上多嘴',
        'right': '01:42 / 04:51',
        'prefix': ' [00:42.18]',
        'reply': '▶ 七里香 - 周杰伦   单曲循环',
    },
    'player': {
        'group': 'media',
        'label': '播放器 · 迷你进度',
        'branch': '▶',
        'text': '七里香 - 周杰伦   高品音质 · 本地文件',
        'right': '38%',
        'prefix': ' [播放中]',
        'reply': '下一首: 晴天 - 周杰伦 (04:29)',
    },
    # ---------------------------- 系统工具 ----------------------------
    'sysmon': {
        'group': 'system',
        'live': 'sysmon',      # 真实采样：CPU / 内存 / GPU / 磁盘 / 网络 / 进程数
        'label': '系统 · 性能监控',
        'branch': 'CPU 12%',
        'text': '内存 41%   磁盘 3%   进程 214',
        'right': '↓ 1.2M ↑ 0.3M',
        'prefix': ' [监控]',
        'reply': '采样间隔 1s  ·  无异常进程',
    },
    'download': {
        'group': 'system',
        'label': '下载 · 进度条',
        'branch': '⤓',
        'text': 'ubuntu-24.04.1-desktop.iso   8.4 MB/s   剩余 00:12:31',
        'right': '62%',
        'prefix': ' [下载中]',
        'reply': '目标文件夹: D:\\\\Downloads   同时下载 1 个任务',
    },
    'cloud': {
        'group': 'system',
        'label': '网盘 · 同步状态',
        'branch': '☁',
        'text': '已同步 2,431 个文件   最近更新 1 分钟前   无冲突',
        'right': '100%',
        'prefix': ' [OneDrive]',
        'reply': '同步完成  ·  下次自动同步 10 分钟后',
    },
    'ticker': {
        'group': 'system',
        'label': '行情 · 股票滚动',
        'branch': '行情',
        'text': '上证 3,142.68 +0.42%   深证 9,864.21 -0.18%   创业板 1,932.55 +0.91%',
        'right': '14:59',
        'prefix': ' ',
        'reply': '数据来源: 行情推送  ·  延迟 3s',
    },
    'clock': {
        'group': 'system',
        'live': 'clock',       # 时间/日期走系统本地时间，只有天气是写死的
        'label': '桌面 · 时钟天气',
        'branch': '14:59',
        'text': '周三 11/26   多云 18°C   湿度 62%   AQI 42',
        'right': '北京',
        'prefix': ' ',
        'reply': '今天 18°C / 9°C  ·  明日有小雨 记得带伞',
    },
}
# 时钟皮的天气部分是固定文案（没有联网取天气的打算），时间日期是真时间
CLOCK_WEATHER = '多云 18°C   湿度 62%   AQI 42'
DEFAULT_BOSS_STYLE = 'vscode-ts'
BOSS_PLACEHOLDERS = frozenset(cfg['reply'] for cfg in BOSS_STYLES.values())
BOSS_REPLY_TEXT = BOSS_STYLES[DEFAULT_BOSS_STYLE]['reply']   # 兼容旧名：默认风格的占位文案


try:
    from ctypes import wintypes as _wintypes
except Exception:      # 非 Windows 上只影响性能采样，其余功能照常
    _wintypes = None


class _PDH_FMT_COUNTERVALUE(ctypes.Structure):
    _fields_ = [('CStatus', _wintypes.DWORD), ('doubleValue', ctypes.c_double)]


class _PDH_FMT_ITEM_W(ctypes.Structure):
    _fields_ = [('szName', _wintypes.LPWSTR), ('FmtValue', _PDH_FMT_COUNTERVALUE)]


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [('dwLength', _wintypes.DWORD), ('dwMemoryLoad', _wintypes.DWORD),
                ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
                ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong),
                ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]


def _fmt_rate(bps):
    """字节/秒 → 1.2M 这种短写法。"""
    try:
        bps = float(bps)
    except (TypeError, ValueError):
        return '0B'
    if bps >= 1048576:
        return f"{bps / 1048576:.1f}M"
    if bps >= 1024:
        return f"{bps / 1024:.1f}K"
    return f"{bps:.0f}B"


class SysSampler:
    """性能监控主题的真实数据源：纯 ctypes，不引入 psutil / nvidia-smi。

    - CPU：GetSystemTimes 前后差值（含 idle，busy = total - idle）
    - 内存：GlobalMemoryStatusEx 的 dwMemoryLoad
    - GPU / 磁盘 / 网络 / 进程数：系统 PDH 计数器
        \\GPU Engine(*)\\Utilization Percentage      （只累加 engtype_3D 实例）
        \\PhysicalDisk(_Total)\\% Disk Time
        \\Network Interface(*)\\Bytes Received/sec / Bytes Sent/sec
        \\System\\Processes

    任何一项拿不到就返回 None，由调用方降级显示，绝不让伪装条崩掉。
    """

    PDH_FMT_DOUBLE = 0x00000200
    PDH_MORE_DATA = 0x800007D2   # 第一次问 size 时的正常返回码，不是错误
    NET_SKIP = ('loopback', 'pseudo-interface', 'isatap', 'teredo')

    def __init__(self):
        self._pdh = None
        self._query = None
        self._counters = {}
        self._cpu_prev = None
        self._arr_buf = None      # 复用数组缓冲：GPU Engine 实例上千个，每秒新建 160KB 太浪费
        self._last = {'gpu': None, 'disk': None, 'proc': None, 'net_down': 0.0, 'net_up': 0.0}

    # ---------------- PDH ----------------
    def _pdh_init(self):
        if _wintypes is None:
            return False
        try:
            pdh = ctypes.WinDLL('pdh')
            pdh.PdhOpenQueryW.argtypes = [_wintypes.LPCWSTR, ctypes.c_size_t,
                                          ctypes.POINTER(_wintypes.HANDLE)]
            pdh.PdhOpenQueryW.restype = _wintypes.DWORD
            pdh.PdhAddCounterW.argtypes = [_wintypes.HANDLE, _wintypes.LPCWSTR,
                                           ctypes.c_size_t, ctypes.POINTER(_wintypes.HANDLE)]
            pdh.PdhAddCounterW.restype = _wintypes.DWORD
            pdh.PdhCollectQueryData.argtypes = [_wintypes.HANDLE]
            pdh.PdhCollectQueryData.restype = _wintypes.DWORD
            pdh.PdhGetFormattedCounterValue.argtypes = [
                _wintypes.HANDLE, _wintypes.DWORD, ctypes.c_void_p,
                ctypes.POINTER(_PDH_FMT_COUNTERVALUE)]
            pdh.PdhGetFormattedCounterValue.restype = _wintypes.DWORD
            pdh.PdhGetFormattedCounterArrayW.argtypes = [
                _wintypes.HANDLE, _wintypes.DWORD, ctypes.POINTER(_wintypes.DWORD),
                ctypes.POINTER(_wintypes.DWORD), ctypes.c_void_p]
            pdh.PdhGetFormattedCounterArrayW.restype = _wintypes.DWORD

            query = _wintypes.HANDLE()
            if pdh.PdhOpenQueryW(None, 0, ctypes.byref(query)) != 0:
                return False
            self._pdh, self._query = pdh, query
            for key, path in (
                ('gpu', r'\GPU Engine(*)\Utilization Percentage'),
                ('disk', r'\PhysicalDisk(_Total)\% Disk Time'),
                ('net_in', r'\Network Interface(*)\Bytes Received/sec'),
                ('net_out', r'\Network Interface(*)\Bytes Sent/sec'),
                ('proc', r'\System\Processes'),
            ):
                handle = _wintypes.HANDLE()
                if pdh.PdhAddCounterW(self._query, path, 0, ctypes.byref(handle)) == 0:
                    self._counters[key] = handle
            return bool(self._counters)
        except Exception as err:
            print(f"[SysSampler] PDH 初始化失败: {err}", flush=True)
            self._pdh = None
            return False

    def _pdh_single(self, key):
        handle = self._counters.get(key)
        if handle is None:
            return None
        value = _PDH_FMT_COUNTERVALUE()
        if self._pdh.PdhGetFormattedCounterValue(
                handle, self.PDH_FMT_DOUBLE, None, ctypes.byref(value)) != 0:
            return None
        return float(value.doubleValue) if value.CStatus == 0 else None

    def _pdh_items(self, key):
        handle = self._counters.get(key)
        if handle is None:
            return None
        size, count = _wintypes.DWORD(0), _wintypes.DWORD(0)
        rc = self._pdh.PdhGetFormattedCounterArrayW(
            handle, self.PDH_FMT_DOUBLE, ctypes.byref(size), ctypes.byref(count), None)
        if rc not in (0, self.PDH_MORE_DATA) or not size.value:
            return None
        if self._arr_buf is None or len(self._arr_buf) < size.value:
            self._arr_buf = ctypes.create_string_buffer(size.value)
        buf = self._arr_buf
        rc = self._pdh.PdhGetFormattedCounterArrayW(
            handle, self.PDH_FMT_DOUBLE, ctypes.byref(size), ctypes.byref(count),
            ctypes.cast(buf, ctypes.c_void_p))
        if rc != 0:
            return None
        items = ctypes.cast(buf, ctypes.POINTER(_PDH_FMT_ITEM_W))
        out = []
        for i in range(count.value):
            if items[i].FmtValue.CStatus != 0:
                continue
            out.append((items[i].szName or '', float(items[i].FmtValue.doubleValue)))
        return out

    def _pdh_sum(self, key, only_3d=False):
        items = self._pdh_items(key)
        if items is None:
            return None
        total, seen = 0.0, False
        for name, value in items:
            low = name.lower()
            if only_3d and 'engtype_3d' not in low:
                continue
            if any(skip in low for skip in self.NET_SKIP):
                continue
            total += value
            seen = True
        return total if seen else None

    # ---------------- 单项采样 ----------------
    def _cpu(self):
        try:
            idle, kernel, user = _wintypes.FILETIME(), _wintypes.FILETIME(), _wintypes.FILETIME()
            if not ctypes.windll.kernel32.GetSystemTimes(
                    ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                return None

            def ticks(ft):
                return (ft.dwHighDateTime << 32) | ft.dwLowDateTime

            current = (ticks(idle), ticks(kernel) + ticks(user))
            previous, self._cpu_prev = self._cpu_prev, current
            if previous is None:
                return None
            d_idle = current[0] - previous[0]
            d_total = current[1] - previous[1]
            if d_total <= 0:
                return None
            return max(0.0, min(100.0, 100.0 * (1.0 - d_idle / d_total)))
        except Exception:
            return None

    @staticmethod
    def _mem():
        try:
            status = _MEMORYSTATUSEX()
            status.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return None
            return float(status.dwMemoryLoad)
        except Exception:
            return None

    def read(self):
        """返回一次完整采样；取不到的字段是 None，调用方降级显示。"""
        result = {'cpu': self._cpu(), 'mem': self._mem(),
                  'gpu': None, 'disk': None, 'proc': None,
                  'net_down': 0.0, 'net_up': 0.0}
        if self._pdh is None and not self._pdh_init():
            return result
        try:
            if self._pdh.PdhCollectQueryData(self._query) != 0:
                return result
        except Exception:
            return result

        gpu = self._pdh_sum('gpu', only_3d=True)
        if gpu is not None:
            self._last['gpu'] = max(0.0, min(100.0, gpu))
        disk = self._pdh_single('disk')
        if disk is not None:
            self._last['disk'] = max(0.0, min(100.0, disk))
        proc = self._pdh_single('proc')
        if proc is not None:
            self._last['proc'] = int(round(proc))
        down = self._pdh_sum('net_in')
        if down is not None:
            self._last['net_down'] = max(0.0, down)
        up = self._pdh_sum('net_out')
        if up is not None:
            self._last['net_up'] = max(0.0, up)

        result.update(self._last)
        return result


def _enable_dpi_awareness():
    # 必须在 tk.Tk() 之前：PER_MONITOR_AWARE_V2 让 Tk 按真实 DPI 渲染，避免高分屏/副屏被系统位图拉伸模糊
    if not sys.platform.startswith('win'):
        return
    import ctypes
    try:
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# ------------------------------------------------------------------------------------
# 零依赖轻量 RFC 6455 WebSocket 服务端实现
# ------------------------------------------------------------------------------------
class SimpleWebSocketServer:
    def __init__(self, host, port, on_message_callback, token='', allowed_origins=None, on_auth_callback=None):
        self.host = host
        self.port = port
        self.on_message = on_message_callback
        self.on_auth = on_auth_callback
        self.token = token
        self.allowed_origins = self._normalize_origins(allowed_origins or [])
        self.clients = {}  # sock -> {'authed': bool, 'queue': queue.Queue}；发送统一走队列，避免慢客户端拖住广播
        self.server_sock = None
        self.running = False
        self.lock = threading.Lock()

    @staticmethod
    def _normalize_origins(entries):
        out = set()
        for e in entries or []:
            if isinstance(e, str):
                e = e.strip().lower().rstrip('/')
                if e:
                    out.add(e)
        return out

    def set_allowed_origins(self, entries):
        """运行时替换白名单，保存后立即生效，不用重启服务端。"""
        self.allowed_origins = self._normalize_origins(entries)
        return self.allowed_origins

    def _origin_allowed(self, origin):
        # 浏览器 WS 不受 CORS 约束，必须自行挡掉公网页面：
        # 本地/私网/null(沙箱 iframe) 直接放行；其余必须命中白名单，最后由 hello token 把关。
        if not origin or origin == 'null':
            return True
        origin_norm = origin.strip().lower().rstrip('/')
        if '*' in self.allowed_origins:
            return True
        try:
            host = urlparse(origin_norm).hostname
        except Exception:
            return False
        if not host:
            return False
        if host == 'localhost':
            return True
        try:
            if ipaddress.ip_address(host).is_private:
                return True
        except ValueError:
            pass
        if origin_norm in self.allowed_origins:
            return True
        for entry in self.allowed_origins:
            if entry.startswith('*.'):
                suffix = entry[2:]
                if host == suffix or host.endswith('.' + suffix):
                    return True
        return False

    @staticmethod
    def _encode_text_frame(text):
        payload = text.encode('utf-8')
        length = len(payload)
        if length <= 125:
            header = bytes([0x81, length])
        elif length <= 65535:
            header = struct.pack(">BBH", 0x81, 126, length)
        else:
            header = struct.pack(">BBQ", 0x81, 127, length)
        return header + payload

    def _send_json(self, sock, data_dict):
        sock.sendall(self._encode_text_frame(json.dumps(data_dict, ensure_ascii=False)))

    def start(self):
        self.running = True
        t = threading.Thread(target=self._run_server, daemon=True)
        t.start()

    def _run_server(self):
        self.server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            self.server_sock.bind((self.host, self.port))
            self.server_sock.listen(5)
            print(f"[WebSocket Server] 正在监听 ws://{self.host}:{self.port}", flush=True)
        except Exception as e:
            print(f"[WebSocket Server] 端口绑定失败: {e}", flush=True)
            return

        while self.running:
            try:
                rlist, _, _ = select.select([self.server_sock], [], [], 1.0)
                if not rlist:
                    continue
                client_sock, addr = self.server_sock.accept()
                threading.Thread(target=self._handle_client, args=(client_sock,), daemon=True).start()
            except Exception:
                break

    def _handle_client(self, sock):
        authenticated = False
        try:
            sock.settimeout(5)
            req = b""
            while b"\r\n\r\n" not in req:
                chunk = sock.recv(1024)
                if not chunk:
                    return
                req += chunk
                if len(req) > WS_HANDSHAKE_LIMIT:
                    return

            headers = {}
            lines = req.decode('utf-8', errors='ignore').split("\r\n")
            for line in lines[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

            if not self._origin_allowed(headers.get('origin')):
                print(f"[WebSocket Server] 拒绝非本地来源: {headers.get('origin')}", flush=True)
                return

            sec_key = headers.get('sec-websocket-key')
            if not sec_key:
                sock.close()
                return

            accept_val = base64.b64encode(
                hashlib.sha1((sec_key + MAGIC_GUID).encode('utf-8')).digest()
            ).decode('utf-8')

            resp = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_val}\r\n\r\n"
            )
            sock.sendall(resp.encode('utf-8'))

            with self.lock:
                self.clients[sock] = {'authed': False, 'queue': queue.Queue(maxsize=256)}
            print("[WebSocket Server] 客户端已连接，等待 hello 认证...", flush=True)

            sock.settimeout(10)
            while self.running:
                head = sock.recv(2)
                if not head or len(head) < 2:
                    break
                b1, b2 = head[0], head[1]
                opcode = b1 & 0x0F
                masked = (b2 & 0x80) != 0
                payload_len = b2 & 0x7F

                if opcode == 0x8:
                    break
                elif opcode == 0x9:
                    # 认证后发送统一由 sender 线程负责，pong 也走队列，避免两线程交错写帧
                    info = self.clients.get(sock)
                    if authenticated and info is not None:
                        try:
                            info['queue'].put_nowait(b"\x8a\x00")
                        except queue.Full:
                            break
                    else:
                        sock.sendall(b"\x8a\x00")
                    continue

                if payload_len == 126:
                    payload_len = struct.unpack(">H", sock.recv(2))[0]
                elif payload_len == 127:
                    payload_len = struct.unpack(">Q", sock.recv(8))[0]

                if payload_len > WS_MAX_PAYLOAD:
                    print("[WebSocket Server] 帧超过 1MB 上限，断开连接", flush=True)
                    break

                masks = sock.recv(4) if masked else None
                payload = b""
                while len(payload) < payload_len:
                    chunk = sock.recv(payload_len - len(payload))
                    if not chunk:
                        break
                    payload += chunk

                if masked and masks:
                    decoded = bytearray(payload)
                    for i in range(len(decoded)):
                        decoded[i] ^= masks[i % 4]
                    payload = bytes(decoded)

                if opcode == 0x1:
                    try:
                        text = payload.decode('utf-8')
                        if not authenticated:
                            data = json.loads(text)
                            token = data.get('token')
                            if (data.get('action') == 'hello' and isinstance(token, str)
                                    and hmac.compare_digest(token.encode('utf-8'), self.token.encode('utf-8'))):
                                authenticated = True
                                with self.lock:
                                    info = self.clients.get(sock)
                                    if info is not None:
                                        info['authed'] = True
                                sock.settimeout(None)
                                # hello_ok 必须先于 sender 线程启动发出，保证帧顺序
                                self._send_json(sock, {'action': 'hello_ok'})
                                threading.Thread(target=self._client_sender, args=(sock,), daemon=True).start()
                                print("[WebSocket Server] 酒馆助手前端认证成功！", flush=True)
                                if self.on_auth:
                                    try:
                                        self.on_auth()
                                    except Exception:
                                        pass
                            else:
                                self._send_json(sock, {'action': 'hello_fail'})
                                print("[WebSocket Server] hello 认证失败，断开连接", flush=True)
                                break
                            continue
                        self.on_message(text)
                    except Exception as err:
                        print(f"[WebSocket Server] 解析消息异常: {err}")

        except Exception:
            pass
        finally:
            self._drop_client(sock)
            print("[WebSocket Server] 客户端连接断开")

    def _drop_client(self, sock):
        with self.lock:
            info = self.clients.pop(sock, None)
        if info is not None:
            try:
                info['queue'].put_nowait(None)  # 唤醒 sender 线程退出
            except queue.Full:
                pass
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            sock.close()
        except Exception:
            pass

    @staticmethod
    def _send_frame_with_timeout(sock, frame, timeout=5.0):
        # 接收线程在同一个 sock 上阻塞 recv，不能用 settimeout（会互相影响），改用 select 控制发送时限
        deadline = time.monotonic() + timeout
        view = memoryview(frame)
        while len(view) > 0:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            try:
                _, wlist, _ = select.select([], [sock], [], remaining)
                if not wlist:
                    return False
                sent = sock.send(view)
                if sent <= 0:
                    return False
                view = view[sent:]
            except Exception:
                return False
        return True

    def _client_sender(self, sock):
        while self.running:
            info = self.clients.get(sock)
            if info is None:
                break
            try:
                frame = info['queue'].get(timeout=0.5)
            except queue.Empty:
                continue
            if frame is None:
                break
            if not self._send_frame_with_timeout(sock, frame):
                self._drop_client(sock)
                break

    def broadcast(self, data_dict):
        frame = self._encode_text_frame(json.dumps(data_dict, ensure_ascii=False))
        queued = False
        stalled = []
        with self.lock:
            for sock, info in self.clients.items():
                if not info['authed']:
                    continue
                try:
                    info['queue'].put_nowait(frame)
                    queued = True
                except queue.Full:
                    stalled.append(sock)
        # 慢客户端积压超过 256 帧直接断开，避免拖累其他客户端。
        for sock in stalled:
            self._drop_client(sock)
        return queued


# ------------------------------------------------------------------------------------
# 桌面原生双行摸鱼状态栏 GUI
# ------------------------------------------------------------------------------------
class ThiefDesktopBar:
    # 条的基础配色只有这一套（原来的"经典蓝"主题已并入伪装风格，见 BOSS_STYLES）
    THEMES = {
        'vscode-dark': {
            'bg': '#181818',
            'row2_bg': '#141414',
            'fg': '#cccccc',
            'border': '#2b2b2b',
            'char': '#4ec9b0',
            'input_bg': '#222222',
            'input_fg': '#ffffff',
            'accent': '#007acc'
        }
    }

    def __init__(self):
        _enable_dpi_awareness()
        self.root = tk.Tk()
        self.root.title("VS Code Status Bar")

        self.root.overrideredirect(True)
        self.root.wm_attributes("-topmost", True)
        self.root.protocol("WM_DELETE_WINDOW", self.root.quit)
        self.alpha = 0.95
        self.root.wm_attributes("-alpha", self.alpha)

        self.theme_name = 'vscode-dark'
        self.theme = self.THEMES[self.theme_name]
        self.char_name = "AI"
        self.user_name = "User"
        self.current_sentence = "等待酒馆助手连接... (请在酒馆中启用 ST-Thief-Book 脚本)"
        self.cur_idx = 1
        self.total_sentences = 1
        self.floor = 0
        self._chat_id = None
        self.is_boss_key = False
        self.is_generating = False
        self._generation_status = ('idle', None, 'idle')
        self._generation_hint = ''
        self._generation_hint_job = None
        self._can_retry_generation = False
        self.reply_choices = ()
        self._choices_window = None
        self._ime_composing = False
        self._ime_confirm_until = 0
        self.stream_text = ''
        self._has_full_text = False
        self._reading_offset = 0
        self._pages = []
        self._page_idx = 0
        self._floor_request_id = 0
        self._pending_floor_step = None
        self._pending_floor_job = None
        self._queued_navigation = None
        self._hovering = False
        self._auto_read_job = None
        self._idle_job = None
        self._last_activity = time.monotonic()
        self._pos_save_job = None
        self._resume_floor = None
        self._resume_offset = None
        self._resume_chat_id = None
        self._legacy_width = None
        self._synced_once = False
        self._dock_edge = None
        self._dock_pos = None
        self._hidden = False
        self._slide_job = None
        self._hide_job = None
        self.config = {
            'charNameMode': 'compact',
            'wrapMode': 'wrap',
            'minimalMode': False,
            'layoutMode': 'double',
            'enableWhitelist': True,
            'tagWhitelist': [
                'content', 'output', 'response', 'dialogue', 'story', 'reply', 'text', 'narration', 'message', '正文'
            ],
            'tagBlacklist': [
                'think', 'thought', 'cot', 'scratchpad', 'reasoning', 'analysis', 'plan',
                'internal_monologue', 'system_note', 'thought_process', 'thinking',
                'status', 'bbi_image', 'fox_hugou', 'fox_selc', 'fox_tip', 'so_seq', 'details'
            ],
            'showUserMessages': False,
            'filterActions': False,
            'filterMode': 'pure',
            'pagedReading': True,
            'fontSize': 9,
            'chinesePunctuation': False,
            'autoReadSec': 0,
            'autoHide': False,
            'autoBossSec': 0,
            'bossStyle': DEFAULT_BOSS_STYLE
        }

        self.width = 860
        self.height = 68
        self.bridge_token = ''
        try:
            self.config_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "thief_bar_config.json")
        except Exception:
            self.config_file = os.path.join(os.path.expanduser("~"), ".st_thief_bar_config.json")
        self._load_config()
        self._load_or_create_bridge_token()
        self._resume_pos = self._load_position()
        self._saved_window_position = self._load_window_position()

        self.font_main = tkfont.Font(family="Microsoft YaHei UI", size=self.config.get('fontSize', 9))
        self.font_bold = tkfont.Font(family="Microsoft YaHei UI", size=9, weight="bold")
        self.font_mono = tkfont.Font(family="Consolas", size=9)

        self._drag_start_x = 0
        self._drag_start_y = 0
        self._drag_offset_x = 0
        self._drag_offset_y = 0
        self._has_dragged = False
        self._is_resizing = False
        self._resize_mode = None
        self._resize_start_x = 0
        self._resize_start_w = self.width
        self._resize_start_win_x = 0

        self._setup_ui()
        x, y = self._initial_window_position()
        self._update_geometry_and_wrap(override_x=x, override_y=y)
        self._bind_events()

        self.server = SimpleWebSocketServer(
            WS_HOST, WS_PORT, self._on_ws_message, token=self.bridge_token,
            allowed_origins=self.config.get('allowedOrigins', []),
            on_auth_callback=self._on_ws_authed
        )
        self.server.start()
        if self.server.allowed_origins:
            print(f"[WebSocket Server] 额外放行来源: {', '.join(sorted(self.server.allowed_origins))}", flush=True)
        self._restart_auto_read()
        self._start_idle_watch()
        self.root.after(600, self._eval_dock)

    def _load_config(self):
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                    if isinstance(saved, dict):
                        if 'barWidth' in saved and isinstance(saved['barWidth'], (int, float)):
                            self.width = max(360, min(3840, int(saved['barWidth'])))
                        if 'alpha' in saved and isinstance(saved['alpha'], (int, float)):
                            self.alpha = max(0.15, min(1.0, float(saved['alpha'])))
                            self.root.wm_attributes("-alpha", self.alpha)
                        if 'theme' in saved and saved['theme'] in self.THEMES:
                            self.theme_name = saved['theme']
                            self.theme = self.THEMES[self.theme_name]
                        for k in ['minimalMode', 'layoutMode', 'charNameMode', 'wrapMode',
                                  'showUserMessages', 'enableWhitelist',
                                  'filterActions', 'filterMode', 'allowedOrigins', 'pagedReading', 'autoHide']:
                            if k in saved:
                                self.config[k] = saved[k]
                        if isinstance(saved.get('chinesePunctuation'), bool):
                            self.config['chinesePunctuation'] = saved['chinesePunctuation']
                        self._merge_sync_config({k: saved.get(k) for k in ('tagWhitelist', 'tagBlacklist')})
                        fs = self._clamp_font_size(saved.get('fontSize'))
                        if fs is not None:
                            self.config['fontSize'] = fs
                        sec = saved.get('autoReadSec')
                        if isinstance(sec, int) and not isinstance(sec, bool) and 0 <= sec <= 60:
                            self.config['autoReadSec'] = sec
                        idle_sec = self._clamp_auto_boss(saved.get('autoBossSec'))
                        if idle_sec is not None:
                            self.config['autoBossSec'] = idle_sec
                        if saved.get('bossStyle') in BOSS_STYLES:
                            self.config['bossStyle'] = saved['bossStyle']
        except Exception as e:
            print(f"[Load Config Error]: {e}", flush=True)

    def _load_or_create_bridge_token(self):
        # 密钥独立于 config 存放：config 会进 git，密钥不能跟着泄露
        self.token_file = os.path.join(os.path.dirname(self.config_file), 'thief_bar_bridge.token')
        try:
            if os.path.exists(self.token_file):
                with open(self.token_file, 'r', encoding='utf-8') as f:
                    self.bridge_token = f.read().strip()
        except Exception:
            pass
        if not self.bridge_token:
            self.bridge_token = secrets.token_hex(16)
            try:
                self._atomic_write_text(self.token_file, self.bridge_token)
            except Exception as err:
                print(f"[Bridge Token] 写入密钥文件失败（本次会话仍可使用）: {err}", flush=True)

    @staticmethod
    def _atomic_write_text(path, text):
        tmp = path + '.tmp'
        # newline='\n'：Windows 上也不要把 LF 变成 CRLF，否则每次保存都整文件 diff
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)

    @classmethod
    def _atomic_write_json(cls, path, data):
        cls._atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2))

    def _save_config(self):
        data = {
            'barWidth': self.width,
            'alpha': self.alpha,
            'theme': self.theme_name,
            'minimalMode': self.config.get('minimalMode', False),
            'layoutMode': self.config.get('layoutMode', 'double'),
            'charNameMode': self.config.get('charNameMode', 'compact'),
            'wrapMode': self.config.get('wrapMode', 'wrap'),
            'showUserMessages': self.config.get('showUserMessages', False),
            'enableWhitelist': self.config.get('enableWhitelist', True),
            'tagWhitelist': self.config.get('tagWhitelist', []),
            'tagBlacklist': self.config.get('tagBlacklist', []),
            'filterActions': self.config.get('filterActions', False),
            'filterMode': self.config.get('filterMode', 'pure'),
            'allowedOrigins': self.config.get('allowedOrigins', []),
            'pagedReading': self.config.get('pagedReading', True),
            'fontSize': self.config.get('fontSize', 9),
            'chinesePunctuation': self.config.get('chinesePunctuation', False),
            'autoReadSec': self.config.get('autoReadSec', 0),
            'autoHide': self.config.get('autoHide', False),
            'autoBossSec': self.config.get('autoBossSec', 0),
            'bossStyle': self.config.get('bossStyle', DEFAULT_BOSS_STYLE)
        }
        try:
            self._atomic_write_json(self.config_file, data)
        except Exception:
            try:
                home_cfg = os.path.join(os.path.expanduser("~"), ".st_thief_bar_config.json")
                self._atomic_write_json(home_cfg, data)
                self.config_file = home_cfg
            except Exception as err:
                print(f"[Save Config Error]: {err}", flush=True)

    # ---------------- 阅读位置记忆 ----------------
    @staticmethod
    def _validate_position(data):
        if not isinstance(data, dict):
            return None
        f, c, o = data.get('floor'), data.get('curIdx'), data.get('pageOffset')
        for v, lo, hi in ((f, 0, 100000), (c, 1, 100000), (o, 0, 10000000)):
            if isinstance(v, bool) or not isinstance(v, int) or not (lo <= v <= hi):
                return None
        pos = {'floor': f, 'curIdx': c, 'pageOffset': o}
        chat_id = data.get('chatId')
        if isinstance(chat_id, str) and 0 < len(chat_id) <= 512:
            pos['chatId'] = chat_id
        return pos

    def _position_file(self):
        return os.path.join(os.path.dirname(self.config_file), 'thief_bar_position.json')

    def _load_position(self):
        try:
            with open(self._position_file(), 'r', encoding='utf-8') as f:
                return self._validate_position(json.load(f))
        except Exception:
            return None

    def _window_position_file(self):
        return os.path.join(os.path.dirname(self.config_file), 'thief_bar_window_position.json')

    def _load_window_position(self):
        try:
            with open(self._window_position_file(), 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            return None
        if isinstance(data, dict):
            x, y = data.get('x'), data.get('y')
            if all(type(n) is int and abs(n) <= 1_000_000 for n in (x, y)):
                return x, y
        return None

    def _initial_window_position(self):
        if self._saved_window_position is None:
            return (max(0, (self.root.winfo_screenwidth() - self.width) // 2),
                    max(0, self.root.winfo_screenheight() - self.height - 45))
        x, y = self._saved_window_position
        left, top, right, bottom = self._monitor_rect((x, y, x + self.width, y + self.height))
        if min(x + self.width, right) - max(x, left) < min(self.width, 80):
            x = max(left, min(x, right - self.width))
        if min(y + self.height, bottom) - max(y, top) < min(self.height, 12):
            y = max(top, min(y, bottom - self.height))
        return x, y

    def _save_window_position(self):
        if not self.root.winfo_ismapped():
            return
        if self._dock_pos is not None and (self._hidden or self._slide_job is not None):
            position = self._dock_pos
        else:
            position = (self.root.winfo_x(), self.root.winfo_y())
        if position == self._saved_window_position:
            return
        x, y = position
        try:
            self._atomic_write_json(self._window_position_file(), {'x': x, 'y': y})
        except OSError as err:
            print(f"[Save Window Position] {err}")
            return
        self._saved_window_position = position

    def _schedule_position_save(self):
        if self._pos_save_job is None:
            self._pos_save_job = self.root.after(350, self._save_position_now)

    def _save_position_now(self):
        self._pos_save_job = None
        # 握手中的临时首屏不能覆盖磁盘上已保存的位置。
        if not self._synced_once or self._resume_offset is not None:
            return
        pos = self._current_position()
        if pos is None or pos == self._resume_pos:
            return
        try:
            self._atomic_write_json(self._position_file(), pos)
        except OSError as err:
            print(f"[Save Reading Position] {err}")
            return
        self._resume_pos = pos

    def _current_position(self):
        offset = self._reading_offset if self.config.get('pagedReading', True) else 0
        return self._validate_position({
            'floor': self.floor, 'curIdx': self.cur_idx, 'pageOffset': offset, 'chatId': self._chat_id
        })

    def _on_ws_authed(self):
        # WS 客户端线程回调：只做向 GUI 线程的 marshaling
        self.root.after(0, self._request_resume)

    def _request_resume(self):
        self.server.broadcast({'action': 'set_window_width', 'barWidth': self.width})
        if self._synced_once and self._resume_offset is None:
            if self._pos_save_job is not None:
                self.root.after_cancel(self._pos_save_job)
            self._save_position_now()
        pos = self._resume_pos if self._resume_offset is not None or not self._synced_once else self._current_position()
        if not pos:
            return
        resume = {'action': 'resume', 'floor': pos['floor'], 'curIdx': pos['curIdx']}
        if 'chatId' in pos:
            resume['chatId'] = pos['chatId']
        if self.server.broadcast(resume):
            self._resume_floor = pos['floor']
            self._resume_offset = pos['pageOffset']
            self._resume_chat_id = pos.get('chatId')

    def _clear_pending_resume(self):
        self._resume_floor = None
        self._resume_offset = None
        self._resume_chat_id = None

    def _setup_ui(self):
        self.container = tk.Frame(self.root, bg=self.theme['bg'])
        self.container.pack(fill=tk.BOTH, expand=True)

        # ----------------- 第一行：正文阅读行 -----------------
        self.row1 = tk.Frame(self.container, bg=self.theme['bg'])
        self.row1.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # 1.1 左侧 Git 分支与楼层导航器
        self.left_frame = tk.Frame(self.row1, bg=self.theme['bg'])
        self.left_frame.pack(side=tk.LEFT, padx=(8, 4))

        self.lbl_branch = tk.Label(
            self.left_frame, text="⎇ main*", font=self.font_mono,
            bg=self.theme['bg'], fg='#858585'
        )
        self.lbl_branch.pack(side=tk.LEFT)

        # 楼层导航交互胶囊: [▲] [#0 ▾] [▼]
        self.floor_frame = tk.Frame(self.left_frame, bg="#252526", bd=1, relief=tk.SOLID)
        self.floor_frame.pack(side=tk.LEFT, padx=(6, 2))

        self.btn_floor_prev = tk.Button(
            self.floor_frame, text="▲", font=self.font_mono,
            bg="#252526", fg=self.theme['fg'], activebackground=self.theme['bg'],
            activeforeground=self.theme['fg'], cursor="hand2", padx=3, pady=0,
            relief=tk.FLAT, bd=0, highlightthickness=0, command=self.action_floor_prev
        )
        self.btn_floor_prev.pack(side=tk.LEFT)

        self.lbl_floor = tk.Label(
            self.floor_frame, text="#0 ▾", font=self.font_mono,
            bg="#252526", fg="#9cdcfe", cursor="hand2", padx=4
        )
        self.lbl_floor.pack(side=tk.LEFT)
        self.lbl_floor.bind("<Button-1>", lambda e: self.open_floor_jump_dialog())

        self.btn_floor_next = tk.Button(
            self.floor_frame, text="▼", font=self.font_mono,
            bg="#252526", fg=self.theme['fg'], activebackground=self.theme['bg'],
            activeforeground=self.theme['fg'], cursor="hand2", padx=3, pady=0,
            relief=tk.FLAT, bd=0, highlightthickness=0, command=self.action_floor_next
        )
        self.btn_floor_next.pack(side=tk.LEFT)

        # 1.2 右侧状态 & 按钮 (精简为紧凑阅读进度徽章 + 菜单按钮 ⋮，全部按钮收纳至右键菜单，留出最大正文阅读视口)
        self.right_frame = tk.Frame(self.row1, bg=self.theme['bg'])
        self.right_frame.pack(side=tk.RIGHT, padx=(4, 8))

        self.lbl_right_info = tk.Label(
            self.right_frame, text="1/1", font=self.font_mono,
            bg="#252526", fg="#9cdcfe", padx=5, pady=1, cursor="hand2"
        )
        self.lbl_right_info.pack(side=tk.LEFT, padx=(0, 4))
        self.lbl_right_info.bind("<Button-1>", lambda e: self.open_floor_jump_dialog())

        self.btn_menu = tk.Label(
            self.right_frame, text="⋮", font=self.font_bold,
            bg=self.theme['bg'], fg="#cccccc", cursor="hand2", padx=4
        )
        self.btn_menu.pack(side=tk.LEFT)
        self.btn_menu.bind("<Button-1>", self._popup_menu_from_btn)

        # 1.3 中间正文阅读：窗口分配正文视口，文字长度不参与布局
        self.center_frame = tk.Frame(self.row1, bg=self.theme['bg'])
        self.center_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=8)
        self.center_frame.pack_propagate(False)

        self.lbl_char = tk.Label(
            self.center_frame, text="[ST]:", font=self.font_bold,
            bg="#1e2e28", fg=self.theme['char'], cursor="hand2", padx=5, pady=0
        )
        self.lbl_char.pack(side=tk.LEFT, padx=(0, 6))
        self.lbl_char.bind("<Button-1>", lambda e: self.cycle_char_name_mode())

        self.lbl_text = tk.Label(
            self.center_frame, text=self.current_sentence, font=self.font_main,
            bg=self.theme['bg'], fg=self.theme['fg'], anchor="w", cursor="hand2",
            justify=tk.LEFT, padx=0, bd=0, highlightthickness=0
        )
        self.lbl_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.lbl_text.bind("<ButtonPress-1>", self._start_drag)
        self.lbl_text.bind("<B1-Motion>", self._on_drag)
        self.lbl_text.bind("<ButtonRelease-1>", self._on_text_click_release)
        self.lbl_text.bind("<Configure>", self._on_text_configure)

        self.btn_generation = tk.Label(self.row1, font=self.font_main, bg=self.theme['bg'], padx=4)
        self.btn_generation.bind("<Button-1>", self._on_generation_click)
        self.btn_choices = tk.Button(
            self.row1, text="选项", font=self.font_main, padx=4, pady=0, bd=0,
            bg=self.theme['bg'], fg=self.theme['accent'], cursor="hand2",
            highlightthickness=0, command=self.open_reply_choices
        )

        # ----------------- 第二行：单行快捷回复行 -----------------
        self.row2 = tk.Frame(self.container, bg=self.theme['row2_bg'], height=31)
        self.row2.pack(side=tk.BOTTOM, fill=tk.X, padx=0, pady=0)

        self.lbl_prefix = tk.Label(
            self.row2, text=" >", font=self.font_mono,
            bg=self.theme['row2_bg'], fg='#9cdcfe', padx=6
        )
        self.lbl_prefix.pack(side=tk.LEFT)

        self.entry_reply = tk.Entry(
            self.row2, font=self.font_main,
            bg=self.theme['input_bg'], fg=self.theme['input_fg'],
            insertbackground=self.theme['fg'], relief=tk.FLAT, bd=2
        )
        self.entry_reply.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6), pady=4)
        self.entry_reply.bind("<Return>", self._on_reply_return)
        self.entry_reply.bind("<KP_Enter>", self._on_reply_return)
        self._chinese_punctuation = tk.BooleanVar(value=self.config.get('chinesePunctuation', False))
        self.entry_reply.bind("<KeyPress>", self._on_reply_key)
        self.entry_reply.bind("<Button-3>", self._popup_reply_menu)
        self._watch_reply_ime()

        self.btn_send = tk.Label(
            self.row2, text="发送", font=self.font_main,
            bg='#0e639c', fg='#ffffff', cursor="hand2", padx=8, pady=1
        )
        self.btn_send.pack(side=tk.RIGHT, padx=(0, 8))
        self.btn_send.bind("<Button-1>", lambda e: self._submit_reply())

        # 初始化布局与极简模式
        self._apply_layout_and_mode()

    def _set_boss_chrome_extra(self, disguised):
        """楼层导航（▲ #12 ▾）和 ⋮ 菜单按钮都是阅读态的东西，伪装时必须藏掉——
        假的状态栏里冒出翻页箭头，一眼就看穿了。右键菜单不受影响（全窗口都绑了 Button-3）。"""
        floor = getattr(self, 'floor_frame', None)
        menu_btn = getattr(self, 'btn_menu', None)
        if disguised:
            if floor is not None and floor.winfo_manager():
                floor.pack_forget()
            if menu_btn is not None and menu_btn.winfo_manager():
                menu_btn.pack_forget()
        else:
            if floor is not None and not floor.winfo_manager():
                floor.pack(side=tk.LEFT, padx=(6, 2))
            if menu_btn is not None and not menu_btn.winfo_manager():
                menu_btn.pack(side=tk.LEFT)

    def _ensure_boss_chrome(self):
        """伪装时强制显示状态栏零件。
        极简模式平时把左右两翼和前缀都藏了（纯正文最不显眼），但假的"系统状态条/歌词条"
        恰恰靠左右两翼才像真的，所以只在这时候临时放出来，退出伪装再还原。"""
        if not (self.left_frame.winfo_manager() and self.right_frame.winfo_manager()):
            self.center_frame.pack_forget()
            self.left_frame.pack(side=tk.LEFT, padx=(8, 4))
            self.right_frame.pack(side=tk.RIGHT, padx=(4, 8))
            self.center_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=8)
            self._boss_chrome_forced = True
        self._set_boss_chrome_extra(True)
        if (self.row2.winfo_manager() and self.entry_reply.winfo_manager()
                and not self.lbl_prefix.winfo_manager()):
            self.lbl_prefix.pack(side=tk.LEFT, before=self.entry_reply)
            self._boss_chrome_forced = True

    def _apply_layout_and_mode(self):
        is_min = self.config.get('minimalMode', False)
        is_single = self.config.get('layoutMode', 'double') == 'single'

        if is_min:
            # 极简模式：纯粹只显示背景与正文，无分支、无胶囊、无角色名、无多余按钮
            self.left_frame.pack_forget()
            self.right_frame.pack_forget()
            self.lbl_char.pack_forget()

            self.center_frame.pack_forget()
            self.center_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(12, 12))

            if is_single:
                self.row2.pack_forget()
                self.height = 30
            else:
                self.row2.pack(side=tk.BOTTOM, fill=tk.X)
                self.lbl_prefix.pack_forget()
                self.btn_send.pack_forget()
                self.entry_reply.pack_forget()
                self.entry_reply.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(10, 10), pady=(0, 4))
                self.height = 56
        else:
            # 标准 VS Code 模式
            self.center_frame.pack_forget()
            self.left_frame.pack(side=tk.LEFT, padx=(8, 4))
            self.right_frame.pack(side=tk.RIGHT, padx=(4, 8))
            self.center_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=8)

            if is_single:
                self.row2.pack_forget()
                self.height = 36
            else:
                self.row2.pack(side=tk.BOTTOM, fill=tk.X)
                self.lbl_prefix.pack_forget()
                self.lbl_prefix.pack(side=tk.LEFT)
                self.entry_reply.pack_forget()
                self.entry_reply.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6), pady=4)
                self.btn_send.pack_forget()
                self.btn_send.pack(side=tk.RIGHT, padx=(0, 8))
                self.height = 68

        self._update_geometry_and_wrap()

    def _apply_narrow_chrome(self):
        """标准模式条很窄时，把分支名和角色名收起来，宽度让给正文；拉宽后自动还原。"""
        if self.config.get('minimalMode', False):
            return
        narrow = self.width < 560
        if narrow:
            self.lbl_branch.pack_forget()
        elif not self.lbl_branch.winfo_manager():
            self.lbl_branch.pack(side=tk.LEFT, before=self.floor_frame)

        show_char = (not narrow and self.config.get('charNameMode', 'compact') != 'hidden'
                     and self.lbl_char.winfo_reqwidth() <= self.width // 2)
        if not show_char:
            self.lbl_char.pack_forget()
        elif not self.lbl_char.winfo_manager():
            self.lbl_char.pack(side=tk.LEFT, padx=(0, 6), before=self.lbl_text)

    # ---------------- 分页（整句优先，超宽按条宽硬切） ----------------
    STRONG_BREAKS = set("。！？!?…；\n")
    TRAILING_PUNCT = set("。！？!?…；\n，,、；;：:\"'”』」）)")

    def _stream(self):
        return getattr(self, 'stream_text', '') or self.current_sentence

    @staticmethod
    def _accumulate_stream(parts, prev_floor, new_floor, cur_i, sentence):
        """旧版单句载荷拼段：换楼层/回到首句重新开始；同句刷新文本，新句按序插入。
        返回 (parts, 当前句在整段中的字符偏移)。"""
        if new_floor != prev_floor or cur_i <= 1 or not parts:
            parts = [(cur_i, sentence)]
        elif any(k == cur_i for k, _ in parts):
            parts = [(k, sentence if k == cur_i else seg) for k, seg in parts]
        else:
            parts = sorted(parts + [(cur_i, sentence)], key=lambda kv: kv[0])
        offset = sum(len(seg) for k, seg in parts if k < cur_i)
        return parts, offset

    def _compute_pages(self, text, width):
        """把整条消息切成若干屏：先尽量填满宽度；本屏内若有句末标点就自然断在那儿
        （所以自然分段的一屏可以不填满）；没有标点就按宽度硬切，断点始终跟着条宽走。"""
        pages = []
        n = len(text)
        if n == 0:
            return [(0, 0)]
        i = 0
        while i < n:
            end = max(i + 1, self._fitting_end(text, i, width))
            if end < n:
                # ① 本屏内有句末标点 -> 断在句末（自然分段，不必填满）
                cut = -1
                for pos in range(end, i, -1):
                    if text[pos - 1] in self.STRONG_BREAKS:
                        cut = pos
                        break
                if cut > 0:
                    end = cut
                elif (end > i + 1 and text[end] in self.TRAILING_PUNCT
                      and self.font_main.measure(text[end - 1:end + 1]) <= width):
                    # 标点放不下时，把前一个字也移到下一屏。
                    end -= 1
                elif not text[end - 1].isspace() and not text[end].isspace():
                    # 附近有词间空格时，把本来会从中间切开的词移到下一屏。
                    lookback = max(i + 1, end - max(4, (end - i) // 4))
                    for pos in range(end - 1, lookback - 1, -1):
                        if text[pos - 1].isspace() and not text[pos].isspace():
                            end = pos
                            break
            pages.append((i, end))
            i = end
        return pages

    def _page_start_offset(self):
        if not getattr(self, '_pages', None):
            return 0
        idx = max(0, min(self._page_idx, len(self._pages) - 1))
        return self._pages[idx][0]

    def _page_index_for_offset(self, offset):
        pages = getattr(self, '_pages', None) or [(0, 0)]
        for i, (a, b) in enumerate(pages):
            if a <= offset < max(b, a + 1):
                return i
        return len(pages) - 1

    def _render_page(self):
        text = self._stream()
        pages = getattr(self, '_pages', None) or [(0, len(text))]
        a, b = pages[max(0, min(self._page_idx, len(pages) - 1))]
        self.lbl_text.configure(text=text[a:b], wraplength=0, justify=tk.LEFT)

    def _has_more_pages(self):
        return bool(getattr(self, '_pages', None)) and self._page_idx < len(self._pages) - 1

    def _has_prev_pages(self):
        return bool(getattr(self, '_pages', None)) and self._page_idx > 0

    def _progress_text(self):
        base = f"{self.cur_idx}/{self.total_sentences}"
        pages = getattr(self, '_pages', None) or []
        if self.config.get('pagedReading', True) and len(pages) > 1:
            idx = max(0, min(self._page_idx, len(pages) - 1))
            digits = len(str(len(pages)))
            return f"{base} 屏{idx + 1:>{digits}}/{len(pages)}"
        return base

    def toggle_paged_reading(self):
        self.config['pagedReading'] = not self.config.get('pagedReading', True)
        self._save_config()
        self._update_display()
        self.flash_hint("已切换为整段分屏" if self.config['pagedReading'] else "已切换为逐句截断")

    def _truncate_to_width(self, text, max_px):
        """关闭分屏时的单行截断：预留省略号宽度，超出部分以'…'结尾。"""
        if not text:
            return ""
        if self.font_main.measure(text) <= max_px:
            return text
        ellipsis = '…'
        if self.font_main.measure(ellipsis) > max_px:
            return ""
        end = self._fitting_end(text, 0, max_px, suffix=ellipsis)
        return text[:end].rstrip() + ellipsis

    def _fitting_end(self, text, start, width, suffix=''):
        low, high = start, min(len(text), start + 32)
        while self.font_main.measure(text[start:high] + suffix) <= width:
            if high == len(text):
                return high
            low, high = high, min(len(text), start + 2 * (high - start))
        while low <= high:
            mid = (low + high) // 2
            if self.font_main.measure(text[start:mid] + suffix) <= width:
                low = mid + 1
            else:
                high = mid - 1
        return high

    def _update_geometry_and_wrap(self, override_x=None, override_y=None):
        if not hasattr(self, 'lbl_text') or not self.lbl_text.winfo_exists():
            return

        is_min = self.config.get('minimalMode', False)
        is_single = self.config.get('layoutMode', 'double') == 'single'

        # 高度恒定：永远单个文字行
        if is_min:
            self.height = 30 if is_single else 56
        else:
            self.height = 36 if is_single else 68

        # 保持当前绝对坐标（支持多显示器、副屏负坐标与超宽坐标，绝不发生跨屏漂移）
        # 窗口尚未映射时 winfo_x/y 恒为 0，此时改写几何会把 __init__ 的初始定位冲掉
        if override_x is None and override_y is None and not self.root.winfo_ismapped():
            return
        cur_x = override_x if override_x is not None else self.root.winfo_x()
        cur_y = override_y if override_y is not None else self.root.winfo_y()

        geo = f"{self.width}x{self.height}+{cur_x}+{cur_y}"
        if getattr(self, '_last_geometry', None) != geo:
            self._last_geometry = geo
            self.root.geometry(geo)

    def _on_text_configure(self, event):
        if event.width == getattr(self, '_label_w_last', 0):
            return
        self._label_w_last = event.width
        if getattr(self, '_resize_job', None) is None:
            self._resize_job = self.root.after_idle(self._on_viewport_changed)

    def _on_viewport_changed(self):
        self._resize_job = None
        if not self.is_boss_key:
            self._update_reading_view()

    def _cmd(self, func, *args, **kwargs):
        def _handler():
            if getattr(self, 'context_menu', None):
                try:
                    self.context_menu.unpost()
                except Exception:
                    pass
            func(*args, **kwargs)
        return _handler

    def _build_style_menu(self, parent, with_cycle=True):
        """主题 = 伪装风格：按「开发 / 办公 / 影音 / 系统」分组列出 16 套皮肤。"""
        menu = tk.Menu(
            parent,
            tearoff=0,
            bg="#1e1e1e",
            fg="#cccccc",
            activebackground="#094771",
            activeforeground="#ffffff",
            font=self.font_main,
            bd=1,
            relief=tk.SOLID
        )
        cur_style_id = self._boss_style_id()
        for group_id, group_label in BOSS_GROUPS:
            members = [(sid, cfg) for sid, cfg in BOSS_STYLES.items() if cfg.get('group') == group_id]
            if not members:
                continue
            group_menu = tk.Menu(
                menu,
                tearoff=0,
                bg="#1e1e1e",
                fg="#cccccc",
                activebackground="#094771",
                activeforeground="#ffffff",
                font=self.font_main,
                bd=1,
                relief=tk.SOLID
            )
            for style_id, style_cfg in members:
                mark = "✓ " if style_id == cur_style_id else "   "
                group_menu.add_command(
                    label=f"{mark}{style_cfg['label']}",
                    command=self._cmd(lambda s=style_id: self.set_boss_style(s))
                )
            in_group = any(sid == cur_style_id for sid, _ in members)
            menu.add_cascade(
                label=f"{'✓ ' if in_group else '   '}{group_label} ({len(members)})",
                menu=group_menu
            )
        if with_cycle:
            menu.add_separator()
            menu.add_command(label="下一个主题", accelerator="Alt+T",
                             command=self._cmd(self.cycle_theme))
        return menu

    def _setup_context_menu(self):
        self.context_menu = tk.Menu(
            self.root,
            tearoff=0,
            bg="#1e1e1e",
            fg="#cccccc",
            activebackground="#094771",
            activeforeground="#ffffff",
            font=self.font_main,
            bd=1,
            relief=tk.SOLID
        )

        is_min = self.config.get('minimalMode', False)
        is_single = self.config.get('layoutMode', 'double') == 'single'
        is_privacy = self.config.get('privacyMode', False)
        show_user = self.config.get('showUserMessages', False)

        # 1. 核心模式切换 (简洁勾选标记，杜绝花俏图标)
        mark_min = "✓ " if is_min else "   "
        self.context_menu.add_command(
            label=f"{mark_min}极简模式",
            accelerator="已开启" if is_min else "",
            command=self._cmd(self.toggle_minimal_mode)
        )

        mark_privacy = "✓ " if is_privacy else "   "
        self.context_menu.add_command(
            label=f"{mark_privacy}隐私模式 (悬停显示)",
            accelerator="已开启" if is_privacy else "",
            command=self._cmd(self.toggle_privacy_mode)
        )

        mark_layout = "   " if is_single else "✓ "
        self.context_menu.add_command(
            label=f"{mark_layout}双行布局 (含回复框)",
            accelerator="单行" if is_single else "双行",
            command=self._cmd(self.toggle_layout_mode)
        )

        self.context_menu.add_separator()

        # 2. 阅读与生成控制 (文字清爽简明，快捷键右对齐)
        self.context_menu.add_command(label="上一句", accelerator="←", command=self._cmd(self.action_prev))
        self.context_menu.add_command(label="下一句", accelerator="→", command=self._cmd(self.action_next))
        label = "重试生成" if self._can_retry_generation else "重新生成"
        self.context_menu.add_command(label=label, accelerator="Alt+S", command=self._cmd(self.action_swipe))
        if self.is_generating:
            self.context_menu.add_command(label="中止生成", accelerator="Alt+X", command=self._cmd(self.action_stop))
        if self.reply_choices and not self.is_boss_key:
            self.context_menu.add_command(label="查看回复选项", command=self._cmd(self.open_reply_choices))

        self.context_menu.add_separator()

        # 3. 楼层导航
        self.context_menu.add_command(label="上一楼", accelerator="PageUp", command=self._cmd(self.action_floor_prev))
        self.context_menu.add_command(label="下一楼", accelerator="PageDown", command=self._cmd(self.action_floor_next))
        self.context_menu.add_command(
            label="跳转楼层...",
            accelerator=f"#{self.floor}",
            command=self._cmd(self.open_floor_jump_dialog)
        )

        self.context_menu.add_separator()

        # 4. 显示与外观设置
        mark_paged = "✓ " if self.config.get('pagedReading', True) else "   "
        self.context_menu.add_command(
            label=f"{mark_paged}整段分屏阅读",
            command=self._cmd(self.toggle_paged_reading)
        )

        # 窗口长度调整子菜单
        width_menu = tk.Menu(
            self.context_menu,
            tearoff=0,
            bg="#1e1e1e",
            fg="#cccccc",
            activebackground="#094771",
            activeforeground="#ffffff",
            font=self.font_main,
            bd=1,
            relief=tk.SOLID
        )
        width_menu.add_command(label="自适应文本长度", accelerator="Ctrl+↑", command=self._cmd(self.auto_fit_text_length))
        width_menu.add_command(label="增加宽度 (+100px)", accelerator="Ctrl+→", command=self._cmd(lambda: self.change_window_width(100)))
        width_menu.add_command(label="减小宽度 (-100px)", accelerator="Ctrl+←", command=self._cmd(lambda: self.change_window_width(-100)))
        width_menu.add_separator()
        width_presets = [
            ("480px (紧凑)", 480),
            ("680px (标准)", 680),
            ("860px (舒适)", 860),
            ("1080px (宽屏)", 1080),
            ("1360px (超宽)", 1360)
        ]
        for name, val in width_presets:
            mark = "✓ " if abs(self.width - val) <= 15 else "   "
            width_menu.add_command(label=f"{mark}{name}", command=self._cmd(lambda v=val: self.set_window_width(v)))
        width_menu.add_separator()
        width_menu.add_command(label="自定义长度...", command=self._cmd(self.open_custom_width_dialog))
        self.context_menu.add_cascade(label=f"窗口长度 ({self.width}px)", menu=width_menu)

        # 窗口透明度子菜单
        opacity_menu = tk.Menu(
            self.context_menu,
            tearoff=0,
            bg="#1e1e1e",
            fg="#cccccc",
            activebackground="#094771",
            activeforeground="#ffffff",
            font=self.font_main,
            bd=1,
            relief=tk.SOLID
        )
        cur_pct = int(round(self.alpha * 100))
        presets = [
            ("100% (不透明)", 1.0, "Alt+9"),
            ("90%", 0.9, ""),
            ("80%", 0.8, "Alt+8"),
            ("70%", 0.7, "Alt+7"),
            ("50% (半透明)", 0.5, "Alt+5"),
            ("30%", 0.3, "Alt+3"),
            ("15% (极淡)", 0.15, "Alt+1")
        ]
        for name, val, sc in presets:
            mark = "✓ " if abs(cur_pct - int(round(val * 100))) <= 3 else "   "
            opacity_menu.add_command(
                label=f"{mark}{name}",
                accelerator=sc,
                command=self._cmd(lambda v=val: self.set_opacity(v))
            )
        opacity_menu.add_separator()
        opacity_menu.add_command(label="自定义透明度...", command=self._cmd(self.open_custom_opacity_dialog))
        self.context_menu.add_cascade(label=f"窗口透明度 ({cur_pct}%)", menu=opacity_menu)

        mark_user = "✓ " if show_user else "   "
        self.context_menu.add_command(
            label=f"{mark_user}显示用户消息",
            command=self._cmd(self.toggle_show_user_messages)
        )

        self.context_menu.add_cascade(
            label=f"主题 · {BOSS_STYLES[self._boss_style_id()]['label']}",
            menu=self._build_style_menu(self.context_menu)
        )

        if not is_min:
            char_mode = self.config.get('charNameMode', 'compact')
            char_desc = "精简" if char_mode == 'compact' else ("隐藏" if char_mode == 'hidden' else "完整")
            self.context_menu.add_command(
                label="角色名模式",
                accelerator=char_desc,
                command=self._cmd(self.cycle_char_name_mode)
            )

        self.context_menu.add_separator()

        # 5. 系统控制与设置
        cur_style_id = self._boss_style_id()
        boss_menu = tk.Menu(
            self.context_menu,
            tearoff=0,
            bg="#1e1e1e",
            fg="#cccccc",
            activebackground="#094771",
            activeforeground="#ffffff",
            font=self.font_main,
            bd=1,
            relief=tk.SOLID
        )
        boss_menu.add_command(
            label="退出伪装" if self.is_boss_key else "进入伪装",
            accelerator="Esc",
            command=self._cmd(self.toggle_boss)
        )
        # 主题（= 伪装风格）已并入上一级「主题」菜单，这里不再重复一份
        top_label = "老板键 · 退出伪装" if self.is_boss_key else "老板键 · 进入伪装"
        self.context_menu.add_cascade(label=top_label, menu=boss_menu)
        boss_sec = self._auto_boss_seconds()
        idle_menu = tk.Menu(
            self.context_menu,
            tearoff=0,
            bg="#1e1e1e",
            fg="#cccccc",
            activebackground="#094771",
            activeforeground="#ffffff",
            font=self.font_main,
            bd=1,
            relief=tk.SOLID
        )
        self._auto_boss_var = tk.IntVar(value=boss_sec)
        for sec, label in [(0, "关闭"), (30, "30 秒无操作"), (60, "1 分钟无操作"),
                           (180, "3 分钟无操作"), (300, "5 分钟无操作")]:
            idle_menu.add_radiobutton(
                label=label,
                variable=self._auto_boss_var,
                value=sec,
                command=self._cmd(lambda s=sec: self.set_auto_boss(s))
            )
        idle_menu.add_separator()
        idle_menu.add_command(label="时间滑块...", command=self._cmd(self.open_auto_boss_dialog))
        idle_menu.add_command(label="自动伪装诊断...", command=self._cmd(self.open_idle_diag_dialog))
        if boss_sec:
            boss_state = self._auto_boss_state()
            tail = {
                'due': "待触发",
                'suspended': "已挂起(设置窗开着)",
                'hovering': "鼠标在条上",
                'disguised': "伪装中",
            }.get(boss_state['phase'], f"还剩 {int(round(boss_state['remaining']))}s")
            idle_label = f"无操作自动伪装 ({self._fmt_sec(boss_sec)} · {tail})"
        else:
            idle_label = "无操作自动伪装 (关)"
        self.context_menu.add_cascade(label=idle_label, menu=idle_menu)
        mark_hide = "✓ " if self.config.get('autoHide', False) else "   "
        self.context_menu.add_command(
            label=f"{mark_hide}贴边自动隐藏",
            command=self._cmd(self.toggle_auto_hide)
        )
        auto_menu = tk.Menu(
            self.context_menu,
            tearoff=0,
            bg="#1e1e1e",
            fg="#cccccc",
            activebackground="#094771",
            activeforeground="#ffffff",
            font=self.font_main,
            bd=1,
            relief=tk.SOLID
        )
        self._auto_read_var = tk.IntVar(value=self.config.get('autoReadSec', 0))
        for sec, label in [(0, "关闭"), (3, "每 3 秒翻屏"), (5, "每 5 秒翻屏"), (8, "每 8 秒翻屏")]:
            auto_menu.add_radiobutton(
                label=label,
                variable=self._auto_read_var,
                value=sec,
                command=self._cmd(lambda s=sec: self.set_auto_read(s))
            )
        auto_label = f"自动阅读 ({self.config.get('autoReadSec', 0)}s)" if self.config.get('autoReadSec', 0) > 0 else "自动阅读 (关)"
        self.context_menu.add_cascade(label=auto_label, menu=auto_menu)
        self.context_menu.add_command(
            label="设置...",
            command=self._cmd(self.open_settings_dialog)
        )
        self.context_menu.add_command(
            label="复制桥接密钥 (填入网页端设置)",
            command=self._cmd(self.copy_bridge_token)
        )
        origins = self.config.get('allowedOrigins', [])
        self.context_menu.add_command(
            label=(f"远程酒馆来源白名单… ({len(origins)} 条)" if origins else "远程酒馆来源白名单… (仅本地)"),
            command=self._cmd(self.edit_allowed_origins)
        )
        self.context_menu.add_separator()
        self.context_menu.add_command(
            label="退出",
            command=self._cmd(self.root.quit)
        )

    def _show_context_menu(self, x, y):
        if getattr(self, 'context_menu', None):
            try:
                self.context_menu.unpost()
            except Exception:
                pass
        self._setup_context_menu()
        try:
            self.context_menu.tk_popup(x, y)
        finally:
            try:
                self.context_menu.grab_release()
            except Exception:
                pass

    def _popup_menu_from_btn(self, event):
        x = self.btn_menu.winfo_rootx() - 150
        y = self.btn_menu.winfo_rooty() + self.btn_menu.winfo_height() + 2
        self._show_context_menu(x, y)
        return "break"

    def _popup_context_menu(self, event):
        if event.widget == self.entry_reply:
            return "break"
        self._show_context_menu(event.x_root, event.y_root)
        return "break"

    def _bind_context_menu_recursive(self, widget):
        if widget != self.entry_reply:
            widget.bind("<Button-3>", self._popup_context_menu)
        for child in widget.winfo_children():
            self._bind_context_menu_recursive(child)

    def _bind_events(self):
        self._setup_context_menu()
        self._bind_context_menu_recursive(self.root)
        self._bind_mouse_drag_and_motion(self.root)

        self.root.bind("<MouseWheel>", self._on_mousewheel)

        reading_keys = {
            "<Right>": self.action_next,
            "<Left>": self.action_prev,
            "<k>": self.action_next,
            "<K>": self.action_next,
            "<j>": self.action_prev,
            "<J>": self.action_prev,
            "<Prior>": self.action_floor_prev,
            "<Next>": self.action_floor_next,
            "<Control-Right>": lambda: self.change_window_width(100),
            "<Control-Left>": lambda: self.change_window_width(-100),
            "<Control-Up>": self.auto_fit_text_length,
        }
        for sequence, action in reading_keys.items():
            self.root.bind(sequence, lambda event, command=action: self._reading_shortcut(event, command))
        self.root.bind("<Escape>", self._on_boss_shortcut)

        self.root.bind("<Alt-s>", lambda e: self.action_swipe())
        self.root.bind("<Alt-S>", lambda e: self.action_swipe())
        self.root.bind("<Alt-x>", lambda e: self.action_stop())
        self.root.bind("<Alt-X>", lambda e: self.action_stop())
        self.root.bind("<Alt-t>", lambda e: self.cycle_theme())
        self.root.bind("<Alt-T>", lambda e: self.cycle_theme())
        self.root.bind("<Alt-y>", lambda e: self.cycle_boss_style())
        self.root.bind("<Alt-Y>", lambda e: self.cycle_boss_style())

        for n in range(1, 10):
            self.root.bind(f"<Alt-Key-{n}>", lambda e, val=n: self.set_opacity(val / 10.0))

        self.root.bind("<Enter>", self._on_window_enter)
        self.root.bind("<Leave>", self._on_window_leave)

    def _reading_shortcut(self, event, command):
        if event.widget is not self.entry_reply:
            command()
            return "break"
        return None

    def _on_window_enter(self, event=None):
        self._hovering = True
        self._cancel_slide()
        self._auto_hide_reveal()
        if self.config.get('privacyMode', False) and not self.is_boss_key:
            self.root.wm_attributes("-alpha", self.alpha)

    def _on_window_leave(self, event=None):
        self._hovering = False
        self._schedule_auto_hide()
        if self.config.get('privacyMode', False) and not self.is_boss_key:
            self.root.after(80, self._check_privacy_mouse_leave)

    def _check_privacy_mouse_leave(self):
        if not self.config.get('privacyMode', False) or self.is_boss_key:
            return
        try:
            x = self.root.winfo_pointerx()
            y = self.root.winfo_pointery()
            wx = self.root.winfo_rootx()
            wy = self.root.winfo_rooty()
            w = self.root.winfo_width()
            h = self.root.winfo_height()
            if not (wx <= x <= wx + w and wy <= y <= wy + h):
                self.root.wm_attributes("-alpha", 0.01)
            else:
                self.root.wm_attributes("-alpha", self.alpha)
        except Exception:
            self.root.wm_attributes("-alpha", 0.01)

    def _bind_mouse_drag_and_motion(self, widget):
        excluded_from_drag = {
            getattr(self, 'entry_reply', None),
            getattr(self, 'btn_floor_prev', None),
            getattr(self, 'lbl_floor', None),
            getattr(self, 'btn_floor_next', None),
            getattr(self, 'lbl_right_info', None),
            getattr(self, 'btn_menu', None),
            getattr(self, 'lbl_char', None),
            getattr(self, 'btn_send', None),
            self.btn_generation,
            self.btn_choices
        }
        if widget != getattr(self, 'entry_reply', None):
            widget.bind("<Motion>", self._on_mouse_motion)
            widget.bind("<Leave>", self._on_mouse_leave)

        if widget not in excluded_from_drag:
            widget.bind("<ButtonPress-1>", self._start_drag)
            widget.bind("<B1-Motion>", self._on_drag)
            if widget == getattr(self, 'lbl_text', None):
                widget.bind("<ButtonRelease-1>", self._on_text_click_release)
            else:
                widget.bind("<ButtonRelease-1>", self._on_drag_release)

        for child in widget.winfo_children():
            self._bind_mouse_drag_and_motion(child)

    def _on_mouse_motion(self, event):
        if self.config.get('privacyMode', False) and not self.is_boss_key:
            self.root.wm_attributes("-alpha", self.alpha)

        rel_x = event.x_root - self.root.winfo_x()
        if rel_x <= 12 or rel_x >= self.width - 12:
            self.root.configure(cursor="size_we")
            if event.widget != getattr(self, 'entry_reply', None):
                try:
                    event.widget.configure(cursor="size_we")
                except Exception:
                    pass
        else:
            self.root.configure(cursor="")
            if event.widget != getattr(self, 'entry_reply', None):
                try:
                    if event.widget in (
                        getattr(self, 'lbl_text', None), getattr(self, 'lbl_char', None),
                        getattr(self, 'btn_floor_prev', None), getattr(self, 'btn_floor_next', None),
                        getattr(self, 'lbl_floor', None), getattr(self, 'lbl_right_info', None),
                        getattr(self, 'btn_menu', None), getattr(self, 'btn_send', None)
                    ):
                        event.widget.configure(cursor="hand2")
                    else:
                        event.widget.configure(cursor="")
                except Exception:
                    pass

    def _on_mouse_leave(self, event):
        if not getattr(self, '_is_resizing', False):
            self.root.configure(cursor="")
        if self.config.get('privacyMode', False) and not self.is_boss_key:
            self.root.after(60, self._check_privacy_mouse_leave)

    def _start_drag(self, event):
        if event.widget == getattr(self, 'entry_reply', None):
            return
        win_x = self.root.winfo_x()
        rel_x = event.x_root - win_x
        if rel_x <= 12:
            self._is_resizing = True
            self._resize_mode = 'left'
            self._resize_start_x = event.x_root
            self._resize_start_w = self.width
            self._resize_start_win_x = win_x
        elif rel_x >= self.width - 12:
            self._is_resizing = True
            self._resize_mode = 'right'
            self._resize_start_x = event.x_root
            self._resize_start_w = self.width
        else:
            self._is_resizing = False
            self._resize_mode = None
            self._drag_start_x = event.x_root
            self._drag_start_y = event.y_root
            self._drag_offset_x = event.x_root - win_x
            self._drag_offset_y = event.y_root - self.root.winfo_y()
            self._has_dragged = False

    def _on_drag(self, event):
        if event.widget == getattr(self, 'entry_reply', None):
            return
        if getattr(self, '_is_resizing', False):
            if self._resize_mode == 'right':
                delta = event.x_root - self._resize_start_x
                new_w = max(360, min(3840, self._resize_start_w + delta))
                if new_w != self.width:
                    self.width = new_w
                    self._update_display()
            elif self._resize_mode == 'left':
                delta = event.x_root - self._resize_start_x
                new_w = max(360, min(3840, self._resize_start_w - delta))
                new_x = self._resize_start_win_x + (self._resize_start_w - new_w)
                if new_w != self.width or new_x != self.root.winfo_x():
                    self.width = new_w
                    self._update_geometry_and_wrap(override_x=new_x)
                    self._update_display()
            return

        dx = abs(event.x_root - getattr(self, '_drag_start_x', event.x_root))
        dy = abs(event.y_root - getattr(self, '_drag_start_y', event.y_root))
        if dx > 3 or dy > 3:
            self._has_dragged = True
            self._cancel_slide()
            new_x = event.x_root - self._drag_offset_x
            new_y = event.y_root - self._drag_offset_y
            # 边界钳制：窗口无边框且不进任务栏/Alt+Tab，被拖出屏幕就再也找不回来
            try:
                import ctypes as _ct
                _g = _ct.windll.user32.GetSystemMetrics
                _vx, _vy, _vw, _vh = _g(76), _g(77), _g(78), _g(79)
                _keep = 80
                new_x = min(max(new_x, _vx - self.width + _keep), _vx + _vw - _keep)
                new_y = min(max(new_y, _vy - self.height + 12), _vy + _vh - 12)
            except Exception:
                pass
            self.root.geometry(f"+{new_x}+{new_y}")

    def _on_drag_release(self, event):
        moved = self._is_resizing or self._has_dragged
        if getattr(self, '_is_resizing', False):
            self._is_resizing = False
            self._resize_mode = None
            self._save_window_width()
        if moved:
            self.root.after_idle(self._save_window_position)
        self._has_dragged = False
        self._eval_dock()

    def _on_text_click_release(self, event):
        if self._is_resizing or self._has_dragged:
            self._on_drag_release(event)
            return
        if not self.is_boss_key:
            self.lbl_text.focus_set()
            self.action_next()

    def set_window_width(self, w):
        width = max(360, min(3840, int(w)))
        if width == self.width:
            return
        self.width = width
        self._update_display()
        self._save_window_width()

    def _save_window_width(self):
        self._save_config()
        self.server.broadcast({
            'action': 'set_window_width',
            'barWidth': self.width
        })

    def change_window_width(self, delta):
        self.set_window_width(self.width + delta)

    def auto_fit_text_length(self):
        if self.is_boss_key or self._hidden:
            return
        text = self.current_sentence.strip()
        if self.config.get('pagedReading', True):
            stream = self._stream()
            start = self._page_start_offset()
            breaks = self.STRONG_BREAKS | {'.', ';'}
            end = next((i + 1 for i in range(start, len(stream)) if stream[i] in breaks), len(stream))
            text = stream[start:end].strip() or text
        if not text:
            return
        text_width = self.font_main.measure(text)
        self.root.update_idletasks()
        left, _, right, _ = self._monitor_rect()
        max_width = min(3840, right - left)
        if max_width < 360:
            return
        old_width, x = self.width, self.root.winfo_x()
        # 跨过窄条阈值时，分支、角色名和进度会重新占位。
        for _ in range(3):
            occupied = self.root.winfo_width() - self.lbl_text.winfo_width()
            target = min(max_width, max(360, text_width + occupied + 8))
            self.width = target
            self._apply_narrow_chrome()
            self._update_geometry_and_wrap(override_x=max(left, min(x, right - target)))
            self.root.update_idletasks()
            if self.lbl_text.winfo_width() >= text_width or target == max_width:
                break
        if self.width != old_width:
            self._save_window_width()
        self._eval_dock()

    def open_custom_width_dialog(self):
        if self.is_boss_key:
            return
        win = tk.Toplevel(self.root)
        win.title("调整状态栏长度")
        win.geometry("340x140")
        win.configure(bg="#1e1e1e")
        win.wm_attributes("-topmost", True)
        try:
            wx = self.root.winfo_x() + 80
            wy = max(20, self.root.winfo_y() - 150)
            win.geometry(f"+{wx}+{wy}")
        except Exception:
            pass

        lbl_title = tk.Label(
            win, text=f"📏 调整摸鱼条长度 (当前: {self.width}px)",
            font=self.font_bold, bg="#1e1e1e", fg="#4ec9b0"
        )
        lbl_title.pack(anchor="w", padx=14, pady=(12, 6))

        scale = tk.Scale(
            win, from_=360, to=3840, orient=tk.HORIZONTAL,
            bg="#1e1e1e", fg="#cccccc", activebackground="#0e639c",
            highlightthickness=0, troughcolor="#2b2b2b", bd=0,
            command=lambda val: [
                lbl_title.configure(text=f"📏 调整摸鱼条长度 (当前: {val}px)"),
                self.set_window_width(int(val))
            ]
        )
        scale.set(self.width)
        scale.pack(fill=tk.X, padx=14, pady=4)

        btn_frame = tk.Frame(win, bg="#1e1e1e")
        btn_frame.pack(fill=tk.X, padx=14, pady=(6, 8))
        tk.Button(
            btn_frame, text="✨ 自动适应当前文字", command=lambda: [self.auto_fit_text_length(), scale.set(self.width)],
            bg="#252526", fg="#9cdcfe", bd=0, padx=8, pady=3, cursor="hand2"
        ).pack(side=tk.LEFT)
        tk.Button(
            btn_frame, text="确定", command=win.destroy,
            bg="#0e639c", fg="#ffffff", bd=0, padx=14, pady=3, cursor="hand2"
        ).pack(side=tk.RIGHT)

    def toggle_minimal_mode(self):
        if self.is_boss_key:
            return
        self.config['minimalMode'] = not self.config.get('minimalMode', False)
        self._apply_layout_and_mode()
        self._update_display()
        self._save_config()
        self.server.broadcast({
            'action': 'toggle_minimal_mode',
            'minimalMode': self.config['minimalMode']
        })

    def toggle_privacy_mode(self):
        if self.is_boss_key:
            return
        self.config['privacyMode'] = not self.config.get('privacyMode', False)
        self._save_config()
        if not self.config['privacyMode']:
            self.root.wm_attributes("-alpha", self.alpha)
        else:
            self.root.after(50, self._check_privacy_mouse_leave)
        self.server.broadcast({
            'action': 'update_config',
            'config': {'privacyMode': self.config['privacyMode']}
        })
        hint = "👻 隐私模式: 已开启 (移开隐藏)" if self.config['privacyMode'] else "👁️ 隐私模式: 已关闭 (常驻显示)"
        self.flash_hint(hint)

    def toggle_layout_mode(self):
        if self.is_boss_key:
            return
        cur = self.config.get('layoutMode', 'double')
        self.config['layoutMode'] = 'single' if cur == 'double' else 'double'
        self._apply_layout_and_mode()
        self._update_display()
        self._save_config()
        self.server.broadcast({
            'action': 'toggle_layout_mode',
            'layoutMode': self.config['layoutMode']
        })

    def open_custom_opacity_dialog(self):
        if self.is_boss_key:
            return
        win = tk.Toplevel(self.root)
        win.title("设置透明度")
        win.geometry("320x140")
        win.configure(bg="#1e1e1e")
        win.wm_attributes("-topmost", True)
        try:
            wx = self.root.winfo_x() + 100
            wy = max(20, self.root.winfo_y() - 150)
            win.geometry(f"+{wx}+{wy}")
        except Exception:
            pass

        tk.Label(
            win, text=f"🌓 调整状态栏透明度 (当前: {int(round(self.alpha * 100))}%)",
            font=self.font_bold, bg="#1e1e1e", fg="#4ec9b0"
        ).pack(anchor="w", padx=14, pady=(12, 6))

        scale = tk.Scale(
            win, from_=10, to=100, orient=tk.HORIZONTAL,
            bg="#1e1e1e", fg="#cccccc", activebackground="#0e639c",
            highlightthickness=0, troughcolor="#2b2b2b", bd=0,
            command=lambda val: self.set_opacity(int(val) / 100.0)
        )
        scale.set(int(round(self.alpha * 100)))
        scale.pack(fill=tk.X, padx=14, pady=4)

        btn_box = tk.Frame(win, bg="#1e1e1e")
        btn_box.pack(fill=tk.X, padx=14, pady=(6, 10))

        tk.Button(
            btn_box, text="完成", bg="#0e639c", fg="#ffffff",
            bd=0, padx=14, pady=2, cursor="hand2", command=win.destroy
        ).pack(side=tk.RIGHT)

    def _on_mousewheel(self, event):
        if self.is_boss_key or not event.delta or event.widget is self.entry_reply:
            return
        if self.root.winfo_containing(event.x_root, event.y_root) is self.entry_reply:
            return
        if event.state & 0x0004:  # Ctrl+滚轮：缩放正文字号
            self._zoom_font(1 if event.delta > 0 else -1)
            return
        if event.delta < 0:
            self.action_next()
        else:
            self.action_prev()

    @staticmethod
    def _clamp_font_size(value):
        # 上限 12pt：恒定高度（最小 30px）在高 DPI 下也放得下
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return max(8, min(12, int(value)))

    def _zoom_font(self, step):
        cur = self.config.get('fontSize', 9)
        new = self._clamp_font_size(cur + step)
        if new == cur:
            return
        self.config['fontSize'] = new
        self.font_main.configure(size=new)
        self._pfx_key = None  # 字号变了，像素测量全部失效，强制重新分屏
        self._save_config()
        self._update_display()
        self.flash_hint(f"🔠 正文字号: {new}pt（Ctrl+滚轮调节，8~12）")

    def set_auto_read(self, sec):
        self.config['autoReadSec'] = sec
        self._save_config()
        self._restart_auto_read()
        self.flash_hint(f"▶ 自动阅读: 每{sec}秒翻屏（悬停/伪装/生成中暂停）" if sec > 0 else "⏸ 自动阅读: 已关闭")

    def _restart_auto_read(self):
        job = getattr(self, '_auto_read_job', None)
        if job:
            try:
                self.root.after_cancel(job)
            except Exception:
                pass
        self._auto_read_job = None
        sec = self.config.get('autoReadSec', 0)
        if sec > 0:
            self._auto_read_job = self.root.after(sec * 1000, self._auto_read_tick)

    def _auto_read_paused(self, focused):
        return bool(self.is_boss_key or self.is_generating or self._hovering
                    or focused is self.entry_reply)

    def _auto_read_tick(self):
        self._auto_read_job = None
        sec = self.config.get('autoReadSec', 0)
        if sec <= 0:
            return
        try:
            focused = self.root.focus_get()
        except Exception:
            focused = None
        if not self._auto_read_paused(focused):
            self._turn_page(1, automatic=True)
        self._auto_read_job = self.root.after(sec * 1000, self._auto_read_tick)

    # ---------------- 贴边自动隐藏 ----------------
    DOCK_THRESHOLD = 12
    DOCK_STRIP = 3

    @staticmethod
    def _pick_dock_edge(x, y, w, h, rect, threshold=12):
        """距显示器工作区哪条边最近且 <=threshold 即贴边；否则 None。"""
        ml, mt, mr, mb = rect
        dists = {'left': x - ml, 'right': mr - (x + w), 'top': y - mt, 'bottom': mb - (y + h)}
        edge = min(dists, key=dists.get)
        return edge if dists[edge] <= threshold else None

    @staticmethod
    def _hide_target(edge, x, y, w, h, rect, strip=3):
        """收起后的窗口坐标：沿贴边方向滑出屏外，只留 strip 像素触发条。"""
        ml, mt, mr, mb = rect
        if edge == 'bottom':
            return (x, mb - strip)
        if edge == 'top':
            return (x, mt - h + strip)
        if edge == 'left':
            return (ml - w + strip, y)
        return (mr - strip, y)

    def _monitor_rect(self, window_rect=None):
        """窗口所在显示器的工作区矩形（不含任务栏）；失败回退主屏。"""
        try:
            import ctypes
            from ctypes import wintypes
            u32 = ctypes.windll.user32

            class MONITORINFO(ctypes.Structure):
                _fields_ = [('cbSize', wintypes.DWORD), ('rcMonitor', wintypes.RECT),
                            ('rcWork', wintypes.RECT), ('dwFlags', wintypes.DWORD)]
            if window_rect is None:
                u32.GetParent.argtypes = [wintypes.HWND]
                u32.GetParent.restype = wintypes.HWND
                u32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
                u32.MonitorFromWindow.restype = wintypes.HANDLE
                child = self.root.winfo_id()
                hmon = u32.MonitorFromWindow(u32.GetParent(child) or child, 2)
            else:
                u32.MonitorFromRect.argtypes = [ctypes.POINTER(wintypes.RECT), wintypes.DWORD]
                u32.MonitorFromRect.restype = wintypes.HANDLE
                hmon = u32.MonitorFromRect(ctypes.byref(wintypes.RECT(*window_rect)), 2)  # MONITOR_DEFAULTTONEAREST
            mi = MONITORINFO()
            mi.cbSize = ctypes.sizeof(MONITORINFO)
            u32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
            u32.GetMonitorInfoW.restype = wintypes.BOOL
            if hmon and u32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
                r = mi.rcWork
                return (r.left, r.top, r.right, r.bottom)
        except Exception:
            pass
        return (0, 0, self.root.winfo_screenwidth(), self.root.winfo_screenheight())

    def _eval_dock(self):
        if getattr(self, '_hidden', False) or not self.root.winfo_ismapped():
            return
        self._dock_edge = self._pick_dock_edge(
            self.root.winfo_x(), self.root.winfo_y(), self.width, self.height, self._monitor_rect())
        if self.config.get('autoHide', False) and self._dock_edge and not self._hovering:
            self._schedule_auto_hide()

    def _cancel_slide(self):
        for attr in ('_slide_job', '_hide_job'):
            job = getattr(self, attr, None)
            if job:
                try:
                    self.root.after_cancel(job)
                except Exception:
                    pass
            setattr(self, attr, None)

    def _schedule_auto_hide(self):
        if not self.config.get('autoHide', False) or not self._dock_edge:
            return
        job = getattr(self, '_hide_job', None)
        if job:
            try:
                self.root.after_cancel(job)
            except Exception:
                pass
        self._hide_job = self.root.after(500, self._auto_hide_now)

    def _auto_hide_now(self):
        self._hide_job = None
        if (not self.config.get('autoHide', False) or self.is_boss_key or self._hovering
                or getattr(self, '_is_resizing', False) or self.config.get('privacyMode', False)
                or getattr(self, '_hidden', False) or not self._dock_edge):
            return
        x, y = self.root.winfo_x(), self.root.winfo_y()
        self._dock_pos = (x, y)
        tx, ty = self._hide_target(self._dock_edge, x, y, self.width, self.height, self._monitor_rect())
        self._hidden = True
        self._slide_to(tx, ty)

    def _auto_hide_reveal(self):
        if not getattr(self, '_hidden', False):
            return
        self._hidden = False
        pos = getattr(self, '_dock_pos', None)
        if pos:
            self._slide_to(*pos)

    def _slide_to(self, tx, ty):
        self._cancel_slide()

        def step():
            x, y = self.root.winfo_x(), self.root.winfo_y()
            dx, dy = tx - x, ty - y
            if abs(dx) <= 1 and abs(dy) <= 1:
                self._slide_job = None
                self.root.geometry(f"+{tx}+{ty}")
                self._last_geometry = f"{self.width}x{self.height}+{tx}+{ty}"
                return
            nx = x + (dx // 3 if abs(dx) > 2 else (1 if dx > 0 else -1))
            ny = y + (dy // 3 if abs(dy) > 2 else (1 if dy > 0 else -1))
            self.root.geometry(f"+{nx}+{ny}")
            self._last_geometry = f"{self.width}x{self.height}+{nx}+{ny}"
            self._slide_job = self.root.after(12, step)
        self._slide_job = self.root.after(12, step)

    def toggle_auto_hide(self):
        self.config['autoHide'] = not self.config.get('autoHide', False)
        self._save_config()
        if self.config['autoHide']:
            self._eval_dock()
            self.flash_hint("🧲 贴边自动隐藏: 已开启（鼠标移开收起，碰边缘滑出）")
        else:
            self._cancel_slide()
            self._auto_hide_reveal()
            self.flash_hint("🧲 贴边自动隐藏: 已关闭")

    # ---------------- 无操作自动伪装（老板键） ----------------
    AUTO_BOSS_MIN_SEC = 5
    AUTO_BOSS_MAX_SEC = 3600
    AUTO_BOSS_TICK_MS = 1000

    @classmethod
    def _clamp_auto_boss(cls, value):
        # 0 = 关闭；其余夹到 5s ~ 1h，避免误存 1 秒导致刚离开就伪装
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        if value <= 0:
            return 0
        return max(cls.AUTO_BOSS_MIN_SEC, min(cls.AUTO_BOSS_MAX_SEC, int(value)))

    @staticmethod
    def _fmt_sec(sec):
        if sec <= 0:
            return "关闭"
        if sec < 60:
            return f"{sec} 秒"
        if sec % 60 == 0:
            return f"{sec // 60} 分钟"
        return f"{sec // 60} 分 {sec % 60} 秒"

    def _auto_boss_seconds(self):
        sec = self.config.get('autoBossSec', 0)
        if isinstance(sec, bool) or not isinstance(sec, int) or sec <= 0:
            return 0
        return sec

    def _start_idle_watch(self):
        """记录最后一次桌面交互，并按秒轮询是否该自动进入伪装。"""
        for seq in ('<Motion>', '<ButtonPress>', '<ButtonRelease>', '<KeyPress>',
                    '<KeyRelease>', '<MouseWheel>', '<FocusIn>', '<Enter>', '<Leave>'):
            try:
                self.root.bind_all(seq, self._note_activity, add='+')
            except tk.TclError:
                pass
        self._note_activity()
        self._idle_tick()

    def _note_activity(self, event=None):
        self._last_activity = time.monotonic()

    @staticmethod
    def _system_idle_seconds():
        # 全系统最后输入时间：人离开桌面就算空闲，不要求鼠标正好停在摸鱼条上
        if not sys.platform.startswith('win'):
            return None
        try:
            import ctypes
            from ctypes import wintypes

            class _LastInputInfo(ctypes.Structure):
                _fields_ = [('cbSize', wintypes.UINT), ('dwTime', wintypes.DWORD)]

            info = _LastInputInfo()
            info.cbSize = ctypes.sizeof(_LastInputInfo)
            if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
                return None
            elapsed_ms = int(ctypes.windll.kernel32.GetTickCount()) - int(info.dwTime)
            return max(0.0, elapsed_ms / 1000.0)
        except Exception:
            return None

    def _idle_seconds(self):
        local = max(0.0, time.monotonic() - self._last_activity)
        system = self._system_idle_seconds()
        if system is None:
            return local
        # 两条时钟取"更大"的那个：摸鱼条自身没交互 / 全系统没输入，任一成立就算离开。
        # 取 min 会被"鼠标路过、防熄屏工具抖一下"永久清零，等于永不触发。
        return max(local, system)

    def _auto_boss_state(self):
        """给倒计时显示、诊断窗口和 WS 查询共用的一份状态快照。"""
        sec = self._auto_boss_seconds()
        local = max(0.0, time.monotonic() - self._last_activity)
        system = self._system_idle_seconds()
        idle = local if system is None else max(local, system)
        blocked = self._auto_boss_blocked()
        hovering = bool(getattr(self, '_hovering', False))
        if self.is_boss_key:
            phase = 'disguised'
        elif sec <= 0:
            phase = 'off'
        elif blocked:
            phase = 'suspended'
        elif hovering:
            phase = 'hovering'
        elif idle >= sec:
            phase = 'due'
        else:
            phase = 'counting'
        return {
            'autoBossSec': sec,
            'localIdle': round(local, 1),
            'systemIdle': None if system is None else round(system, 1),
            'idle': round(idle, 1),
            'remaining': round(max(0.0, sec - idle), 1) if sec else 0.0,
            'phase': phase,
            'blocked': blocked,
            'hovering': hovering,
        }

    def _idle_tick(self):
        self._idle_job = None
        try:
            self._maybe_auto_disguise()
            if self.is_boss_key:
                self._refresh_live_disguise()
        except Exception as err:
            print(f"[Auto Boss] 空闲检查失败: {err}", flush=True)
        try:
            self._idle_job = self.root.after(self.AUTO_BOSS_TICK_MS, self._idle_tick)
        except tk.TclError:
            self._idle_job = None

    def _auto_boss_blocked(self):
        # 设置面板 / 回复候选窗开着时人还在，别抢着伪装
        for attr in ('_settings_win', '_auto_boss_win', '_choices_window'):
            win = getattr(self, attr, None)
            try:
                if win is not None and win.winfo_exists():
                    return True
            except Exception:
                pass
        return False

    def _maybe_auto_disguise(self):
        state = self._auto_boss_state()
        if state['phase'] != 'due':
            return
        # 静默切换：这一刻屏幕上可能正好有人看，弹提示等于自曝
        print(f"[Auto Boss] 无操作 {state['idle']}s（阈值 {state['autoBossSec']}s），自动进入伪装", flush=True)
        self.toggle_boss(True)

    def set_auto_boss(self, sec, announce=True):
        clamped = self._clamp_auto_boss(sec)
        if clamped is None:
            return
        self.config['autoBossSec'] = clamped
        self._save_config()
        self._note_activity()   # 改完立刻重新计时
        if announce:
            if clamped:
                self.flash_hint(f"🙈 无操作自动伪装: {self._fmt_sec(clamped)}后切代码伪装")
            else:
                self.flash_hint("🙈 无操作自动伪装: 已关闭")

    def open_idle_diag_dialog(self):
        """把"到底为什么没伪装"直接摊在屏幕上：两条时钟、剩余秒数、当前阶段。"""
        if getattr(self, '_idle_diag_win', None) and self._idle_diag_win.winfo_exists():
            self._idle_diag_win.lift()
            return

        win = tk.Toplevel(self.root)
        win.title("自动伪装诊断")
        win.configure(bg="#1e1e1e")
        win.wm_attributes("-topmost", True)
        win.resizable(False, False)
        self._idle_diag_win = win

        tk.Label(win, text="自动伪装诊断", font=self.font_bold,
                 bg="#1e1e1e", fg="#9cdcfe").pack(anchor="w", padx=14, pady=(12, 4))

        grid = tk.Frame(win, bg="#1e1e1e")
        grid.pack(fill=tk.X, padx=14)
        rows = {}
        for key, label in (('sec', '设置时长'), ('local', '条内空闲'), ('system', '系统空闲'),
                           ('idle', '判定空闲'), ('remain', '距离触发'), ('phase', '当前状态')):
            tk.Label(grid, text=f"{label}:", font=self.font_main, bg="#1e1e1e",
                     fg="#888888", anchor="w", width=10).grid(row=len(rows), column=0, sticky="w")
            val = tk.Label(grid, text="-", font=self.font_bold, bg="#1e1e1e", fg="#4ec9b0", anchor="w")
            val.grid(row=len(rows), column=1, sticky="w")
            rows[key] = val

        tk.Label(
            win,
            text="判定：条内空闲 / 系统空闲 任一达到设置时长即触发（鼠标压在条上不触发）\n"
                 "系统空闲 = Windows 最后一次键鼠输入，别的程序注入输入也会把它清零",
            font=self.font_main, bg="#1e1e1e", fg="#7a7a7a", justify="left"
        ).pack(anchor="w", padx=14, pady=(8, 2))

        phase_text = {
            'off': "关闭（0 秒）",
            'counting': "正常倒计时",
            'due': "已到时长，本 tick 即触发",
            'suspended': "已挂起：设置 / 滑块窗口开着",
            'hovering': "暂停：鼠标正压在条上",
            'disguised': "已在伪装状态（Esc 退出）",
        }

        def refresh():
            try:
                if not win.winfo_exists():
                    return
                st = self._auto_boss_state()
                rows['sec'].configure(text=self._fmt_sec(st['autoBossSec']))
                rows['local'].configure(text=f"{st['localIdle']}s")
                rows['system'].configure(text="不可用" if st['systemIdle'] is None else f"{st['systemIdle']}s")
                rows['idle'].configure(text=f"{st['idle']}s")
                rows['remain'].configure(text="-" if not st['autoBossSec'] else f"{st['remaining']}s")
                rows['phase'].configure(text=phase_text.get(st['phase'], st['phase']))
                self._idle_diag_job = win.after(500, refresh)
            except tk.TclError:
                self._idle_diag_job = None

        refresh()
        tk.Button(win, text="关闭", bg="#333333", fg="#cccccc", bd=0, padx=14, pady=3,
                  cursor="hand2", command=win.destroy).pack(anchor="e", padx=14, pady=(6, 12))
        win.bind("<Escape>", lambda e: win.destroy())

    # ---------------- 伪装风格 ----------------
    def _boss_style_id(self):
        style = self.config.get('bossStyle')
        return style if style in BOSS_STYLES else DEFAULT_BOSS_STYLE

    def _boss_style(self):
        return BOSS_STYLES[self._boss_style_id()]

    def set_boss_style(self, style, announce=True):
        if style not in BOSS_STYLES:
            return
        self.config['bossStyle'] = style
        self._save_config()
        if BOSS_STYLES[style].get('live'):
            # 提前喂一次采样：CPU / 网速都要前后差值，选主题时就打好基线，
            # 免得刚按 Esc 的第一秒显示 "CPU --"
            try:
                self._sys_sampler().read()
            except Exception:
                pass
        if self.is_boss_key:
            self._update_display()
        if announce:
            self.flash_hint(f"🎨 主题: {BOSS_STYLES[style]['label']}")

    def cycle_boss_style(self, step=1):
        ids = list(BOSS_STYLES)
        try:
            idx = ids.index(self._boss_style_id())
        except ValueError:
            idx = 0
        self.set_boss_style(ids[(idx + step) % len(ids)])

    def _sys_sampler(self):
        """惰性创建：不用性能监控主题的人，一秒一次的系统调用都不该有。"""
        sampler = getattr(self, '_sampler_inst', None)
        if sampler is None:
            sampler = self._sampler_inst = SysSampler()
        return sampler

    def _live_disguise_parts(self, kind):
        """live 风格（系统监控 / 时钟）的实时部件；取不到就返回 None 走静态兜底。"""
        if not kind:
            return None
        try:
            if kind == 'clock':
                now = time.localtime()
                weekday = '一二三四五六日'[now.tm_wday]
                return {
                    'branch': f"{now.tm_hour:02d}:{now.tm_min:02d}",
                    'text': f"周{weekday} {now.tm_mon:02d}/{now.tm_mday:02d}   {CLOCK_WEATHER}",
                    'right': None,      # 城市沿用风格里写死的值
                }
            if kind == 'sysmon':
                data = self._sys_sampler().read()
                cpu = '--' if data.get('cpu') is None else f"{data['cpu']:.0f}%"
                mem = '--' if data.get('mem') is None else f"{data['mem']:.0f}%"
                bits = [f"内存 {mem}"]
                if data.get('gpu') is not None:
                    bits.append(f"GPU {data['gpu']:.0f}%")
                elif data.get('disk') is not None:
                    bits.append(f"磁盘 {data['disk']:.0f}%")
                if data.get('proc'):
                    bits.append(f"进程 {data['proc']}")
                return {
                    'branch': f"CPU {cpu}",
                    'text': '  '.join(bits),   # 两空格省宽度：454px 窄条也放得下 进程数
                    'right': f"↓ {_fmt_rate(data.get('net_down', 0))} ↑ {_fmt_rate(data.get('net_up', 0))}",
                }
        except Exception as err:
            print(f"[Disguise] 采样失败，回退静态文案: {err}", flush=True)
        return None

    def _refresh_live_disguise(self):
        """伪装中每秒调一次：只动三个标签，不重排几何，避免闪烁。"""
        disguise = self._boss_style()
        parts = self._live_disguise_parts(disguise.get('live'))
        if not parts:
            return
        for widget, value in ((self.lbl_branch, parts.get('branch')),
                              (self.lbl_text, parts.get('text')),
                              (self.lbl_right_info, parts.get('right'))):
            if value and widget.cget('text') != value:
                widget.configure(text=value)

    def open_auto_boss_dialog(self):
        if hasattr(self, '_auto_boss_win') and self._auto_boss_win and self._auto_boss_win.winfo_exists():
            self._auto_boss_win.lift()
            return

        win = tk.Toplevel(self.root)
        win.title("无操作自动伪装")
        win.configure(bg="#1e1e1e")
        win.wm_attributes("-topmost", True)
        win.resizable(False, False)
        self._auto_boss_win = win

        tk.Label(win, text="无操作自动伪装（老板键）", font=self.font_bold,
                 bg="#1e1e1e", fg="#9cdcfe").pack(anchor="w", padx=14, pady=(12, 2))
        tk.Label(win, text="多久没有键盘/鼠标操作，就自动切到纯代码伪装", font=self.font_main,
                 bg="#1e1e1e", fg="#888888").pack(anchor="w", padx=14)

        var = tk.IntVar(value=self._auto_boss_seconds())
        head = tk.Frame(win, bg="#1e1e1e")
        head.pack(fill=tk.X, padx=14, pady=(10, 0))
        lbl_val = tk.Label(head, text="", font=self.font_bold, bg="#1e1e1e", fg="#4ec9b0", width=8, anchor="e")
        lbl_val.pack(side=tk.RIGHT, padx=(8, 0))

        scale = tk.Scale(
            head, from_=0, to=600, resolution=5, orient=tk.HORIZONTAL,
            variable=var, showvalue=False, bg="#1e1e1e", fg="#cccccc",
            troughcolor="#141414", highlightthickness=0, bd=0, length=380,
            activebackground="#0e639c"
        )
        scale.pack(side=tk.LEFT, fill=tk.X, expand=True)

        def refresh_label(*_):
            lbl_val.configure(text=self._fmt_sec(int(var.get())))

        scale.configure(command=refresh_label)
        refresh_label()

        ticks = tk.Frame(win, bg="#1e1e1e")
        ticks.pack(fill=tk.X, padx=16)
        for text in ("0 (关闭)", "5 分", "10 分"):
            tk.Label(ticks, text=text, font=self.font_main, bg="#1e1e1e", fg="#666666").pack(side=tk.LEFT, expand=True)

        btns = tk.Frame(win, bg="#1e1e1e")
        btns.pack(fill=tk.X, padx=14, pady=(8, 12))
        tk.Button(btns, text="取消", bg="#333333", fg="#cccccc", bd=0, padx=12, pady=3,
                  cursor="hand2", command=win.destroy).pack(side=tk.RIGHT)

        def apply_and_close():
            self.set_auto_boss(int(var.get()))
            win.destroy()

        tk.Button(btns, text="应用", bg="#0e639c", fg="#ffffff", bd=0, padx=16, pady=3,
                  cursor="hand2", command=apply_and_close).pack(side=tk.RIGHT, padx=6)

        win.bind("<Escape>", lambda e: win.destroy())

    def action_next(self):
        self._turn_page(1)

    def action_prev(self):
        self._turn_page(-1)

    def _turn_page(self, delta, automatic=False):
        if self.is_boss_key:
            return
        if self._pending_floor_step is not None:
            if not automatic:
                self._queued_navigation = (self._turn_page, delta)
            return
        if self.config.get('pagedReading', True):
            has_page = self._has_more_pages() if delta > 0 else self._has_prev_pages()
            if has_page:
                self._clear_pending_resume()
                self._page_idx += delta
                self._reading_offset = self._page_start_offset()
                self._update_reading_view()
                self._schedule_position_save()
                return
            if self._has_full_text:
                self._step_floor(delta, automatic=automatic)
                return
        if self.server.broadcast({'action': 'next' if delta > 0 else 'prev'}):
            self._clear_pending_resume()

    def action_floor_prev(self):
        self._step_floor(-1)

    def action_floor_next(self):
        self._step_floor(1)

    def _step_floor(self, delta, automatic=False):
        if self.is_boss_key:
            return
        if self._pending_floor_step is not None:
            if not automatic:
                self._queued_navigation = (self._step_floor, delta)
            return
        self._floor_request_id += 1
        request_id = self._floor_request_id
        request = {'action': 'change_floor', 'delta': delta,
                   'floorRequest': request_id, 'quiet': automatic}
        if self._synced_once:
            request['fromFloor'] = self.floor
        queued = self.server.broadcast(request)
        if queued:
            self._clear_pending_resume()
            self._pending_floor_step = (request_id, delta)
            self._pending_floor_job = self.root.after(1800, self._clear_floor_step)
        elif not automatic:
            self.flash_hint("酒馆桥接未连接")

    def _clear_floor_step(self):
        if self._pending_floor_job is not None:
            self.root.after_cancel(self._pending_floor_job)
        self._pending_floor_job = None
        self._pending_floor_step = None
        self._queued_navigation = None

    def action_floor_jump(self, floor):
        if self.is_boss_key:
            return
        try:
            val = int(floor)
            self._clear_floor_step()
            if self.server.broadcast({'action': 'jump_floor', 'floor': val}):
                self._clear_pending_resume()
            else:
                self.flash_hint("酒馆桥接未连接")
        except ValueError:
            pass

    def cycle_char_name_mode(self):
        if self.is_boss_key:
            return
        cur = self.config.get('charNameMode', 'compact')
        if cur == 'compact':
            nxt = 'hidden'
        elif cur == 'hidden':
            nxt = 'full'
        else:
            nxt = 'compact'
        self.config['charNameMode'] = nxt
        self._save_config()
        self.server.broadcast({'action': 'toggle_char_mode'})
        self._update_display()

    def toggle_show_user_messages(self):
        if self.is_boss_key:
            return
        cur = self.config.get('showUserMessages', False)
        self.config['showUserMessages'] = not cur
        self._save_config()
        self.server.broadcast({
            'action': 'update_config',
            'config': {
                'showUserMessages': self.config['showUserMessages']
            }
        })
        hint = "已开启显示用户消息" if self.config['showUserMessages'] else "已隐藏用户消息 (仅阅读AI与小说)"
        self.flash_hint(hint)

    def open_floor_jump_dialog(self):
        if self.is_boss_key:
            return
        if hasattr(self, '_floor_win') and self._floor_win and self._floor_win.winfo_exists():
            self._floor_win.lift()
            return

        win = tk.Toplevel(self.root)
        win.title("快速楼层跳转")
        win.geometry("340x160")
        win.configure(bg="#1e1e1e")
        win.wm_attributes("-topmost", True)
        self._floor_win = win

        try:
            wx = self.root.winfo_x() + 40
            wy = max(20, self.root.winfo_y() - 170)
            win.geometry(f"+{wx}+{wy}")
        except Exception:
            pass

        tk.Label(
            win, text=f"📖 楼层快速跳转 (当前: #{self.floor})",
            font=self.font_bold, bg="#1e1e1e", fg="#4ec9b0"
        ).pack(anchor="w", padx=14, pady=(12, 8))

        quick_frame = tk.Frame(win, bg="#1e1e1e")
        quick_frame.pack(fill=tk.X, padx=14, pady=(0, 10))

        def jump_and_close(target_f):
            self.action_floor_jump(target_f)
            win.destroy()

        def step_and_close(delta):
            self._step_floor(delta)
            win.destroy()

        tk.Button(
            quick_frame, text="⏮ 首楼 (#0)", font=self.font_main,
            bg="#252526", fg="#cccccc", bd=0, padx=6, pady=3, cursor="hand2",
            command=lambda: jump_and_close(0)
        ).pack(side=tk.LEFT, padx=(0, 4))

        tk.Button(
            quick_frame, text="◀ 上一楼", font=self.font_main,
            bg="#252526", fg="#cccccc", bd=0, padx=6, pady=3, cursor="hand2",
            command=lambda: step_and_close(-1)
        ).pack(side=tk.LEFT, padx=4)

        tk.Button(
            quick_frame, text="下一楼 ▶", font=self.font_main,
            bg="#252526", fg="#cccccc", bd=0, padx=6, pady=3, cursor="hand2",
            command=lambda: step_and_close(1)
        ).pack(side=tk.LEFT, padx=4)

        jump_frame = tk.Frame(win, bg="#1e1e1e")
        jump_frame.pack(fill=tk.X, padx=14, pady=(0, 10))

        tk.Label(jump_frame, text="指定楼层:", font=self.font_main, bg="#1e1e1e", fg="#cccccc").pack(side=tk.LEFT, padx=(0, 6))

        ent_floor = tk.Entry(jump_frame, font=self.font_mono, width=8, bg="#141414", fg="#9cdcfe", insertbackground="#ffffff", bd=1, relief=tk.SOLID)
        ent_floor.pack(side=tk.LEFT, padx=(0, 8))
        ent_floor.insert(0, str(self.floor))
        ent_floor.focus()
        ent_floor.select_range(0, tk.END)

        def do_jump(event=None):
            val = ent_floor.get().strip()
            if val.isdigit() or (val.startswith('-') and val[1:].isdigit()):
                jump_and_close(int(val))

        ent_floor.bind("<Return>", do_jump)
        win.bind("<Escape>", lambda e: win.destroy())

        tk.Button(
            jump_frame, text="跳转 ↵", font=self.font_main,
            bg="#0e639c", fg="#ffffff", bd=0, padx=12, pady=2, cursor="hand2",
            command=do_jump
        ).pack(side=tk.LEFT)

    def action_swipe(self):
        if self.is_generating:
            return
        action = 'retry_generation' if self._can_retry_generation else 'swipe'
        if not self.server.broadcast({'action': action}):
            self.flash_hint("酒馆桥接未连接")

    def action_stop(self):
        self.server.broadcast({'action': 'stop'})

    def toggle_boss(self, forced_state=None):
        self.is_boss_key = not self.is_boss_key if forced_state is None else forced_state
        if not self.is_boss_key:
            # 退出伪装就从现在重新计空闲，否则刚按 Esc 又会被立刻判定成"没人"
            self._note_activity()
        self.server.broadcast({'action': 'boss'})
        self._update_display()

    def _watch_reply_ime(self):
        if sys.platform != 'win32':
            return
        import ctypes
        from ctypes import wintypes

        # 观察候选字合成，实际字符仍交给 Tk 和 Windows 输入法处理。
        subclass = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT,
                                      wintypes.WPARAM, wintypes.LPARAM, ctypes.c_size_t, ctypes.c_size_t)
        controls = ctypes.windll.comctl32
        install = controls.SetWindowSubclass
        install.argtypes = [wintypes.HWND, subclass, ctypes.c_size_t, ctypes.c_size_t]
        install.restype = wintypes.BOOL
        remove = controls.RemoveWindowSubclass
        remove.argtypes = [wintypes.HWND, subclass, ctypes.c_size_t]
        remove.restype = wintypes.BOOL
        forward = controls.DefSubclassProc
        forward.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        forward.restype = ctypes.c_ssize_t

        @subclass
        def observe(hwnd, message, wparam, lparam, identifier, _data):
            if message == 0x010D:  # WM_IME_STARTCOMPOSITION
                self._ime_composing = True
            elif message == 0x010E and self._ime_composing:  # WM_IME_ENDCOMPOSITION
                self._ime_composing = False
                self._ime_confirm_until = time.monotonic() + 0.12
            elif message == 0x0008:  # WM_KILLFOCUS
                self._ime_composing = False
            elif message == 0x0082:  # WM_NCDESTROY
                remove(hwnd, observe, identifier)
            return forward(hwnd, message, wparam, lparam)

        if install(self.entry_reply.winfo_id(), observe, 1, 0):
            self._reply_ime_callback = observe

    def _reply_ime_active(self):
        return self._ime_composing or time.monotonic() < self._ime_confirm_until

    def _on_reply_return(self, event):
        if self._reply_ime_active():
            return "break"
        return self._submit_reply()

    def _on_boss_shortcut(self, event):
        if event.widget is self.entry_reply and self._reply_ime_active():
            return "break"
        self.toggle_boss()
        return "break"

    def _insert_reply_punctuation(self, mark):
        if self.entry_reply.selection_present():
            self.entry_reply.delete(tk.SEL_FIRST, tk.SEL_LAST)
        self.entry_reply.insert(tk.INSERT, mark)

    def _on_reply_key(self, event):
        marks = {',': '，', '.': '。', '!': '！', '?': '？', ';': '；', ':': '：',
                 '(': '（', ')': '）', '[': '【', ']': '】', '{': '｛', '}': '｝'}
        mark = marks.get(event.char)
        if mark and not event.state & 0x0004 and self._chinese_punctuation.get() and not self._ime_composing:
            self._insert_reply_punctuation(mark)
            return "break"
        return None

    def _save_punctuation_mode(self):
        self.config['chinesePunctuation'] = self._chinese_punctuation.get()
        self._save_config()

    def _popup_reply_menu(self, event):
        menu = tk.Menu(self.entry_reply, tearoff=False)
        for label, virtual_event in (("剪切", "<<Cut>>"), ("复制", "<<Copy>>"), ("粘贴", "<<Paste>>")):
            menu.add_command(label=label, command=lambda name=virtual_event: self.entry_reply.event_generate(name))
        symbols = tk.Menu(menu, tearoff=False)
        symbols.add_checkbutton(label="键入时转换常用标点", variable=self._chinese_punctuation,
                                command=self._save_punctuation_mode)
        symbols.add_separator()
        for mark in "，。！？；：、…—“”‘’（）《》【】｛｝":
            symbols.add_command(label=mark, command=lambda char=mark: self._insert_reply_punctuation(char))
        menu.add_cascade(label="中文标点", menu=symbols)
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()
        return "break"

    def _apply_generation_status(self, data):
        self.is_generating = bool(data.get('isGenerating', False))
        phase = data.get('generationStatus')
        if phase not in ('idle', 'running', 'complete', 'failed', 'stopped'):
            previous = self._generation_status[2]
            phase = 'running' if self.is_generating else 'complete' if previous == 'running' else previous
        self._can_retry_generation = data.get('canRetryGeneration') is True
        key = (self._chat_id, data.get('generationId'), phase)
        if key == self._generation_status:
            return
        self._generation_status = key
        if self._generation_hint_job is not None:
            self.root.after_cancel(self._generation_hint_job)
            self._generation_hint_job = None
        self._generation_hint = phase if phase != 'idle' else ''
        if phase in ('complete', 'failed', 'stopped'):
            self._generation_hint_job = self.root.after(5200 if phase == 'failed' else 2400,
                                                        self._expire_generation_hint)

    def _expire_generation_hint(self):
        self._generation_hint_job = None
        self._generation_hint = ''
        self._update_reply_indicators()

    def _on_generation_click(self, event):
        if self._generation_hint == 'failed' and self._can_retry_generation and not self.is_boss_key:
            self.action_swipe()
        return "break"

    def _update_reply_indicators(self):
        labels = {
            'running': ("生成中…", "#dcdcaa"),
            'complete': ("生成完成", "#4ec9b0"),
            'failed': ("生成失败 · 重试" if self._can_retry_generation else "生成失败", "#f48771"),
            'stopped': ("已停止", self.theme['fg']),
        }
        if self._generation_hint:
            text, color = labels[self._generation_hint]
            retryable = self._generation_hint == 'failed' and self._can_retry_generation
            self.btn_generation.configure(text=text, fg=color, cursor="hand2" if retryable else "")
        for widget, visible in ((self.btn_generation, self._generation_hint), (self.btn_choices, self.reply_choices)):
            if visible and not self.is_boss_key:
                if not widget.winfo_manager():
                    widget.pack(side=tk.RIGHT, before=self.center_frame, padx=(0, 4))
            elif widget.winfo_manager():
                widget.pack_forget()

    def _close_reply_choices(self):
        if self._choices_window is not None:
            self._choices_window.destroy()
            self._choices_window = None

    def open_reply_choices(self):
        if self.is_boss_key or not self.reply_choices:
            return
        if self._choices_window is not None:
            self._choices_window.lift()
            return
        win = self._choices_window = tk.Toplevel(self.root)
        win.title("回复选项")
        win.transient(self.root)
        win.wm_attributes("-topmost", True)
        win.configure(bg=self.theme['bg'])
        win.protocol("WM_DELETE_WINDOW", self._close_reply_choices)
        win.bind("<Escape>", lambda event: self._close_reply_choices())
        left, top, right, bottom = self._monitor_rect()
        width = min(max(300, self.width), 520, right - left)
        height = min(max(125, len(self.reply_choices) * 44 + 36), 340, bottom - top)
        x = max(left, min(self.root.winfo_x(), right - width))
        bar_y = self.root.winfo_y()
        y = bar_y - height - 4 if bar_y - height - 4 >= top else min(bar_y + self.height + 4, bottom - height)
        win.geometry(f"{width}x{height}+{x}+{max(top, y)}")
        help_text = "选择后填入回复框" if self.config.get('layoutMode') != 'single' else "选择后复制到剪贴板"
        tk.Label(win, text=help_text, bg=self.theme['bg'], fg=self.theme['fg']).pack(anchor="w", padx=10, pady=5)

        canvas = tk.Canvas(win, bg=self.theme['bg'], highlightthickness=0)
        scroll = tk.Scrollbar(win, command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        canvas.pack(fill=tk.BOTH, expand=True)
        items = tk.Frame(canvas, bg=self.theme['bg'])
        canvas.create_window(0, 0, anchor="nw", window=items)
        items.bind("<Configure>", lambda event: canvas.configure(scrollregion=canvas.bbox("all")))
        win.bind("<MouseWheel>", lambda event: canvas.yview_scroll(-int(event.delta / 120), "units"))
        for choice in self.reply_choices:
            tk.Button(items, text=choice, command=lambda value=choice: self._use_reply_choice(value),
                      font=self.font_main, bg=self.theme['row2_bg'], fg=self.theme['fg'],
                      wraplength=width - 54, anchor="w", justify=tk.LEFT, padx=8, pady=5,
                      bd=0, cursor="hand2").pack(fill=tk.X, padx=8, pady=3)
        win.focus_set()

    def _use_reply_choice(self, choice):
        self._close_reply_choices()
        if self.config.get('layoutMode') == 'single':
            self.root.clipboard_clear()
            self.root.clipboard_append(choice)
            self.flash_hint("已复制选项")
            return
        draft = self.entry_reply.get()
        caret = self.entry_reply.index(tk.INSERT)
        before = " " if caret > 0 and not draft[caret - 1].isspace() else ""
        after = " " if caret < len(draft) and not draft[caret].isspace() else ""
        self.entry_reply.insert(tk.INSERT, before + choice + after)
        self.entry_reply.focus_set()

    def _submit_reply(self, event=None):
        if self.is_generating:
            return "break"
        text = self.entry_reply.get().strip()
        if self.is_boss_key and text in BOSS_PLACEHOLDERS:
            return
        if text:
            if self.server.broadcast({'action': 'reply', 'text': text}):
                self.entry_reply.delete(0, tk.END)
            else:
                self.flash_hint("酒馆桥接未连接，草稿已保留")
        return "break"

    def cycle_theme(self):
        """主题即伪装风格：Alt+T 在 16 套之间循环，伪装中按了立刻换皮。"""
        self.cycle_boss_style()

    def copy_bridge_token(self):
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(self.bridge_token)
        except Exception:
            pass
        top = tk.Toplevel(self.root)
        top.overrideredirect(True)
        top.wm_attributes("-topmost", True)
        top.configure(bg="#252526")
        tk.Label(
            top, text=f"桥接密钥已复制: {self.bridge_token}",
            fg="#cccccc", bg="#252526", font=self.font_main, padx=12, pady=8
        ).pack()
        top.update_idletasks()
        x = self.root.winfo_x() + max(0, (self.width - top.winfo_reqwidth()) // 2)
        y = max(0, self.root.winfo_y() - top.winfo_reqheight() - 8)
        top.geometry(f"+{x}+{y}")
        top.after(2500, top.destroy)

    def flash_hint(self, text, ms=2400):
        """条上方弹一个无边框小提示，几秒后自动消失。"""
        try:
            top = tk.Toplevel(self.root)
            top.overrideredirect(True)
            top.wm_attributes("-topmost", True)
            top.configure(bg="#252526")
            tk.Label(top, text=text, fg="#cccccc", bg="#252526",
                     font=self.font_main, padx=12, pady=6).pack()
            top.update_idletasks()
            x = self.root.winfo_x() + max(0, (self.width - top.winfo_reqwidth()) // 2)
            y = max(0, self.root.winfo_y() - top.winfo_reqheight() - 8)
            top.geometry(f"+{x}+{y}")
            top.after(ms, top.destroy)
            return top
        except Exception:
            return None

    def edit_allowed_origins(self):
        """远程（公网）酒馆页面的来源白名单，保存后立即对运行中的 WS 服务端生效。"""
        cur = list(self.config.get('allowedOrigins', []))
        win = tk.Toplevel(self.root)
        win.title("远程酒馆来源白名单")
        win.configure(bg="#1e1e1e")
        win.wm_attributes("-topmost", True)
        win.transient(self.root)
        win.geometry("520x260")

        tk.Label(
            win,
            text="每行一个来源（也可用逗号分隔），例如：\n"
                 "    https://st.sobysong.cn:8443\n"
                 "支持通配：*.sobysong.cn    留空 = 只允许本地 / 局域网",
            fg="#cccccc", bg="#1e1e1e", font=self.font_main, justify="left", anchor="w"
        ).pack(fill="x", padx=12, pady=(10, 6))

        txt = tk.Text(win, height=6, bg="#252526", fg="#cccccc", insertbackground="#cccccc",
                      font=self.font_mono, relief="flat", highlightthickness=1,
                      highlightbackground="#3c3c3c")
        txt.pack(fill="both", expand=True, padx=12)
        txt.insert("1.0", "\n".join(cur))

        row = tk.Frame(win, bg="#1e1e1e")
        row.pack(fill="x", padx=12, pady=8)

        def _apply():
            raw = txt.get("1.0", "end").strip()
            entries = [e.rstrip('/') for e in re.split(r'[,;，；\s]+', raw) if e]
            self.config['allowedOrigins'] = entries
            self._save_config()
            applied = set()
            if getattr(self, 'server', None):
                applied = self.server.set_allowed_origins(entries)
            print(f"[WebSocket Server] 来源白名单: {', '.join(sorted(applied)) or '（仅本地/私网）'}", flush=True)
            win.destroy()
            self.flash_hint(f"🌐 白名单已生效: {len(entries)} 条" if entries else "🌐 白名单已清空（仅本地/私网）")

        tk.Button(row, text="保存并生效", command=_apply, bg="#007acc", fg="#ffffff",
                  relief="flat", padx=12, pady=3).pack(side="right")
        tk.Button(row, text="取消", command=win.destroy, bg="#333333", fg="#cccccc",
                  relief="flat", padx=12, pady=3).pack(side="right", padx=(0, 8))

        win.update_idletasks()
        x = self.root.winfo_x() + max(0, (self.width - win.winfo_reqwidth()) // 2)
        y = max(80, self.root.winfo_y() - win.winfo_reqheight() - 12)
        win.geometry(f"+{x}+{y}")
        win.attributes("-topmost", True)
        win.lift()
        try:
            win.focus_force()
        except Exception:
            pass

    def set_opacity(self, alpha):
        self.alpha = max(0.15, min(1.0, alpha))
        self.root.wm_attributes("-alpha", self.alpha)
        self._save_config()

    def _apply_theme(self):
        self.container.configure(bg=self.theme['bg'])
        self.row1.configure(bg=self.theme['bg'])
        self.row2.configure(bg=self.theme['row2_bg'])
        self.left_frame.configure(bg=self.theme['bg'])
        self.right_frame.configure(bg=self.theme['bg'])
        self.center_frame.configure(bg=self.theme['bg'])
        self.lbl_branch.configure(bg=self.theme['bg'], fg=self.theme['fg'])
        self.btn_generation.configure(bg=self.theme['bg'])
        self.btn_choices.configure(bg=self.theme['bg'], fg=self.theme['accent'])
        if hasattr(self, 'lbl_right_info'):
            self.lbl_right_info.configure(bg="#252526", fg='#9cdcfe')
        if hasattr(self, 'btn_menu'):
            self.btn_menu.configure(bg=self.theme['bg'], fg=self.theme['fg'])
        if hasattr(self, 'floor_frame'):
            f_bg = "#252526"
            self.floor_frame.configure(bg=f_bg)
            self.lbl_floor.configure(bg=f_bg, fg='#9cdcfe')
            for button in (self.btn_floor_prev, self.btn_floor_next):
                button.configure(bg=f_bg, fg=self.theme['fg'], activebackground=self.theme['bg'],
                                 activeforeground=self.theme['fg'])
        self.lbl_char.configure(fg=self.theme['char'])
        self.lbl_text.configure(bg=self.theme['bg'], fg=self.theme['fg'])
        self.lbl_prefix.configure(bg=self.theme['row2_bg'])
        self.entry_reply.configure(
            bg=self.theme['input_bg'], fg=self.theme['input_fg'],
            insertbackground=self.theme['fg']
        )

    def open_settings_dialog(self):
        if hasattr(self, '_settings_win') and self._settings_win and self._settings_win.winfo_exists():
            self._settings_win.lift()
            return

        win = tk.Toplevel(self.root)
        win.title("ST-Thief-Book 摸鱼白名单与黑名单设置")
        win.geometry("560x800")
        win.configure(bg="#1e1e1e")
        win.wm_attributes("-topmost", True)
        self._settings_win = win

        # 头部标题
        hdr = tk.Label(win, text="ST-Thief-Book 设置与规则过滤", font=self.font_bold, bg="#1e1e1e", fg="#cccccc")
        hdr.pack(anchor="w", padx=14, pady=(12, 6))

        # ------------------ 0. 极简模式与布局风格 ------------------
        mode_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        mode_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        tk.Label(
            mode_group, text="界面风格与布局:",
            font=self.font_bold, bg="#1c1e22", fg="#9cdcfe"
        ).pack(anchor="w", padx=8, pady=(6, 2))

        var_min_mode = tk.BooleanVar(value=bool(self.config.get('minimalMode', False)))
        chk_min = tk.Checkbutton(
            mode_group, text="极简模式 (纯文字无边框，隐藏多余按钮)",
            variable=var_min_mode, font=self.font_main,
            bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        )
        chk_min.pack(anchor="w", padx=8, pady=(2, 4))

        var_layout_mode = tk.StringVar(value=self.config.get('layoutMode', 'double'))
        layout_radio_frame = tk.Frame(mode_group, bg="#1c1e22")
        layout_radio_frame.pack(anchor="w", padx=8, pady=(2, 6))

        tk.Radiobutton(
            layout_radio_frame, text="双行模式 (上行看小说，下行就地快捷回复)",
            variable=var_layout_mode, value="double",
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT, padx=(0, 8))

        tk.Radiobutton(
            layout_radio_frame, text="单行极窄模式 (仅显示小说正文)",
            variable=var_layout_mode, value="single",
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT)

        # 伪装风格（老板键按下去时条上显示什么）
        style_row = tk.Frame(mode_group, bg="#1c1e22")
        style_row.pack(anchor="w", padx=8, pady=(0, 6))
        tk.Label(style_row, text="主题（伪装风格）:", font=self.font_main,
                 bg="#1c1e22", fg="#cccccc").pack(side=tk.LEFT, padx=(0, 6))
        style_labels = [cfg['label'] for cfg in BOSS_STYLES.values()]
        style_label_to_id = {cfg['label']: sid for sid, cfg in BOSS_STYLES.items()}
        var_boss_style = tk.StringVar(value=BOSS_STYLES[self._boss_style_id()]['label'])
        opt_style = tk.OptionMenu(style_row, var_boss_style, *style_labels)
        opt_style.configure(bg="#252526", fg="#4ec9b0", bd=0, highlightthickness=0,
                            activebackground="#094771", activeforeground="#ffffff",
                            font=self.font_main)
        opt_style["menu"].configure(bg="#1e1e1e", fg="#cccccc", font=self.font_main,
                                    activebackground="#094771", activeforeground="#ffffff")
        opt_style.pack(side=tk.LEFT)

        # ------------------ 0.1 角色名显示设置 ------------------
        char_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        char_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        tk.Label(
            char_group, text="角色名称显示模式:",
            font=self.font_bold, bg="#1c1e22", fg="#9cdcfe"
        ).pack(anchor="w", padx=8, pady=(6, 2))

        var_char_mode = tk.StringVar(value=self.config.get('charNameMode', 'compact'))
        radio_frame = tk.Frame(char_group, bg="#1c1e22")
        radio_frame.pack(anchor="w", padx=8, pady=(2, 6))

        tk.Radiobutton(
            radio_frame, text="精简胶囊 (限制宽度并省略)",
            variable=var_char_mode, value="compact",
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT, padx=(0, 8))

        tk.Radiobutton(
            radio_frame, text="完全隐藏 (正文独占100%空间)",
            variable=var_char_mode, value="hidden",
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT, padx=(0, 8))

        tk.Radiobutton(
            radio_frame, text="完整展示",
            variable=var_char_mode, value="full",
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT)

        # ------------------ 0.5 阅读模式 ------------------
        wrap_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        wrap_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        tk.Label(
            wrap_group, text="阅读模式",
            font=self.font_bold, bg="#1c1e22", fg="#9cdcfe"
        ).pack(anchor="w", padx=8, pady=(6, 2))

        var_paged_reading = tk.BooleanVar(value=self.config.get('pagedReading', True))
        wrap_radio_frame = tk.Frame(wrap_group, bg="#1c1e22")
        wrap_radio_frame.pack(anchor="w", padx=8, pady=(2, 6))

        tk.Radiobutton(
            wrap_radio_frame, text="整段分屏",
            variable=var_paged_reading, value=True,
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT, padx=(0, 8))

        tk.Radiobutton(
            wrap_radio_frame, text="逐句截断（超宽显示省略号）",
            variable=var_paged_reading, value=False,
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT)

        # ------------------ 0.6 无操作自动伪装（时间滑块） ------------------
        idle_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        idle_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        tk.Label(
            idle_group, text="无操作自动伪装（老板键）:",
            font=self.font_bold, bg="#1c1e22", fg="#9cdcfe"
        ).pack(anchor="w", padx=8, pady=(6, 0))

        var_auto_boss = tk.IntVar(value=self._auto_boss_seconds())
        idle_head = tk.Frame(idle_group, bg="#1c1e22")
        idle_head.pack(fill=tk.X, padx=8, pady=0)
        lbl_auto_boss = tk.Label(idle_head, text="", font=self.font_bold,
                                 bg="#1c1e22", fg="#4ec9b0", width=8, anchor="e")
        lbl_auto_boss.pack(side=tk.RIGHT, padx=(6, 0))

        scale_auto_boss = tk.Scale(
            idle_head, from_=0, to=600, resolution=5, orient=tk.HORIZONTAL,
            variable=var_auto_boss, showvalue=False, bg="#1c1e22", fg="#cccccc",
            troughcolor="#141414", highlightthickness=0, bd=0, length=400,
            activebackground="#0e639c"
        )
        scale_auto_boss.pack(side=tk.LEFT, fill=tk.X, expand=True)

        def refresh_auto_boss_label(*_):
            lbl_auto_boss.configure(text=self._fmt_sec(int(var_auto_boss.get())))

        scale_auto_boss.configure(command=refresh_auto_boss_label)
        refresh_auto_boss_label()

        tk.Label(
            idle_group, text="0 = 关闭；无键盘/鼠标操作达到该时长后自动切纯代码伪装（Esc 退出）",
            font=self.font_main, bg="#1c1e22", fg="#7a7a7a"
        ).pack(anchor="w", padx=8, pady=(0, 6))

        # ------------------ 1. 白名单区域 ------------------
        wl_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        wl_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        var_enable_wl = tk.BooleanVar(value=bool(self.config.get('enableWhitelist', True)))
        chk_wl = tk.Checkbutton(
            wl_group, text="启用正文白名单提取 (优先提取正文)",
            variable=var_enable_wl, font=self.font_bold,
            bg="#1c1e22", fg="#4ec9b0", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#73e6cf"
        )
        chk_wl.pack(anchor="w", padx=8, pady=(6, 2))

        txt_wl_frame = tk.Frame(wl_group, bg="#1c1e22")
        txt_wl_frame.pack(fill=tk.X, padx=8, pady=2)

        txt_whitelist = tk.Text(txt_wl_frame, height=3, font=self.font_mono, bg="#141414", fg="#cccccc", insertbackground="#cccccc", bd=1, relief=tk.SOLID)
        txt_whitelist.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        txt_whitelist.insert("1.0", ", ".join(self.config.get('tagWhitelist', [])))

        wl_chips_frame = tk.Frame(wl_group, bg="#1c1e22")
        wl_chips_frame.pack(anchor="w", padx=8, pady=(2, 6))
        tk.Label(wl_chips_frame, text="白名单快选:", font=self.font_main, bg="#1c1e22", fg="#888888").pack(side=tk.LEFT, padx=(0, 4))

        def read_tags(widget):
            return self._clean_tag_list(re.split(r'[,，\n]', widget.get("1.0", tk.END)))

        def add_tag(widget, tag):
            tags = read_tags(widget)
            if tag not in tags and len(tags) < 100:
                tags.append(tag)
                widget.delete("1.0", tk.END)
                widget.insert("1.0", ", ".join(tags))

        for chip_tag in ['content', 'output', 'response', 'dialogue', 'story', 'reply', 'text', '正文']:
            lbl = tk.Label(wl_chips_frame, text=f"+{chip_tag}", font=self.font_main, bg="#252526", fg="#4ec9b0", padx=4, pady=1, cursor="hand2")
            lbl.pack(side=tk.LEFT, padx=2)
            lbl.bind("<Button-1>", lambda e, t=chip_tag: add_tag(txt_whitelist, t))

        # ------------------ 2. 黑名单区域 ------------------
        bl_group = tk.Frame(win, bg="#1c1c1c", bd=1, relief=tk.SOLID)
        bl_group.pack(fill=tk.X, padx=14, pady=4)

        tk.Label(
            bl_group, text="思考与元数据黑名单 (彻底清除标签及其内部内容):",
            font=self.font_bold, bg="#1c1c1c", fg="#f48771"
        ).pack(anchor="w", padx=8, pady=(6, 2))

        txt_bl_frame = tk.Frame(bl_group, bg="#1c1c1c")
        txt_bl_frame.pack(fill=tk.X, padx=8, pady=2)

        txt_blacklist = tk.Text(txt_bl_frame, height=3, font=self.font_mono, bg="#141414", fg="#cccccc", insertbackground="#cccccc", bd=1, relief=tk.SOLID)
        txt_blacklist.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        txt_blacklist.insert("1.0", ", ".join(self.config.get('tagBlacklist', [])))

        bl_chips_frame = tk.Frame(bl_group, bg="#1c1c1c")
        bl_chips_frame.pack(anchor="w", padx=8, pady=(2, 6))
        tk.Label(bl_chips_frame, text="黑名单快选:", font=self.font_main, bg="#1c1c1c", fg="#888888").pack(side=tk.LEFT, padx=(0, 4))

        for chip_tag in ['think', 'thought', 'cot', 'status', 'bbi_image', 'fox_hugou', 'fox_selc', 'fox_tip', 'details']:
            lbl = tk.Label(bl_chips_frame, text=f"+{chip_tag}", font=self.font_main, bg="#252526", fg="#f48771", padx=4, pady=1, cursor="hand2")
            lbl.pack(side=tk.LEFT, padx=2)
            lbl.bind("<Button-1>", lambda e, t=chip_tag: add_tag(txt_blacklist, t))

        # ------------------ 3. 其他选项 ------------------
        opt_frame = tk.Frame(win, bg="#1e1e1e")
        opt_frame.pack(fill=tk.X, padx=14, pady=4)

        var_act = tk.BooleanVar(value=bool(self.config.get('filterActions', False)))
        chk_act = tk.Checkbutton(opt_frame, text="过滤动作描写 (*xxx*)", variable=var_act, bg="#1e1e1e", fg="#cccccc", selectcolor="#252526", activebackground="#1e1e1e", activeforeground="#ffffff")
        chk_act.pack(side=tk.LEFT, padx=4)

        var_user = tk.BooleanVar(value=bool(self.config.get('showUserMessages', False)))
        chk_user = tk.Checkbutton(opt_frame, text="显示用户消息 (默认关闭，仅阅读AI/小说回复)", variable=var_user, bg="#1e1e1e", fg="#cccccc", selectcolor="#252526", activebackground="#1e1e1e", activeforeground="#ffffff")
        chk_user.pack(side=tk.LEFT, padx=12)

        var_privacy = tk.BooleanVar(value=bool(self.config.get('privacyMode', False)))
        chk_privacy = tk.Checkbutton(opt_frame, text="隐私模式 (悬停显示/移开隐藏)", variable=var_privacy, bg="#1e1e1e", fg="#cccccc", selectcolor="#252526", activebackground="#1e1e1e", activeforeground="#ffffff")
        chk_privacy.pack(side=tk.LEFT, padx=8)

        # 底部操作按钮
        btn_frame = tk.Frame(win, bg="#1e1e1e")
        btn_frame.pack(fill=tk.X, padx=14, pady=(10, 14))

        def reset_defaults():
            var_min_mode.set(False)
            var_layout_mode.set("double")
            var_char_mode.set("compact")
            var_paged_reading.set(True)
            var_enable_wl.set(True)
            txt_whitelist.delete("1.0", tk.END)
            txt_whitelist.insert("1.0", ", ".join([
                'content', 'output', 'response', 'dialogue', 'story', 'reply', 'text', 'narration', 'message', '正文'
            ]))
            txt_blacklist.delete("1.0", tk.END)
            txt_blacklist.insert("1.0", ", ".join([
                'think', 'thought', 'cot', 'scratchpad', 'reasoning', 'analysis', 'plan',
                'internal_monologue', 'system_note', 'thought_process', 'thinking',
                'status', 'bbi_image', 'fox_hugou', 'fox_selc', 'fox_tip', 'so_seq', 'details'
            ]))
            var_act.set(False)
            var_user.set(False)
            var_privacy.set(False)
            var_auto_boss.set(0)
            refresh_auto_boss_label()
            var_boss_style.set(BOSS_STYLES[DEFAULT_BOSS_STYLE]['label'])

        btn_reset = tk.Button(btn_frame, text="恢复默认预设", command=reset_defaults, bg="#333333", fg="#cccccc", bd=0, padx=8, pady=4, cursor="hand2")
        btn_reset.pack(side=tk.LEFT)

        def save_settings():
            self.config['minimalMode'] = var_min_mode.get()
            self.config['layoutMode'] = var_layout_mode.get()
            self.config['charNameMode'] = var_char_mode.get()
            self.config['pagedReading'] = var_paged_reading.get()
            self.config['enableWhitelist'] = var_enable_wl.get()
            self.config['tagWhitelist'] = read_tags(txt_whitelist)
            self.config['tagBlacklist'] = read_tags(txt_blacklist)
            self.config['filterActions'] = var_act.get()
            self.config['showUserMessages'] = var_user.get()
            self.config['privacyMode'] = var_privacy.get()
            self.config['autoBossSec'] = self._clamp_auto_boss(int(var_auto_boss.get())) or 0
            picked_style = style_label_to_id.get(var_boss_style.get())
            if picked_style in BOSS_STYLES:
                self.config['bossStyle'] = picked_style
            self._note_activity()   # 滑块刚调完，从此刻重新计空闲
            if not self.config['privacyMode']:
                self.root.wm_attributes("-alpha", self.alpha)
            else:
                self.root.after(50, self._check_privacy_mouse_leave)

            self._apply_layout_and_mode()
            self._update_display()
            self._save_config()

            # 同步更新酒馆助手端配置
            self.server.broadcast({
                'action': 'update_config',
                'config': self.config
            })
            win.destroy()

        btn_save = tk.Button(btn_frame, text="💾 保存并同步生效", command=save_settings, bg="#0e639c", fg="#ffffff", bd=0, padx=14, pady=4, cursor="hand2")
        btn_save.pack(side=tk.RIGHT)

    _BOOL_CONFIG_KEYS = {'minimalMode', 'showUserMessages', 'enableWhitelist', 'filterActions', 'privacyMode', 'pagedReading', 'autoHide'}
    _ENUM_CONFIG_KEYS = {
        'layoutMode': {'single', 'double'},
        'charNameMode': {'compact', 'hidden', 'full'},
        'wrapMode': {'wrap', 'single'},
        'filterMode': {'pure', 'regex'}
    }

    @staticmethod
    def _clean_tag_list(tags):
        cleaned = []
        for tag in tags[:100]:
            if not isinstance(tag, str) or len(tag) > 1024:
                continue
            while (decoded := unescape(tag)) != tag:
                tag = decoded
            tag = re.sub(r'^[<\[]+\s*/?|/?\s*[>\]]+$', '', tag.strip()).strip().lower()
            if 0 < len(tag) <= 64 and tag not in cleaned:
                cleaned.append(tag)
        return cleaned

    def _merge_sync_config(self, incoming):
        for k, v in incoming.items():
            if k in self._BOOL_CONFIG_KEYS and isinstance(v, bool):
                self.config[k] = v
            elif k in self._ENUM_CONFIG_KEYS and isinstance(v, str) and v in self._ENUM_CONFIG_KEYS[k]:
                self.config[k] = v
            elif k in ('tagWhitelist', 'tagBlacklist') and isinstance(v, list):
                self.config[k] = self._clean_tag_list(v)

    def _on_ws_message(self, text):
        # 导航、同步与翻屏都在 GUI 线程更新同一份阅读状态。
        self.root.after(0, self._apply_ws_message, text)

    def _apply_ws_message(self, text):
        try:
            data = json.loads(text)
            action = data.get('action')
            if action == 'toggle_minimal_mode':
                if 'minimalMode' in data:
                    self.config['minimalMode'] = bool(data['minimalMode'])
                else:
                    self.config['minimalMode'] = not self.config.get('minimalMode', False)
                self._save_config()
                self._apply_layout_and_mode()
                self._update_display()
                return
            elif action == 'toggle_privacy_mode':
                if 'privacyMode' in data:
                    self.config['privacyMode'] = bool(data['privacyMode'])
                else:
                    self.config['privacyMode'] = not self.config.get('privacyMode', False)
                self._save_config()
                if not self.config['privacyMode']:
                    self.root.after(0, lambda: self.root.wm_attributes("-alpha", self.alpha))
                else:
                    self.root.after(50, self._check_privacy_mouse_leave)
                return
            elif action == 'toggle_layout_mode':
                if 'layoutMode' in data:
                    self.config['layoutMode'] = data['layoutMode']
                else:
                    cur = self.config.get('layoutMode', 'double')
                    self.config['layoutMode'] = 'single' if cur == 'double' else 'double'
                self._save_config()
                self._apply_layout_and_mode()
                self._update_display()
                return
            elif action == 'set_window_width':
                width = data.get('barWidth')
                if not self._is_resizing and type(width) is int and 360 <= width <= 3840:
                    self.set_window_width(width)
                return
            elif action == 'toggle_boss':
                # 托盘助手的全局老板键走这条：不带 bossKey 就翻转，带了就按指定状态（幂等）
                forced = data.get('bossKey')
                self.toggle_boss(forced if isinstance(forced, bool) else None)
                return
            elif action == 'set_auto_boss':
                self.set_auto_boss(data.get('sec'), announce=False)
                self.server.broadcast({'action': 'auto_boss_state', **self._auto_boss_state()})
                return
            elif action == 'query_auto_boss':
                self.server.broadcast({'action': 'auto_boss_state', **self._auto_boss_state()})
                return
            elif action == 'set_boss_style':
                self.set_boss_style(data.get('style'), announce=False)
                self.server.broadcast({'action': 'boss_style', 'style': self._boss_style_id()})
                return
            elif action == 'query_boss_style':
                self.server.broadcast({'action': 'boss_style', 'style': self._boss_style_id()})
                return

            if data.get('type') == 'sync':
                new_sentence = data.get('currentSentence', '')
                new_floor = data.get('floor', 0)
                new_cur = data.get('curIdx', 1)
                chat_id = data.get('chatId', self._chat_id)
                chat_changed = chat_id != self._chat_id
                self._chat_id = chat_id
                if chat_changed:
                    self._clear_floor_step()
                floor_changed = new_floor != self.floor
                nav_changed = chat_changed or floor_changed or new_cur != self.cur_idx
                page_edge = data.get('pageEdge')
                queued_navigation = None
                if self._pending_floor_step is not None:
                    request_id, direction = self._pending_floor_step
                    reply_id = data.get('floorRequest')
                    # 旧版桥接没有请求标识，按楼层变动方向识别这次响应。
                    legacy_reply = ('floorRequest' not in data and floor_changed
                                    and (new_floor - self.floor) * direction > 0)
                    if reply_id == request_id or legacy_reply:
                        if legacy_reply and page_edge is None:
                            page_edge = 'last' if direction < 0 else 'first'
                        queued_navigation = self._queued_navigation
                        self._clear_floor_step()
                full_text = data.get('fullText')
                self._has_full_text = isinstance(full_text, str)
                if self._has_full_text:
                    self._stream_parts = None
                    self.stream_text = full_text
                    if floor_changed and page_edge == 'last':
                        self._reading_offset = max(0, len(full_text) - 1)
                    elif page_edge == 'first':
                        self._reading_offset = 0
                    elif nav_changed:
                        offset = data.get('sentenceOffset')
                        self._reading_offset = offset if type(offset) is int and offset >= 0 else 0
                else:
                    # 旧版桥接只同步单句，继续累计已收到的句子。
                    parts = getattr(self, '_stream_parts', None) or []
                    cur_i = new_cur if isinstance(new_cur, int) else 1
                    prev_floor = self.floor if not chat_changed else None
                    parts, offset = self._accumulate_stream(parts, prev_floor, new_floor, cur_i, new_sentence)
                    self._stream_parts = parts
                    self.stream_text = ''.join(seg for _, seg in parts)
                    if nav_changed:
                        self._reading_offset = offset
                resume_floor = data.get('resumeFloor', new_floor)
                if self._resume_offset is not None:
                    same_chat = self._resume_chat_id is None or self._resume_chat_id == chat_id
                    if (same_chat and new_floor == self._resume_floor and page_edge != 'last'
                            and (resume_floor == self._resume_floor or nav_changed or page_edge == 'first')):
                        self._reading_offset = self._resume_offset
                    if resume_floor == self._resume_floor:
                        self._clear_pending_resume()
                self.char_name = data.get('charName', 'AI')
                self.user_name = data.get('userName', 'User')
                self.floor = new_floor
                self.cur_idx = new_cur
                self.total_sentences = data.get('totalSentences', 1)
                self.current_sentence = new_sentence
                self.is_boss_key = data.get('isBossKey', False)
                self._apply_generation_status(data)
                choices = data.get('replyChoices')
                choices = tuple(s for s in choices[:12] if isinstance(s, str) and 0 < len(s) <= 2000) if isinstance(choices, list) else ()
                if chat_changed or floor_changed or choices != self.reply_choices:
                    self._close_reply_choices()
                    self.reply_choices = choices
                config = data.get('config')
                if isinstance(config, dict):
                    old_min = self.config.get('minimalMode')
                    old_layout = self.config.get('layoutMode')
                    self._merge_sync_config(config)
                    if (old_min != self.config.get('minimalMode') or
                        old_layout != self.config.get('layoutMode')):
                        self._apply_layout_and_mode()
                # 旧版用快照同步宽度。记录上次收到的值，普通阅读同步不覆盖本地调整。
                width = config.get('barWidth', data.get('barWidth')) if isinstance(config, dict) else data.get('barWidth')
                if type(width) in (int, float) and 360 <= width <= 3840:
                    previous_width = self._legacy_width
                    self._legacy_width = int(width)
                    if not self._is_resizing and previous_width not in (None, self._legacy_width):
                        self.width = self._legacy_width
                        self._save_config()
                self._synced_once = True
                self._update_display()
                if queued_navigation is not None:
                    command, delta = queued_navigation
                    command(delta)
        except Exception as e:
            print(f"[UI Sync Error]: {e}")

    def _update_display(self):
        # 老板键进出在此统一收口（本地切换与 WS 同步都会走到）：进入存草稿，退出恢复
        was_boss = getattr(self, '_displayed_boss_key', False)
        if self.is_boss_key != was_boss:
            if self.is_boss_key:
                self._boss_reply_draft = self.entry_reply.get()
            else:
                # 占位文案被改动过就保留用户新输入的内容，只有还是占位原文才恢复草稿
                if self.entry_reply.get() in BOSS_PLACEHOLDERS:
                    self.entry_reply.delete(0, tk.END)
                    draft = getattr(self, '_boss_reply_draft', '')
                    if draft:
                        self.entry_reply.insert(0, draft)
                self._boss_reply_draft = ''
            self._displayed_boss_key = self.is_boss_key
        if self.is_boss_key:
            self._close_reply_choices()
            self._update_reply_indicators()
            disguise = self._boss_style()
            self._ensure_boss_chrome()
            live = self._live_disguise_parts(disguise.get('live'))
            branch = (live or {}).get('branch') or disguise['branch']
            text = (live or {}).get('text') or disguise['text']
            right = (live or {}).get('right') or disguise['right']
            self.lbl_branch.configure(text=branch)
            if hasattr(self, 'lbl_floor'):
                self.lbl_floor.configure(text="")
            self.lbl_char.configure(text="", bg=self.theme['bg'])
            self.lbl_text.configure(text=text, wraplength=0)
            self.lbl_right_info.configure(text=right)
            self.lbl_prefix.configure(text=disguise['prefix'])
            # 仅在进入时、输入框空时、或仍是某个占位文案时才重写，避免冲掉用户正在输入的草稿
            current = self.entry_reply.get()
            if not was_boss or not current or current in BOSS_PLACEHOLDERS:
                if current != disguise['reply']:
                    self.entry_reply.delete(0, tk.END)
                    self.entry_reply.insert(0, disguise['reply'])
            self._update_geometry_and_wrap()
            return

        # 退出伪装：把被强制放出来的左右两翼/前缀交还给极简模式自己决定，
        # 楼层导航和 ⋮ 按钮也要还回去
        if getattr(self, '_boss_chrome_forced', False):
            self._boss_chrome_forced = False
            self._apply_layout_and_mode()
        self._set_boss_chrome_extra(False)

        self.lbl_branch.configure(text="⎇ main*")
        floor_str = f"#{self.floor} ▾" if self.floor >= 0 else "#-- ▾"
        if hasattr(self, 'lbl_floor'):
            self.lbl_floor.configure(text=floor_str)

        self._update_reply_indicators()

        if not self.config.get('minimalMode', False):
            mode = self.config.get('charNameMode', 'compact')
            name = self.char_name
            if mode == 'compact' and len(name) > 6:
                name = name[:5] + "…"
            self.lbl_char.configure(
                text=f"[{name}]:",
                fg=self.theme['char'],
                bg="#1e2e28"
            )

        self._apply_narrow_chrome()
        self.lbl_prefix.configure(text=" >")
        self._update_geometry_and_wrap()
        self._update_reading_view()
        self._schedule_position_save()

    def _update_reading_view(self):
        width = self.lbl_text.winfo_width()
        if width <= 1:
            return  # 初次布局由正文视口的 Configure 事件触发。
        if self.config.get('pagedReading', True):
            stream = self._stream()
            key = (stream, width, self.config.get('fontSize', 9))
            if key != getattr(self, '_pfx_key', None):
                self._pages = self._compute_pages(stream, width)
                self._pfx_key = key
            self._page_idx = self._page_index_for_offset(self._reading_offset)
            self._render_page()
        else:
            text = self._truncate_to_width(self.current_sentence.strip(), width)
            self.lbl_text.configure(text=text, wraplength=0, justify=tk.LEFT)
        self.lbl_right_info.configure(text=self._progress_text())

    def _pid_file_path(self):
        return os.path.join(os.path.dirname(self.config_file), PID_FILENAME)

    def run(self):
        pid_path = self._pid_file_path()
        try:
            with open(pid_path, 'w', encoding='utf-8') as f:
                f.write(str(os.getpid()))
        except Exception:
            pass
        try:
            self.root.mainloop()
        finally:
            if getattr(self, '_idle_job', None):
                try:
                    self.root.after_cancel(self._idle_job)
                except Exception:
                    pass
                self._idle_job = None
            self._save_window_position()
            self._save_position_now()
            try:
                with open(pid_path, 'r', encoding='utf-8') as f:
                    owner_pid = f.read().strip()
                if owner_pid == str(os.getpid()):
                    os.remove(pid_path)
            except Exception:
                pass


def _existing_instance_alive():
    """同目录下已经有活着的摸鱼条就返回 True，避免起两个条（双 bind 会把消息投给其中一个）。"""
    pid_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), PID_FILENAME)
    try:
        with open(pid_path, 'r', encoding='utf-8') as f:
            pid = int(f.read().strip())
    except Exception:
        return False
    if pid <= 0 or pid == os.getpid():
        return False
    if not sys.platform.startswith('win'):
        return False
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        handle = k32.OpenProcess(0x1000, False, pid)   # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = k32.GetExitCodeProcess(handle, ctypes.byref(code))
        k32.CloseHandle(handle)
        return bool(ok) and code.value == 259          # STILL_ACTIVE
    except Exception:
        return False


if __name__ == '__main__':
    if sys.platform.startswith('win'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    if _existing_instance_alive():
        print("[Thief Bar] 已有实例在运行，本实例直接退出（避免出现两条状态栏）", flush=True)
        sys.exit(0)

    print("""
===================================================
 正在启动 ST-Thief-Book 桌面原生摸鱼状态栏 (v3.6)
 请在酒馆助手（Tavern Helper）中导入并启用 st-thief-book.json
 快捷操作说明:
   - 鼠标右键点击任意处 : 呼出极简模式/切换楼层/微调透明度等全功能菜单
   - 鼠标左键点击正文   : 整段分屏翻到下一屏（读完整条进入下一楼）
   - 鼠标左键按住拖动   : 随意拖拽移动摸鱼条位置
   - 方向键 ← / →       : 上一屏 / 下一屏 (或 J / K / 滚轮)
   - Ctrl + 滚轮        : 缩放正文字号 (8 ~ 12pt)
   - PageUp / PageDown  : 上一楼 / 下一楼
   - Enter (双行模式)   : 就地输入回复并回车发送
   - Esc                : 一键老板键（秒切纯代码伪装）
   - Alt + T / Y        : 循环切换主题（= 伪装风格，开发 7 / 办公 2 / 影音 2 / 系统 5）
   - 无操作自动伪装     : 设置/右键菜单拖时间滑块，空闲到点自动切伪装
   - Alt + 1 ~ 9        : 快速切换透明度 (15% ~ 100%)
===================================================
""", flush=True)
    app = ThiefDesktopBar()
    app.run()
