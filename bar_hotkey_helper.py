#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ST-Thief 摸鱼条 托盘 + 热键助手（零第三方依赖，纯 ctypes）

摸鱼条是 overrideredirect 无边框窗口：没有任务栏图标、没有 Alt+Tab 条目。
被拖到副屏 / 屏幕外，或者隐私模式把 alpha 压到 0.01 之后，就再也"找不到"了。

本助手常驻后台，提供：
  · 系统托盘图标     左键单击 = 显示/隐藏   右键 = 菜单（召回归位 / 显示隐身 / 重启摸鱼条 / 退出）
  · 全局热键 Ctrl+B  召回：不在主屏就挪回主屏底部居中；隐身态自动恢复；进程没了会自动拉起
  · 全局热键 Ctrl+H  显示 / 隐身切换（alpha 1 <-> 你配置里的透明度）

命令行（方便做桌面快捷方式 / 排查）：
  python bar_hotkey_helper.py --listen          # 托盘 + 热键（start_desktop.bat 自动拉起）
  python bar_hotkey_helper.py --status          # 打印真实位置 / alpha / topmost
  python bar_hotkey_helper.py --recall          # 一次性归位（加 --force 强制挪）
  python bar_hotkey_helper.py --stealth on|off|toggle
"""

import ctypes
import json
import os
import socket
import sys
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
shell32 = ctypes.WinDLL("shell32", use_last_error=True)

TITLE_HINT = "VS Code Status Bar"
CLASS_HINT = "TkTopLevel"
WS_PORT = 18899          # 与 thief_desktop_bar.py 的 WS_PORT 保持一致
APP_DIR = os.path.dirname(os.path.abspath(__file__))

# ---------------- 热键定义（想改成别的键就改这两行） ----------------
HOTKEY_RECALL = (ord("B"), "Ctrl+B")
HOTKEY_STEALTH = (ord("H"), "Ctrl+H")

MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_NOREPEAT = 0x4000
WM_HOTKEY = 0x0312
WM_APP = 0x8000
WM_TRAY = WM_APP + 1
WM_COMMAND = 0x0111
WM_DESTROY = 0x0002
WM_LBUTTONUP = 0x0202
WM_RBUTTONUP = 0x0205
WM_LBUTTONDBLCLK = 0x0203
WM_NULL = 0x0000

GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TOPMOST = 0x00000008
LWA_ALPHA = 0x00000002
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_SHOWWINDOW = 0x0040
SWP_NOACTIVATE = 0x0010
SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN = 76, 77
SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 78, 79

NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_STATE = 0x1, 0x2, 0x4, 0x8
MF_STRING, MF_SEPARATOR = 0x0000, 0x0800
TPM_RIGHTBUTTON, TPM_RETURNCMD = 0x0002, 0x0100
IDI_APPLICATION = 32512

MENU_RECALL = 101
MENU_STEALTH = 102
MENU_RESTART = 103
MENU_QUIT = 104


# ---------------------------------------------------------------- 结构体
class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_ulong), ("rcMonitor", RECT),
                ("rcWork", RECT), ("dwFlags", ctypes.c_ulong)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long),
                ("biHeight", ctypes.c_long), ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wintypes.DWORD),
                ("biClrImportant", wintypes.DWORD)]


class RGBQUAD(ctypes.Structure):
    _fields_ = [("rgbBlue", ctypes.c_ubyte), ("rgbGreen", ctypes.c_ubyte),
                ("rgbRed", ctypes.c_ubyte), ("rgbReserved", ctypes.c_ubyte)]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", RGBQUAD * 1)]


class ICONINFO(ctypes.Structure):
    _fields_ = [("fIcon", wintypes.BOOL), ("xHotspot", wintypes.DWORD),
                ("yHotspot", wintypes.DWORD), ("hbmMask", wintypes.HBITMAP),
                ("hbmColor", wintypes.HBITMAP)]


class GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("hWnd", wintypes.HWND),
        ("uID", wintypes.UINT),
        ("uFlags", wintypes.UINT),
        ("uCallbackMessage", wintypes.UINT),
        ("hIcon", wintypes.HICON),
        ("szTip", wintypes.WCHAR * 128),
        ("dwState", wintypes.DWORD),
        ("dwStateMask", wintypes.DWORD),
        ("szInfo", wintypes.WCHAR * 256),
        ("uVersion", wintypes.UINT),
        ("szInfoTitle", wintypes.WCHAR * 64),
        ("dwInfoFlags", wintypes.DWORD),
        ("guidItem", GUID),
        ("hBalloonIcon", wintypes.HICON),
    ]


LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT,
                             wintypes.WPARAM, wintypes.LPARAM)


class WNDCLASSW(ctypes.Structure):
    _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", WNDPROC),
                ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
                ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
                ("lpszMenuName", wintypes.LPCWSTR),
                ("lpszClassName", wintypes.LPCWSTR)]


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

# ---------------------------------------------------------------- API 签名
user32.EnumWindows.argtypes = [EnumProc, wintypes.LPARAM]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, ctypes.c_int, ctypes.c_uint]
user32.SetLayeredWindowAttributes.argtypes = [wintypes.HWND, ctypes.c_uint,
                                              ctypes.c_ubyte, ctypes.c_uint]
user32.GetLayeredWindowAttributes.argtypes = [wintypes.HWND, ctypes.POINTER(ctypes.c_uint),
                                              ctypes.POINTER(ctypes.c_ubyte),
                                              ctypes.POINTER(ctypes.c_uint)]
user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
user32.MonitorFromWindow.restype = wintypes.HANDLE
user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_uint, ctypes.c_uint]
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.CreatePopupMenu.restype = wintypes.HMENU
user32.AppendMenuW.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
user32.TrackPopupMenu.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_int, ctypes.c_int,
                                  ctypes.c_int, wintypes.HWND, ctypes.c_void_p]
user32.TrackPopupMenu.restype = ctypes.c_int
user32.DestroyMenu.argtypes = [wintypes.HMENU]
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR,
                                   wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wintypes.HWND,
                                   wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p]
user32.CreateWindowExW.restype = wintypes.HWND
user32.LoadIconW.argtypes = [wintypes.HINSTANCE, ctypes.c_void_p]
user32.LoadIconW.restype = wintypes.HICON
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND,
                               wintypes.UINT, wintypes.UINT]
kernel32.GetModuleHandleW.restype = wintypes.HMODULE
shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
shell32.ExtractIconW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, ctypes.c_int]
shell32.ExtractIconW.restype = wintypes.HICON


# ---------------------------------------------------------------- 自绘托盘图标
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
gdi32.CreateDIBSection.argtypes = [wintypes.HDC, ctypes.POINTER(BITMAPINFO), wintypes.UINT,
                                   ctypes.POINTER(ctypes.c_void_p), wintypes.HANDLE, wintypes.DWORD]
gdi32.CreateDIBSection.restype = wintypes.HBITMAP
gdi32.CreateBitmap.argtypes = [ctypes.c_int, ctypes.c_int, wintypes.UINT, wintypes.UINT, ctypes.c_void_p]
gdi32.CreateBitmap.restype = wintypes.HBITMAP
user32.CreateIconIndirect.argtypes = [ctypes.POINTER(ICONINFO)]
user32.CreateIconIndirect.restype = wintypes.HICON
user32.GetDC.argtypes = [wintypes.HWND]
user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]


def _rounded_span(y, top, bottom, left, right, radius):
    """返回第 y 行的 [x0, x1) 区间，做圆角矩形。"""
    if y < top or y >= bottom:
        return None
    if y < top + radius:
        dy = (top + radius) - y - 0.5
        dx = radius - (radius * radius - dy * dy) ** 0.5
    elif y >= bottom - radius:
        dy = y - (bottom - radius) + 0.5
        dx = radius - (radius * radius - dy * dy) ** 0.5
    else:
        dx = 0
    return (left + int(round(dx)), right - int(round(dx)))


def make_bar_icon(size=32):
    """画一个"状态栏"小图标：绿色圆角条 + 三条深色刻度。返回 HICON，失败返回 0。"""
    try:
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = size
        bmi.bmiHeader.biHeight = -size          # 负数 = 自上而下
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = 0         # BI_RGB
        bits = ctypes.c_void_p()
        hdc = user32.GetDC(None)
        hbm = gdi32.CreateDIBSection(hdc, ctypes.byref(bmi), 0, ctypes.byref(bits), None, 0)
        user32.ReleaseDC(None, hdc)
        if not hbm or not bits.value:
            return 0
        buf = (ctypes.c_ubyte * (size * size * 4)).from_address(bits.value)

        def put(x, y, b, g, r, a=255):
            if 0 <= x < size and 0 <= y < size:
                i = (y * size + x) * 4
                buf[i], buf[i + 1], buf[i + 2], buf[i + 3] = b, g, r, a

        # 透明底
        for i in range(size * size):
            buf[i * 4 + 3] = 0

        # 主条：绿色圆角矩形（BGR: 0x7B,0xD8,0x3D -> #3DD87B）
        top, bottom, left, right = int(size * 0.18), int(size * 0.70), int(size * 0.04), int(size * 0.96)
        radius = max(3, int(size * 0.21))
        for y in range(top, bottom):
            span = _rounded_span(y, top, bottom, left, right, radius)
            if span:
                for x in range(span[0], span[1]):
                    shade = 1.0 if y < (top + bottom) // 2 else 0.82
                    put(x, y, int(0x7B * shade), int(0xD8 * shade), int(0x3D * shade))
        # 条内刻度，暗示"文本/状态段"
        tick_top, tick_bottom = top + int(size * 0.12), bottom - int(size * 0.12)
        for k, cx in enumerate((0.22, 0.42, 0.62, 0.82)):
            x0 = int(size * cx)
            for y in range(tick_top, tick_bottom):
                for x in range(x0, x0 + max(1, int(size * 0.08))):
                    put(x, y, 0x2A, 0x2A, 0x2A, 255)
        # 底部细线，像"桌面状态栏"
        for y in range(bottom + 2, min(size, bottom + 5)):
            for x in range(left + int(size * 0.06), right - int(size * 0.06)):
                put(x, y, 0x9A, 0x9A, 0x9A, 220)

        mask = gdi32.CreateBitmap(size, size, 1, 1, None)
        ii = ICONINFO()
        ii.fIcon = True
        ii.hbmMask = mask
        ii.hbmColor = hbm
        hicon = user32.CreateIconIndirect(ctypes.byref(ii))
        return hicon or 0
    except Exception:
        return 0


# ---------------------------------------------------------------- 摸鱼条操作
def _config_alpha():
    """从 thief_bar_config.json 读用户设定的透明度，取不到就用 0.5。"""
    for path in (os.path.join(APP_DIR, "thief_bar_config.json"),
                 os.path.join(os.path.expanduser("~"), ".st_thief_bar_config.json")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                a = float(json.load(f).get("alpha", 0.5))
                return max(15, min(255, int(round(a * 255))))
        except Exception:
            continue
    return 128


def find_bar_window():
    found = []

    def _cb(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        cls = ctypes.create_unicode_buffer(128)
        user32.GetClassNameW(hwnd, cls, 128)
        if cls.value != CLASS_HINT:
            return True
        txt = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, txt, 256)
        if TITLE_HINT not in txt.value:
            return True
        rect = RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return True
        w, h = rect.right - rect.left, rect.bottom - rect.top
        if w < 200 or h < 15:
            return True
        found.append((hwnd, rect, w, h))
        return True

    user32.EnumWindows(EnumProc(_cb), 0)
    if not found:
        return None
    found.sort(key=lambda x: -(x[2] * x[3]))
    return found[0]


def get_alpha(hwnd):
    ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    if not (ex & WS_EX_LAYERED):
        return None
    key, flags = ctypes.c_uint(0), ctypes.c_uint(0)
    alpha = ctypes.c_ubyte(0)
    if user32.GetLayeredWindowAttributes(hwnd, ctypes.byref(key),
                                         ctypes.byref(alpha), ctypes.byref(flags)):
        return alpha.value
    return None


def set_alpha(hwnd, value):
    value = max(1, min(255, int(value)))
    ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    if not (ex & WS_EX_LAYERED):
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED)
    return bool(user32.SetLayeredWindowAttributes(hwnd, 0, value, LWA_ALPHA))


def log(msg):
    """pythonw 下没有控制台，顺带写日志文件，方便事后排查。"""
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        path = os.path.join(APP_DIR, "bar_hotkey_helper.log")
        if os.path.exists(path) and os.path.getsize(path) > 256 * 1024:
            os.replace(path, path + ".old")
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def primary_work_area():
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    user32.GetMonitorInfoW(user32.MonitorFromWindow(None, 1), ctypes.byref(mi))
    return mi.rcWork


def on_primary(hwnd):
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd, 2), ctypes.byref(mi))
    work = primary_work_area()
    return (mi.rcMonitor.left, mi.rcMonitor.top) == (work.left, work.top)


def bar_running():
    s = socket.socket()
    s.settimeout(0.4)
    try:
        return s.connect_ex(("127.0.0.1", WS_PORT)) == 0
    finally:
        s.close()


def launch_bar():
    import subprocess
    bat = os.path.join(APP_DIR, "start_desktop.bat")
    if not os.path.exists(bat):
        return False
    subprocess.Popen(["cmd", "/c", "start", "", bat], cwd=APP_DIR,
                     creationflags=0x00000008)  # DETACHED_PROCESS
    return True


def recall(verbose=True, force_move=False):
    hit = find_bar_window()
    if not hit:
        if not bar_running() and launch_bar():
            if verbose:
                print("[+] 摸鱼条进程不在，已重新拉起 start_desktop.bat，等待窗口…", flush=True)
            for _ in range(40):
                time.sleep(0.25)
                hit = find_bar_window()
                if hit:
                    break
        if not hit:
            if verbose:
                print("[x] 没有找到摸鱼条窗口（进程可能没在跑）", flush=True)
            return 1

    hwnd, rect, w, h = hit
    work = primary_work_area()
    need_move = (force_move or not on_primary(hwnd)
                 or rect.bottom > work.bottom - 8 or rect.right > work.right
                 or rect.left < work.left or rect.top < work.top - 200)
    if need_move:
        x = work.left + max(0, (work.right - work.left - w) // 2)
        y = max(work.top, work.bottom - h - 45)
        user32.SetWindowPos(hwnd, wintypes.HWND(-1), x, y, w, h,
                            SWP_SHOWWINDOW | SWP_NOACTIVATE)
        if verbose:
            print(f"[+] 已归位到主屏底部居中: ({x},{y}) {w}x{h}", flush=True)
    else:
        user32.SetWindowPos(hwnd, wintypes.HWND(-1), 0, 0, 0, 0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
        if verbose:
            print("[=] 已在主屏可见区域，仅置顶显示", flush=True)

    a = get_alpha(hwnd)
    target = _config_alpha()
    if a is None or a < 40:
        set_alpha(hwnd, target)
        if verbose:
            print(f"[+] 透明度已恢复: {a} -> {target}", flush=True)
    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)
    return 0


def stealth(mode="toggle", verbose=True):
    hit = find_bar_window()
    if not hit:
        if verbose:
            print("[x] 没有找到摸鱼条窗口", flush=True)
        return 1
    hwnd = hit[0]
    cur = get_alpha(hwnd)
    target = _config_alpha()
    if mode == "on":
        new = 1
    elif mode == "off":
        new = target
    else:
        new = target if (cur is not None and cur < 40) else 1
    set_alpha(hwnd, new)
    if verbose:
        print(f"[+] alpha {cur} -> {new}", flush=True)
    return 0


def status():
    hit = find_bar_window()
    if not hit:
        print("窗口: 未找到（进程可能没在跑）")
        return 1
    hwnd, rect, w, h = hit
    work = primary_work_area()
    print(f"窗口: hwnd=0x{hwnd:X} size={w}x{h}")
    print(f"位置: ({rect.left},{rect.top})-({rect.right},{rect.bottom})")
    print(f"主屏工作区: ({work.left},{work.top})-({work.right},{work.bottom})  onPrimary={on_primary(hwnd)}")
    print(f"alpha={get_alpha(hwnd)}  config_alpha={_config_alpha()}  bar_running={bar_running()}")
    ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    print(f"topmost={bool(ex & WS_EX_TOPMOST)} layered={bool(ex & WS_EX_LAYERED)}")
    return 0


# ---------------------------------------------------------------- 托盘
class Tray:
    """ctypes 实现的最小托盘：左键=显示/隐藏，右键=菜单。"""

    CLASS_NAME = "STThiefBarTrayWnd"

    def __init__(self, on_recall, on_stealth, on_restart, on_quit):
        self.on_recall = on_recall
        self.on_stealth = on_stealth
        self.on_restart = on_restart
        self.on_quit = on_quit
        self._proc = WNDPROC(self._wndproc)   # 必须持有引用，否则会被 GC
        self.hinstance = kernel32.GetModuleHandleW(None)
        wc = WNDCLASSW()
        wc.lpfnWndProc = self._proc
        wc.hInstance = self.hinstance
        wc.lpszClassName = self.CLASS_NAME
        user32.RegisterClassW(ctypes.byref(wc))
        self.hwnd = user32.CreateWindowExW(0, self.CLASS_NAME, "ST-Thief Tray", 0,
                                           0, 0, 0, 0, None, None, self.hinstance, None)
        if not self.hwnd:
            raise ctypes.WinError()
        self.icon = self._load_icon()
        self.nid = NOTIFYICONDATAW()
        self.nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        self.nid.hWnd = self.hwnd
        self.nid.uID = 1
        self.nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        self.nid.uCallbackMessage = WM_TRAY
        self.nid.hIcon = self.icon
        self.nid.szTip = self._tip_text()
        # 注意：NIM_ADD 必须带上 NIF_ICON|NIF_MESSAGE，否则托盘里是"空白一格"，
        # 而且点击回调也收不到（曾经就在这里踩过：先 update_tip 把 uFlags 改成只剩 NIF_TIP）。
        self.nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        if not shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(self.nid)):
            raise ctypes.WinError()
        self.visible = True

    def _load_icon(self):
        h = make_bar_icon(32)
        if h:
            return h
        try:
            h = shell32.ExtractIconW(None, sys.executable, 0)
            if h:
                return h
        except Exception:
            pass
        return user32.LoadIconW(None, ctypes.c_void_p(IDI_APPLICATION))

    def _bar_alpha(self):
        hit = find_bar_window()
        return get_alpha(hit[0]) if hit else None

    def _tip_text(self):
        a = self._bar_alpha()
        if a is None:
            state = "摸鱼条未运行（左键=启动）"
        elif a < 40:
            state = "已隐身"
        else:
            state = "显示中"
        return f"摸鱼条 · {state}   {HOTKEY_RECALL[1]}=召回  {HOTKEY_STEALTH[1]}=隐身"

    def update_tip(self):
        self.nid.szTip = self._tip_text()
        # 保持 NIF_ICON，避免某些系统在 NIM_MODIFY 后把图标清空
        self.nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        self.nid.hIcon = self.icon
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(self.nid))

    def _menu(self):
        hmenu = user32.CreatePopupMenu()
        user32.AppendMenuW(hmenu, MF_STRING, MENU_RECALL, f"召回 / 归位\t{HOTKEY_RECALL[1]}")
        a = self._bar_alpha()
        label = "显示（当前已隐身）" if (a is not None and a < 40) else "隐身"
        user32.AppendMenuW(hmenu, MF_STRING, MENU_STEALTH, f"{label}\t{HOTKEY_STEALTH[1]}")
        user32.AppendMenuW(hmenu, MF_SEPARATOR, 0, None)
        user32.AppendMenuW(hmenu, MF_STRING, MENU_RESTART, "重启摸鱼条")
        user32.AppendMenuW(hmenu, MF_STRING, MENU_QUIT, "退出托盘助手")
        pt = POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        user32.SetForegroundWindow(self.hwnd)
        cmd = user32.TrackPopupMenu(hmenu, TPM_RIGHTBUTTON | TPM_RETURNCMD,
                                    pt.x, pt.y, 0, self.hwnd, None)
        user32.PostMessageW(self.hwnd, WM_NULL, 0, 0)
        user32.DestroyMenu(hmenu)
        return cmd

    def _wndproc(self, hwnd, msg, wparam, lparam):
        if msg == WM_TRAY:
            ev = lparam & 0xFFFF
            # 同一个物理点击，Win11 的 shell 会重复投递 2~3 次 0x0202（还夹着 0x0203），
            # 不去重就会出现"点一下闪两下 = 看起来没反应"。这里做 400ms 去抖。
            if ev in (WM_LBUTTONUP, WM_LBUTTONDBLCLK, WM_RBUTTONUP):
                now = time.time()
                if now - getattr(self, "_last_click", 0.0) < 0.4:
                    return 0
                self._last_click = now
                log(f"[tray] click event 0x{ev:04X}")
            if ev in (WM_LBUTTONUP, WM_LBUTTONDBLCLK):
                self.on_stealth()
                self.update_tip()
            elif ev == WM_RBUTTONUP:
                cmd = self._menu()
                if cmd == MENU_RECALL:
                    self.on_recall()
                elif cmd == MENU_STEALTH:
                    self.on_stealth()
                elif cmd == MENU_RESTART:
                    self.on_restart()
                elif cmd == MENU_QUIT:
                    self.on_quit()
                self.update_tip()
            return 0
        if msg == WM_COMMAND:
            return 0
        if msg == WM_DESTROY:
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def remove(self):
        if self.visible:
            shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self.nid))
            self.visible = False


# ---------------------------------------------------------------- 主循环
MUTEX_NAME = "STThiefBarHotkeyHelper"  # 本会话内唯一即可


def _single_instance():
    """同一时间只允许一个助手实例：否则会出现两个托盘图标 + 热键抢不到。"""
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        return None
    return handle


def listen():
    guard = _single_instance()
    if guard is None:
        log("[guard] 已有一个助手实例在跑，本实例退出")
        return 0
    ok_r = user32.RegisterHotKey(None, 1, MOD_CONTROL | MOD_NOREPEAT, HOTKEY_RECALL[0])
    ok_s = user32.RegisterHotKey(None, 2, MOD_CONTROL | MOD_NOREPEAT, HOTKEY_STEALTH[0])
    log(f"[hotkey] {HOTKEY_RECALL[1]} 召回: {'ok' if ok_r else 'FAILED(被别的程序占用)'}")
    log(f"[hotkey] {HOTKEY_STEALTH[1]} 隐身: {'ok' if ok_s else 'FAILED(被别的程序占用)'}")

    def _restart():
        import subprocess
        hit = find_bar_window()
        if hit:
            try:
                subprocess.Popen(["taskkill", "/F", "/PID",
                                  str(_pid_of_bar())], creationflags=0x08000000)
            except Exception:
                pass
        time.sleep(0.3)
        launch_bar()

    tray = None
    try:
        tray = Tray(on_recall=recall,
                    on_stealth=lambda: stealth("toggle", verbose=False),
                    on_restart=_restart,
                    on_quit=lambda: (tray and tray.remove(), user32.PostQuitMessage(0)))
        log("[tray] 托盘图标已添加（左键=显示/隐藏，右键=菜单）")
    except Exception as err:
        log(f"[tray] 托盘不可用: {err}")

    def _tick():
        if tray:
            tray.update_tip()

    msg = wintypes.MSG()
    last_tip = 0.0
    while True:
        # 非阻塞取消息，顺便每 2 秒刷新一次托盘提示
        while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
            if msg.message == WM_HOTKEY:
                if msg.wParam == 1:
                    recall()
                elif msg.wParam == 2:
                    stealth("toggle", verbose=False)
                if tray:
                    tray.update_tip()
            elif msg.message == 0x0012:  # WM_QUIT
                if tray:
                    tray.remove()
                return 0
            else:
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
        if time.time() - last_tip > 2.0:
            last_tip = time.time()
            _tick()
        time.sleep(0.05)


def _pid_of_bar():
    """通过 WS 端口找不出 PID，退化为按进程命令行匹配。"""
    import subprocess
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*thief_desktop_bar.py*' } | Select-Object -First 1).ProcessId"],
            capture_output=True, text=True, timeout=8, creationflags=0x08000000)
        return int(out.stdout.strip() or 0)
    except Exception:
        return 0


def main(argv):
    if "--listen" in argv or not argv:
        return listen()
    if "--status" in argv:
        return status()
    if "--stealth" in argv:
        i = argv.index("--stealth")
        return stealth(argv[i + 1] if i + 1 < len(argv) else "toggle")
    return recall(force_move=("--force" in argv))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
