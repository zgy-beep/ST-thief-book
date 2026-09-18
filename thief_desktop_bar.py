#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
======================================================================================
ST-Thief-Desktop-Bar: 酒馆助手桌面原生双行摸鱼状态栏 (仿 VS Code Thief-Book)
======================================================================================
特点：
1. 零第三方依赖：纯 Python 原生标准库实现（tkinter + socket + threading）
2. 双行边看边回：
   - 第一行：正文阅读行，展示角色名、小说逐句、阅读进度，点击文字或滚轮翻句
   - 第二行：单行回复行，输入框常驻就地输入，回车直接发送触发 AI
3. 鼠标随意拖拽：按住状态栏空白处即可拖拽移动位置
4. 全套快捷键：
   - 方向键 ← / → 或 J / K: 上一句 / 下一句
   - 鼠标滚轮: 上一句 / 下一句
   - 点击正文: 直接翻到下一句
   - Enter (输入框内): 发送回复并触发 AI 续写
   - Esc: 一键老板键（秒变纯净代码编译与 Git 状态）
   - Alt + S: 触发重 roll (Swipe)
   - Alt + X: 中止 AI 生成
   - Alt + T: 切换主题（深暗 / 经典蓝）
   - Alt + 1 ~ 9: 快速调整透明度 (50% ~ 100%)
======================================================================================
"""

import sys
import os
import time
import json
import socket
import select
import struct
import base64
import hashlib
import threading
import tkinter as tk
from tkinter import font as tkfont

WS_HOST = '127.0.0.1'
WS_PORT = 18899
MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

# ------------------------------------------------------------------------------------
# 零依赖轻量 RFC 6455 WebSocket 服务端实现
# ------------------------------------------------------------------------------------
class SimpleWebSocketServer:
    def __init__(self, host, port, on_message_callback):
        self.host = host
        self.port = port
        self.on_message = on_message_callback
        self.clients = set()
        self.server_sock = None
        self.running = False
        self.lock = threading.Lock()

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
        try:
            req = b""
            while b"\r\n\r\n" not in req:
                chunk = sock.recv(1024)
                if not chunk:
                    return
                req += chunk

            headers = {}
            lines = req.decode('utf-8', errors='ignore').split("\r\n")
            for line in lines[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

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
                self.clients.add(sock)
            print("[WebSocket Server] 酒馆助手前端已连接！")

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
                    sock.sendall(bytes([0x8A, 0x00]))
                    continue

                if payload_len == 126:
                    payload_len = struct.unpack(">H", sock.recv(2))[0]
                elif payload_len == 127:
                    payload_len = struct.unpack(">Q", sock.recv(8))[0]

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
                        self.on_message(text)
                    except Exception as err:
                        print(f"[WebSocket Server] 解析消息异常: {err}")

        except Exception:
            pass
        finally:
            with self.lock:
                if sock in self.clients:
                    self.clients.remove(sock)
            try:
                sock.close()
            except Exception:
                pass
            print("[WebSocket Server] 客户端连接断开")

    def broadcast(self, data_dict):
        text = json.dumps(data_dict, ensure_ascii=False)
        payload = text.encode('utf-8')
        length = len(payload)

        if length <= 125:
            header = bytes([0x81, length])
        elif length <= 65535:
            header = struct.pack(">BBH", 0x81, 126, length)
        else:
            header = struct.pack(">BBQ", 0x81, 127, length)

        frame = header + payload
        with self.lock:
            dead = []
            for c in self.clients:
                try:
                    c.sendall(frame)
                except Exception:
                    dead.append(c)
            for d in dead:
                self.clients.remove(d)


# ------------------------------------------------------------------------------------
# 桌面原生双行摸鱼状态栏 GUI
# ------------------------------------------------------------------------------------
class ThiefDesktopBar:
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
        },
        'vscode-blue': {
            'bg': '#007acc',
            'row2_bg': '#006ab3',
            'fg': '#ffffff',
            'border': '#0062a3',
            'char': '#ffe699',
            'input_bg': '#005994',
            'input_fg': '#ffffff',
            'accent': '#ffffff'
        }
    }

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("VS Code Status Bar")

        self.root.overrideredirect(True)
        self.root.wm_attributes("-topmost", True)
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
        self.is_boss_key = False
        self.is_generating = False
        self._sub_chunks = []
        self._sub_chunk_idx = 0
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
            'filterMode': 'pure'
        }

        self.width = 860
        self.height = 68
        try:
            self.config_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "thief_bar_config.json")
        except Exception:
            self.config_file = os.path.join(os.path.expanduser("~"), ".st_thief_bar_config.json")
        self._load_config()

        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        pos_x = max(0, (screen_w - self.width) // 2)
        pos_y = max(0, screen_h - self.height - 45)
        self.root.geometry(f"{self.width}x{self.height}+{pos_x}+{pos_y}")

        self.font_main = tkfont.Font(family="Segoe UI", size=9)
        self.font_bold = tkfont.Font(family="Segoe UI", size=9, weight="bold")
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
        self._bind_events()

        self.server = SimpleWebSocketServer(WS_HOST, WS_PORT, self._on_ws_message)
        self.server.start()

    def _load_config(self):
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                    if isinstance(saved, dict):
                        if 'barWidth' in saved and isinstance(saved['barWidth'], (int, float)):
                            self.width = max(360, min(2560, int(saved['barWidth'])))
                        if 'alpha' in saved and isinstance(saved['alpha'], (int, float)):
                            self.alpha = max(0.15, min(1.0, float(saved['alpha'])))
                            self.root.wm_attributes("-alpha", self.alpha)
                        if 'theme' in saved and saved['theme'] in self.THEMES:
                            self.theme_name = saved['theme']
                            self.theme = self.THEMES[self.theme_name]
                        for k in ['minimalMode', 'layoutMode', 'charNameMode', 'wrapMode',
                                  'showUserMessages', 'enableWhitelist', 'tagWhitelist', 'tagBlacklist',
                                  'filterActions', 'filterMode']:
                            if k in saved:
                                self.config[k] = saved[k]
        except Exception as e:
            print(f"[Load Config Error]: {e}", flush=True)

    def _save_config(self):
        try:
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
                'filterMode': self.config.get('filterMode', 'pure')
            }
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            try:
                home_cfg = os.path.join(os.path.expanduser("~"), ".st_thief_bar_config.json")
                with open(home_cfg, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                self.config_file = home_cfg
            except Exception as err:
                print(f"[Save Config Error]: {err}", flush=True)

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

        self.btn_floor_prev = tk.Label(
            self.floor_frame, text="▲", font=self.font_mono,
            bg="#252526", fg="#888888", cursor="hand2", padx=3
        )
        self.btn_floor_prev.pack(side=tk.LEFT)
        self.btn_floor_prev.bind("<Button-1>", lambda e: self.action_floor_prev())

        self.lbl_floor = tk.Label(
            self.floor_frame, text="#0 ▾", font=self.font_mono,
            bg="#252526", fg="#9cdcfe", cursor="hand2", padx=4
        )
        self.lbl_floor.pack(side=tk.LEFT)
        self.lbl_floor.bind("<Button-1>", lambda e: self.open_floor_jump_dialog())

        self.btn_floor_next = tk.Label(
            self.floor_frame, text="▼", font=self.font_mono,
            bg="#252526", fg="#888888", cursor="hand2", padx=3
        )
        self.btn_floor_next.pack(side=tk.LEFT)
        self.btn_floor_next.bind("<Button-1>", lambda e: self.action_floor_next())

        self.lbl_spin = tk.Label(
            self.left_frame, text="", font=self.font_main,
            bg=self.theme['bg'], fg='#dcdcaa'
        )
        self.lbl_spin.pack(side=tk.LEFT, padx=(4, 0))

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

        # 1.3 中间正文阅读（支持自动换行，长句折行全显绝不漏字截断；点击文字直接下一句）
        self.center_frame = tk.Frame(self.row1, bg=self.theme['bg'])
        self.center_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=8)

        self.lbl_char = tk.Label(
            self.center_frame, text="[ST]:", font=self.font_bold,
            bg="#1e2e28", fg=self.theme['char'], cursor="hand2", padx=5, pady=0
        )
        self.lbl_char.pack(side=tk.LEFT, padx=(0, 6))
        self.lbl_char.bind("<Button-1>", lambda e: self.cycle_char_name_mode())

        self.lbl_text = tk.Label(
            self.center_frame, text=self.current_sentence, font=self.font_main,
            bg=self.theme['bg'], fg=self.theme['fg'], anchor="w", cursor="hand2",
            justify=tk.LEFT, wraplength=620
        )
        self.lbl_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.lbl_text.bind("<ButtonPress-1>", self._start_drag)
        self.lbl_text.bind("<B1-Motion>", self._on_drag)
        self.lbl_text.bind("<ButtonRelease-1>", self._on_text_click_release)
        self.lbl_text.bind("<Configure>", self._on_text_configure)

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
        self.entry_reply.bind("<Return>", self._submit_reply)

        self.btn_send = tk.Label(
            self.row2, text="发送", font=self.font_main,
            bg='#0e639c', fg='#ffffff', cursor="hand2", padx=8, pady=1
        )
        self.btn_send.pack(side=tk.RIGHT, padx=(0, 8))
        self.btn_send.bind("<Button-1>", lambda e: self._submit_reply())

        # 初始化布局与极简模式
        self._apply_layout_and_mode()

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

            char_mode = self.config.get('charNameMode', 'compact')
            if char_mode != 'hidden':
                self.lbl_char.pack_forget()
                self.lbl_char.pack(side=tk.LEFT, padx=(0, 6))
            else:
                self.lbl_char.pack_forget()

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

    def _paginate_sentence(self, text, max_px_width):
        """
        单行顺延切片引擎：
        在高度固定、单行不折行的前提下，将超过当前单行可视像素宽度的文字切分成子行，
        在阅读翻句（'下一行'）时无缝逐段显示，绝不裁剪丢字，绝不扩展高度。
        """
        if not text:
            return [""]
        if max_px_width <= 80:
            max_px_width = 80

        # 若整句像素小于等于单行可用宽度，直接单行完整显示
        if self.font_main.measure(text) <= max_px_width:
            return [text]

        lines = []
        remaining = text
        break_puncts = set("，,、 ；;。！？!?—~～…\n")

        while remaining:
            if self.font_main.measure(remaining) <= max_px_width:
                lines.append(remaining)
                break

            # 二分查找当前单行可用像素内最多能容纳的字符数
            low = 1
            high = len(remaining)
            best = 1
            while low <= high:
                mid = (low + high) // 2
                if self.font_main.measure(remaining[:mid]) <= max_px_width:
                    best = mid
                    low = mid + 1
                else:
                    high = mid - 1

            # 优先在末尾附近的标点符号处断开，使阅读体验更自然
            break_pos = best
            lookback_limit = max(1, best - 8)
            for pos in range(best, lookback_limit - 1, -1):
                if remaining[pos - 1] in break_puncts:
                    break_pos = pos
                    break

            chunk = remaining[:break_pos].strip()
            if not chunk:
                chunk = remaining[:best]
                break_pos = best

            lines.append(chunk)
            remaining = remaining[break_pos:].strip()

        return lines if lines else [text]

    def _update_geometry_and_wrap(self, override_x=None, override_y=None):
        if not hasattr(self, 'lbl_text') or not self.lbl_text.winfo_exists():
            return

        is_min = self.config.get('minimalMode', False)
        is_single = self.config.get('layoutMode', 'double') == 'single'

        # 高度恒定不变：严禁向下撑大窗口
        if is_min:
            self.height = 30 if is_single else 56
        else:
            self.height = 36 if is_single else 68

        # 严格保持单行，不显示在第二行
        self.lbl_text.configure(wraplength=0)

        # 保持当前绝对坐标（支持多显示器、副屏负坐标与超宽坐标，绝不发生跨屏漂移）
        cur_x = override_x if override_x is not None else self.root.winfo_x()
        cur_y = override_y if override_y is not None else self.root.winfo_y()

        self.root.geometry(f"{self.width}x{self.height}+{cur_x}+{cur_y}")

    def _on_text_configure(self, event):
        pass

    def _cmd(self, func, *args, **kwargs):
        def _handler():
            if getattr(self, 'context_menu', None):
                try:
                    self.context_menu.unpost()
                except Exception:
                    pass
            func(*args, **kwargs)
        return _handler

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

        # 1. 核心模式切换
        min_label = "✨ 极简模式 [✓ 已开启]" if is_min else "✨ 极简模式 [未开启]"
        self.context_menu.add_command(label=min_label, command=self._cmd(self.toggle_minimal_mode))

        layout_label = "↕ 布局: 切换为双行 (含回复)" if is_single else "↕ 布局: 切换为单行极窄"
        self.context_menu.add_command(label=layout_label, command=self._cmd(self.toggle_layout_mode))

        self.context_menu.add_separator()

        # 2. 楼层控制 (右键直接换楼与展示当前楼层)
        floor_info = f"📖 当前楼层: #{self.floor} (句 {self.cur_idx}/{self.total_sentences})"
        self.context_menu.add_command(label=floor_info, command=self._cmd(self.open_floor_jump_dialog))
        self.context_menu.add_command(label="▲ 上一楼 (PageUp)", command=self._cmd(self.action_floor_prev))
        self.context_menu.add_command(label="▼ 下一楼 (PageDown)", command=self._cmd(self.action_floor_next))
        self.context_menu.add_command(label="⏮ 首楼 (#0)", command=self._cmd(lambda: self.action_floor_jump(0)))
        self.context_menu.add_command(label="🔢 快速输入楼层跳转...", command=self._cmd(self.open_floor_jump_dialog))

        self.context_menu.add_separator()

        # 3. 阅读翻句与生成
        self.context_menu.add_command(label="‹ 上一句 (← / J / 滚轮上)", command=self._cmd(self.action_prev))
        self.context_menu.add_command(label="› 下一句 (→ / K / 滚轮下 / 点击)", command=self._cmd(self.action_next))
        self.context_menu.add_command(label="⟲ 重卷回复 (Alt+S)", command=self._cmd(self.action_swipe))
        self.context_menu.add_command(label="⏹ 中止生成 (Alt+X)", command=self._cmd(self.action_stop))

        self.context_menu.add_separator()

        # 4. 显示与透明度设置
        is_wrap = self.config.get('wrapMode', 'wrap') == 'wrap'
        wrap_label = "↩ 换行模式: 自动折行全显" if is_wrap else "↩ 换行模式: 强制单行"
        self.context_menu.add_command(label=wrap_label, command=self._cmd(self.toggle_wrap_mode))

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
        width_menu.add_command(label="✨ 自动适应文字长短 (Ctrl+↑)", command=self._cmd(self.auto_fit_text_length))
        width_menu.add_command(label="➕ 加长 +100px (Ctrl+→)", command=self._cmd(lambda: self.change_window_width(100)))
        width_menu.add_command(label="➖ 缩短 -100px (Ctrl+←)", command=self._cmd(lambda: self.change_window_width(-100)))
        width_menu.add_separator()
        width_presets = [
            ("480px (极窄紧凑)", 480),
            ("680px (紧凑摸鱼)", 680),
            ("860px (标准默认)", 860),
            ("1080px (宽屏舒适)", 1080),
            ("1360px (超宽长句)", 1360)
        ]
        for name, val in width_presets:
            mark = " ✓" if abs(self.width - val) <= 15 else ""
            width_menu.add_command(label=f"{name}{mark}", command=self._cmd(lambda v=val: self.set_window_width(v)))
        width_menu.add_separator()
        width_menu.add_command(label="✏️ 滑块精确微调长度...", command=self._cmd(self.open_custom_width_dialog))
        self.context_menu.add_cascade(label=f"📏 窗口长度 ({self.width}px)", menu=width_menu)

        if not is_min:
            self.context_menu.add_command(label="👤 切换角色名显示模式", command=self._cmd(self.cycle_char_name_mode))

        # 窗口透明度子菜单 (丰富预设 + 滑块微调)
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
            ("100% 完全不透明 (Alt+9)", 1.0),
            ("90% 经典深色", 0.9),
            ("80% 轻度透明 (Alt+8)", 0.8),
            ("70% 舒适摸鱼 (Alt+7)", 0.7),
            ("50% 半透明隐蔽 (Alt+5)", 0.5),
            ("30% 极淡幽灵 (Alt+3)", 0.3),
            ("15% 极限隐身 (Alt+1)", 0.15)
        ]
        for name, val in presets:
            mark = " ✓" if abs(cur_pct - int(round(val * 100))) <= 3 else ""
            opacity_menu.add_command(label=f"{name}{mark}", command=self._cmd(lambda v=val: self.set_opacity(v)))
        opacity_menu.add_separator()
        opacity_menu.add_command(label="✏️ 滑块精确微调透明度...", command=self._cmd(self.open_custom_opacity_dialog))
        self.context_menu.add_cascade(label=f"🌓 窗口透明度 ({cur_pct}%)", menu=opacity_menu)

        show_user = self.config.get('showUserMessages', False)
        user_lbl = "💬 用户消息: ✓ 显示中" if show_user else "💬 用户消息: 隐藏 (仅看AI)"
        self.context_menu.add_command(label=user_lbl, command=self._cmd(self.toggle_show_user_messages))

        self.context_menu.add_command(label="🎨 切换主题 (Alt+T)", command=self._cmd(self.toggle_theme))

        self.context_menu.add_separator()

        # 5. 系统控制与设置
        boss_label = "🕶️ 退出老板键伪装 (Esc)" if self.is_boss_key else "🕶️ 一键老板键 (Esc)"
        self.context_menu.add_command(label=boss_label, command=self._cmd(self.toggle_boss))
        self.context_menu.add_command(label="⚙️ 白名单/黑名单设置...", command=self._cmd(self.open_settings_dialog))
        self.context_menu.add_separator()
        self.context_menu.add_command(label="✕ 退出摸鱼状态栏", command=self._cmd(self.root.quit))

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

        self.root.bind("<Right>", lambda e: self.action_next())
        self.root.bind("<Left>", lambda e: self.action_prev())
        self.root.bind("<k>", lambda e: self.action_next())
        self.root.bind("<j>", lambda e: self.action_prev())
        self.root.bind("<Escape>", lambda e: self.toggle_boss())

        self.root.bind("<Alt-s>", lambda e: self.action_swipe())
        self.root.bind("<Alt-S>", lambda e: self.action_swipe())
        self.root.bind("<Alt-x>", lambda e: self.action_stop())
        self.root.bind("<Alt-X>", lambda e: self.action_stop())
        self.root.bind("<Alt-t>", lambda e: self.toggle_theme())
        self.root.bind("<Alt-T>", lambda e: self.toggle_theme())

        self.root.bind("<Prior>", lambda e: self.action_floor_prev())
        self.root.bind("<Next>", lambda e: self.action_floor_next())

        # 键盘宽度调节快捷键 (Ctrl+Right 加长, Ctrl+Left 缩短, Ctrl+Up 自动适应)
        def _on_ctrl_right(e):
            if e.widget == getattr(self, 'entry_reply', None):
                return
            self.change_window_width(100)
            return "break"

        def _on_ctrl_left(e):
            if e.widget == getattr(self, 'entry_reply', None):
                return
            self.change_window_width(-100)
            return "break"

        def _on_ctrl_up(e):
            self.auto_fit_text_length()
            return "break"

        self.root.bind("<Control-Right>", _on_ctrl_right)
        self.root.bind("<Control-Left>", _on_ctrl_left)
        self.root.bind("<Control-Up>", _on_ctrl_up)

        for n in range(1, 10):
            self.root.bind(f"<Alt-Key-{n}>", lambda e, val=n: self.set_opacity(val / 10.0))

    def _bind_mouse_drag_and_motion(self, widget):
        excluded_from_drag = {
            getattr(self, 'entry_reply', None),
            getattr(self, 'btn_floor_prev', None),
            getattr(self, 'lbl_floor', None),
            getattr(self, 'btn_floor_next', None),
            getattr(self, 'lbl_right_info', None),
            getattr(self, 'btn_menu', None),
            getattr(self, 'lbl_char', None),
            getattr(self, 'btn_send', None)
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
            new_x = event.x_root - self._drag_offset_x
            new_y = event.y_root - self._drag_offset_y
            self.root.geometry(f"+{new_x}+{new_y}")

    def _on_drag_release(self, event):
        if getattr(self, '_is_resizing', False):
            self._is_resizing = False
            self._resize_mode = None
            self._save_config()
            self.server.broadcast({
                'action': 'set_window_width',
                'barWidth': self.width
            })

    def _on_text_click_release(self, event):
        if getattr(self, '_is_resizing', False):
            self._on_drag_release(event)
            return
        if not getattr(self, '_has_dragged', False):
            if not self.is_boss_key:
                self.action_next()
        self._has_dragged = False

    def set_window_width(self, w):
        self.width = max(360, min(3840, int(w)))
        self._update_display()
        self._save_config()
        self.server.broadcast({
            'action': 'set_window_width',
            'barWidth': self.width
        })

    def change_window_width(self, delta):
        self.set_window_width(self.width + delta)

    def auto_fit_text_length(self):
        if not self.current_sentence:
            return
        text_w = self.font_main.measure(self.current_sentence)
        is_min = self.config.get('minimalMode', False)
        if is_min:
            other_w = 40
            min_limit = 380
        else:
            char_mode = self.config.get('charNameMode', 'compact')
            char_w = 0 if char_mode == 'hidden' else 65
            other_w = 320 + char_w
            min_limit = 520

        max_limit = 2560

        # 理想单行容纳长度
        ideal_w = text_w + other_w
        if ideal_w <= max_limit:
            target_w = max(min_limit, ideal_w)
        else:
            target_w = min(max_limit, max(860, (text_w // 2) + other_w))

        self.set_window_width(target_w)

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
            win, from_=360, to=2560, orient=tk.HORIZONTAL,
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
        if self.is_boss_key:
            return
        if event.delta < 0:
            self.action_next()
        else:
            self.action_prev()

    def action_next(self):
        if self.is_boss_key:
            return
        # 若当前长句还有未显示完全的顺延子行，先在当前单行条中显示下一行
        if hasattr(self, '_sub_chunks') and self._sub_chunk_idx < len(self._sub_chunks) - 1:
            self._sub_chunk_idx += 1
            self._update_display()
            return

        # 当前句所有顺延行已读完，向酒馆请求下一句
        self._sub_chunk_idx = 0
        self.server.broadcast({'action': 'next'})

    def action_prev(self):
        if self.is_boss_key:
            return
        # 若处于当前长句的后续顺延子行，倒退回上一行显示
        if hasattr(self, '_sub_chunks') and self._sub_chunk_idx > 0:
            self._sub_chunk_idx -= 1
            self._update_display()
            return

        # 已处于当前句第一行，倒退回上一句
        self._sub_chunk_idx = 0
        self.server.broadcast({'action': 'prev'})

    def action_floor_prev(self):
        if self.is_boss_key:
            return
        self.server.broadcast({'action': 'change_floor', 'delta': -1})

    def action_floor_next(self):
        if self.is_boss_key:
            return
        self.server.broadcast({'action': 'change_floor', 'delta': 1})

    def action_floor_jump(self, floor):
        if self.is_boss_key:
            return
        try:
            val = int(floor)
            self.server.broadcast({'action': 'jump_floor', 'floor': val})
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

    def toggle_wrap_mode(self):
        if self.is_boss_key:
            return
        cur = self.config.get('wrapMode', 'wrap')
        self.config['wrapMode'] = 'single' if cur == 'wrap' else 'wrap'
        self._save_config()
        self.server.broadcast({'action': 'toggle_wrap_mode'})
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
            self.server.broadcast({'action': 'change_floor', 'delta': delta})
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
        self.server.broadcast({'action': 'swipe'})

    def action_stop(self):
        self.server.broadcast({'action': 'stop'})

    def toggle_boss(self, forced_state=None):
        self.is_boss_key = not self.is_boss_key if forced_state is None else forced_state
        self.server.broadcast({'action': 'boss'})
        self._update_display()

    def _submit_reply(self, event=None):
        text = self.entry_reply.get().strip()
        if text:
            self.server.broadcast({'action': 'reply', 'text': text})
            self.entry_reply.delete(0, tk.END)

    def toggle_theme(self):
        self.theme_name = 'vscode-blue' if self.theme_name == 'vscode-dark' else 'vscode-dark'
        self.theme = self.THEMES[self.theme_name]
        self._apply_theme()
        self._save_config()

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
        self.lbl_spin.configure(bg=self.theme['bg'])
        if hasattr(self, 'lbl_right_info'):
            badge_bg = "#252526" if self.theme_name == 'vscode-dark' else "#005a94"
            self.lbl_right_info.configure(bg=badge_bg, fg='#9cdcfe' if self.theme_name == 'vscode-dark' else '#ffffff')
        if hasattr(self, 'btn_menu'):
            self.btn_menu.configure(bg=self.theme['bg'], fg=self.theme['fg'])
        if hasattr(self, 'floor_frame'):
            f_bg = "#252526" if self.theme_name == 'vscode-dark' else "#005a94"
            self.floor_frame.configure(bg=f_bg)
            self.btn_floor_prev.configure(bg=f_bg, fg=self.theme['fg'])
            self.lbl_floor.configure(bg=f_bg, fg=self.theme['char'] if self.theme_name == 'vscode-blue' else '#9cdcfe')
            self.btn_floor_next.configure(bg=f_bg, fg=self.theme['fg'])
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
        win.geometry("560x630")
        win.configure(bg="#1e1e1e")
        win.wm_attributes("-topmost", True)
        self._settings_win = win

        # 头部标题
        hdr = tk.Label(win, text="⚙️ ST-Thief-Book 摸鱼过滤与白名单/黑名单设置", font=self.font_bold, bg="#1e1e1e", fg="#4ec9b0")
        hdr.pack(anchor="w", padx=14, pady=(12, 6))

        # ------------------ 0. 极简模式与布局风格 ------------------
        mode_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        mode_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        tk.Label(
            mode_group, text="✨ 界面风格与单双行布局 (参考纯净文字风格):",
            font=self.font_bold, bg="#1c1e22", fg="#4ec9b0"
        ).pack(anchor="w", padx=8, pady=(6, 2))

        var_min_mode = tk.BooleanVar(value=bool(self.config.get('minimalMode', False)))
        chk_min = tk.Checkbutton(
            mode_group, text="启用极简模式 (纯文字+背景无边框，极度隐蔽无多余按钮)",
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

        # ------------------ 0.1 角色名显示设置 ------------------
        char_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        char_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        tk.Label(
            char_group, text="👤 角色卡名称显示模式 (标准模式下生效):",
            font=self.font_bold, bg="#1c1e22", fg="#4ec9b0"
        ).pack(anchor="w", padx=8, pady=(6, 2))

        var_char_mode = tk.StringVar(value=self.config.get('charNameMode', 'compact'))
        radio_frame = tk.Frame(char_group, bg="#1c1e22")
        radio_frame.pack(anchor="w", padx=8, pady=(2, 6))

        tk.Radiobutton(
            radio_frame, text="精简胶囊 (默认，超长截断至6字)",
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

        # ------------------ 0.5 换行展示设置 ------------------
        wrap_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        wrap_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        tk.Label(
            wrap_group, text="↩️ 换行展示模式 (解决长句截断看不全与跳段问题):",
            font=self.font_bold, bg="#1c1e22", fg="#4ec9b0"
        ).pack(anchor="w", padx=8, pady=(6, 2))

        var_wrap_mode = tk.StringVar(value=self.config.get('wrapMode', 'wrap'))
        wrap_radio_frame = tk.Frame(wrap_group, bg="#1c1e22")
        wrap_radio_frame.pack(anchor="w", padx=8, pady=(2, 6))

        tk.Radiobutton(
            wrap_radio_frame, text="自动折行全显 (默认推荐：长句自动折行显示全部文字，绝不截断丢字)",
            variable=var_wrap_mode, value="wrap",
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT, padx=(0, 8))

        tk.Radiobutton(
            wrap_radio_frame, text="强制单行模式 (超长截断)",
            variable=var_wrap_mode, value="single",
            font=self.font_main, bg="#1c1e22", fg="#cccccc", selectcolor="#141414",
            activebackground="#1c1e22", activeforeground="#ffffff"
        ).pack(side=tk.LEFT)

        # ------------------ 1. 白名单区域 ------------------
        wl_group = tk.Frame(win, bg="#1c1e22", bd=1, relief=tk.SOLID)
        wl_group.pack(fill=tk.X, padx=14, pady=(2, 6))

        var_enable_wl = tk.BooleanVar(value=bool(self.config.get('enableWhitelist', True)))
        chk_wl = tk.Checkbutton(
            wl_group, text="🎯 启用正文白名单容器提取 (推荐：若含白名单标签则优先提取正文)",
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

        def add_wl_tag(tag):
            cur = txt_whitelist.get("1.0", tk.END).strip()
            tags = [t.strip().strip('<>[]') for t in cur.replace('\n', ',').replace('，', ',').split(',') if t.strip()]
            if tag not in tags:
                tags.append(tag)
                txt_whitelist.delete("1.0", tk.END)
                txt_whitelist.insert("1.0", ", ".join(tags))

        for chip_tag in ['content', 'output', 'response', 'dialogue', 'story', 'reply', 'text', '正文']:
            lbl = tk.Label(wl_chips_frame, text=f"+{chip_tag}", font=self.font_main, bg="#252526", fg="#4ec9b0", padx=4, pady=1, cursor="hand2")
            lbl.pack(side=tk.LEFT, padx=2)
            lbl.bind("<Button-1>", lambda e, t=chip_tag: add_wl_tag(t))

        # ------------------ 2. 黑名单区域 ------------------
        bl_group = tk.Frame(win, bg="#1c1c1c", bd=1, relief=tk.SOLID)
        bl_group.pack(fill=tk.X, padx=14, pady=4)

        tk.Label(
            bl_group, text="🚫 思考与元数据黑名单 (这些标签及其内部内容将被彻底清除):",
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

        def add_bl_tag(tag):
            cur = txt_blacklist.get("1.0", tk.END).strip()
            tags = [t.strip().strip('<>[]') for t in cur.replace('\n', ',').replace('，', ',').split(',') if t.strip()]
            if tag not in tags:
                tags.append(tag)
                txt_blacklist.delete("1.0", tk.END)
                txt_blacklist.insert("1.0", ", ".join(tags))

        for chip_tag in ['think', 'thought', 'cot', 'status', 'bbi_image', 'fox_hugou', 'fox_selc', 'fox_tip', 'details']:
            lbl = tk.Label(bl_chips_frame, text=f"+{chip_tag}", font=self.font_main, bg="#252526", fg="#f48771", padx=4, pady=1, cursor="hand2")
            lbl.pack(side=tk.LEFT, padx=2)
            lbl.bind("<Button-1>", lambda e, t=chip_tag: add_bl_tag(t))

        # ------------------ 3. 其他选项 ------------------
        opt_frame = tk.Frame(win, bg="#1e1e1e")
        opt_frame.pack(fill=tk.X, padx=14, pady=4)

        var_act = tk.BooleanVar(value=bool(self.config.get('filterActions', False)))
        chk_act = tk.Checkbutton(opt_frame, text="过滤动作描写 (*xxx*)", variable=var_act, bg="#1e1e1e", fg="#cccccc", selectcolor="#252526", activebackground="#1e1e1e", activeforeground="#ffffff")
        chk_act.pack(side=tk.LEFT, padx=4)

        var_user = tk.BooleanVar(value=bool(self.config.get('showUserMessages', False)))
        chk_user = tk.Checkbutton(opt_frame, text="显示用户消息 (默认关闭，仅阅读AI/小说回复)", variable=var_user, bg="#1e1e1e", fg="#cccccc", selectcolor="#252526", activebackground="#1e1e1e", activeforeground="#ffffff")
        chk_user.pack(side=tk.LEFT, padx=12)

        # 底部操作按钮
        btn_frame = tk.Frame(win, bg="#1e1e1e")
        btn_frame.pack(fill=tk.X, padx=14, pady=(10, 14))

        def reset_defaults():
            var_min_mode.set(False)
            var_layout_mode.set("double")
            var_char_mode.set("compact")
            var_wrap_mode.set("wrap")
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

        btn_reset = tk.Button(btn_frame, text="恢复默认预设", command=reset_defaults, bg="#333333", fg="#cccccc", bd=0, padx=8, pady=4, cursor="hand2")
        btn_reset.pack(side=tk.LEFT)

        def save_settings():
            raw_wl = txt_whitelist.get("1.0", tk.END).strip()
            wl_tags = [t.strip().strip('<>[]') for t in raw_wl.replace('\n', ',').replace('，', ',').split(',') if t.strip()]
            raw_bl = txt_blacklist.get("1.0", tk.END).strip()
            bl_tags = [t.strip().strip('<>[]') for t in raw_bl.replace('\n', ',').replace('，', ',').split(',') if t.strip()]

            self.config['minimalMode'] = var_min_mode.get()
            self.config['layoutMode'] = var_layout_mode.get()
            self.config['charNameMode'] = var_char_mode.get()
            self.config['wrapMode'] = var_wrap_mode.get()
            self.config['enableWhitelist'] = var_enable_wl.get()
            self.config['tagWhitelist'] = wl_tags
            self.config['tagBlacklist'] = bl_tags
            self.config['filterActions'] = var_act.get()
            self.config['showUserMessages'] = var_user.get()

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

    def _on_ws_message(self, text):
        try:
            data = json.loads(text)
            action = data.get('action')
            if action == 'toggle_minimal_mode':
                if 'minimalMode' in data:
                    self.config['minimalMode'] = bool(data['minimalMode'])
                else:
                    self.config['minimalMode'] = not self.config.get('minimalMode', False)
                self._save_config()
                self.root.after(0, self._apply_layout_and_mode)
                self.root.after(0, self._update_display)
                return
            elif action == 'toggle_layout_mode':
                if 'layoutMode' in data:
                    self.config['layoutMode'] = data['layoutMode']
                else:
                    cur = self.config.get('layoutMode', 'double')
                    self.config['layoutMode'] = 'single' if cur == 'double' else 'double'
                self._save_config()
                self.root.after(0, self._apply_layout_and_mode)
                self.root.after(0, self._update_display)
                return
            elif action == 'set_window_width':
                if 'barWidth' in data and isinstance(data['barWidth'], (int, float)):
                    self.root.after(0, lambda: self.set_window_width(data['barWidth']))
                return

            if data.get('type') == 'sync':
                new_sentence = data.get('currentSentence', '')
                new_floor = data.get('floor', 0)
                new_cur = data.get('curIdx', 1)
                if new_sentence != self.current_sentence or new_floor != self.floor or new_cur != self.cur_idx:
                    self._sub_chunk_idx = 0
                self.char_name = data.get('charName', 'AI')
                self.user_name = data.get('userName', 'User')
                self.floor = new_floor
                self.cur_idx = new_cur
                self.total_sentences = data.get('totalSentences', 1)
                self.current_sentence = new_sentence
                self.is_boss_key = data.get('isBossKey', False)
                self.is_generating = data.get('isGenerating', False)
                if 'barWidth' in data and isinstance(data['barWidth'], (int, float)):
                    w = int(data['barWidth'])
                    if 360 <= w <= 2560 and w != self.width:
                        self.width = w
                if 'config' in data and isinstance(data['config'], dict):
                    old_min = self.config.get('minimalMode')
                    old_layout = self.config.get('layoutMode')
                    self.config.update(data['config'])
                    if 'barWidth' in data['config'] and isinstance(data['config']['barWidth'], (int, float)):
                        w = int(data['config']['barWidth'])
                        if 360 <= w <= 2560 and w != self.width:
                            self.width = w
                    if (old_min != self.config.get('minimalMode') or
                        old_layout != self.config.get('layoutMode')):
                        self.root.after(0, self._apply_layout_and_mode)
                self.root.after(0, self._update_display)
        except Exception as e:
            print(f"[UI Sync Error]: {e}")

    def _update_display(self):
        if self.is_boss_key:
            self.lbl_branch.configure(text="⎇ main*  ✓ 0 ⨉ 0")
            if hasattr(self, 'lbl_floor'):
                self.lbl_floor.configure(text="")
            self.lbl_spin.configure(text="")
            self.lbl_char.configure(text="", bg=self.theme['bg'])
            self.lbl_text.configure(text="TypeScript 5.4.5  UTF-8  LF  Ln 142, Col 8  Ready", wraplength=0)
            self.lbl_right_info.configure(text="Ln 142, Col 8")
            self.lbl_prefix.configure(text=" [webpack]")
            self.entry_reply.delete(0, tk.END)
            self.entry_reply.insert(0, "Compiled successfully in 1240 ms. Watching for file changes...")
            self._update_geometry_and_wrap()
            return

        self.lbl_branch.configure(text="⎇ main*")
        floor_str = f"#{self.floor} ▾" if self.floor >= 0 else "#-- ▾"
        if hasattr(self, 'lbl_floor'):
            self.lbl_floor.configure(text=floor_str)

        if self.is_generating:
            self.lbl_spin.configure(text="⟳ Building...")
        else:
            self.lbl_spin.configure(text="")

        is_min = self.config.get('minimalMode', False)
        if not is_min:
            mode = self.config.get('charNameMode', 'compact')
            if mode == 'hidden':
                self.lbl_char.configure(text="[👤]", fg="#888888", bg="#252526")
            elif mode == 'compact':
                display_name = self.char_name
                if len(display_name) > 6:
                    display_name = display_name[:5] + "…"
                self.lbl_char.configure(
                    text=f"[{display_name}]:",
                    fg=self.theme['char'],
                    bg="#1e2e28" if self.theme_name == 'vscode-dark' else "#005a94"
                )
            else:
                self.lbl_char.configure(
                    text=f"[{self.char_name}]:",
                    fg=self.theme['char'],
                    bg="#1e2e28" if self.theme_name == 'vscode-dark' else "#005a94"
                )

        # 1. 计算文字可视区域可用像素宽度
        if is_min:
            avail_w = max(120, self.width - 24)
        else:
            char_mode = self.config.get('charNameMode', 'compact')
            char_w = 0 if char_mode == 'hidden' else (
                self.lbl_char.winfo_reqwidth() if self.lbl_char.winfo_reqwidth() > 0 else 65
            )
            avail_w = max(120, self.width - 240 - char_w)

        # 2. 单行顺延分页（长句不裁剪，在下一行显示，高度严格恒定）
        self._sub_chunks = self._paginate_sentence(self.current_sentence, avail_w)
        if self._sub_chunk_idx >= len(self._sub_chunks):
            self._sub_chunk_idx = max(0, len(self._sub_chunks) - 1)
        elif self._sub_chunk_idx < 0:
            self._sub_chunk_idx = 0

        display_text = self._sub_chunks[self._sub_chunk_idx] if self._sub_chunks else self.current_sentence
        self.lbl_text.configure(text=display_text, wraplength=0, justify=tk.LEFT)

        # 3. 进度指示：若当前句分多行顺延显示，展示 (当前行/总行)
        if len(self._sub_chunks) > 1:
            self.lbl_right_info.configure(
                text=f"{self.cur_idx}/{self.total_sentences} ({self._sub_chunk_idx + 1}/{len(self._sub_chunks)})"
            )
        else:
            self.lbl_right_info.configure(
                text=f"{self.cur_idx}/{self.total_sentences}"
            )

        self.lbl_prefix.configure(text=" >")
        self._update_geometry_and_wrap()

    def run(self):
        self.root.mainloop()


if __name__ == '__main__':
    if sys.platform.startswith('win'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    print("""
===================================================
 正在启动 ST-Thief-Book 桌面原生摸鱼状态栏 (v2.7)
 请在酒馆助手（Tavern Helper）中导入并启用 st-thief-book.json
 快捷操作说明:
   - 鼠标右键点击任意处 : 呼出极简模式/切换楼层/微调透明度等全功能菜单
   - 鼠标左键点击正文   : 翻到下一句小说
   - 鼠标左键按住拖动   : 随意拖拽移动摸鱼条位置
   - 方向键 ← / →       : 上一句 / 下一句 (或 J / K / 滚轮)
   - PageUp / PageDown  : 上一楼 / 下一楼
   - Enter (双行模式)   : 就地输入回复并回车发送
   - Esc                : 一键老板键（秒切纯代码伪装）
   - Alt + 1 ~ 9        : 快速切换透明度 (15% ~ 100%)
===================================================
""", flush=True)
    app = ThiefDesktopBar()
    app.run()
