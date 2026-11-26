#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SimpleWebSocketServer 认证与限流实测：python test_ws_auth.py"""
import base64
import json
import os
import socket
import struct
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from thief_desktop_bar import SimpleWebSocketServer

PORT = 18999
TOKEN = 'test-token-abc123'
received = []
SERVER = None
BOSS = {'on': False}


def on_message(text):
    received.append(text)
    try:
        if json.loads(text).get('action') == 'toggle_boss':
            # 模拟摸鱼条 _apply_ws_message 的行为：翻转后广播 boss，托盘客户端靠这条回执确认
            BOSS['on'] = not BOSS['on']
            SERVER and SERVER.broadcast({'action': 'boss'})
    except Exception:
        pass


def ws_connect(origin=None, path='/'):
    s = socket.create_connection(('127.0.0.1', PORT), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    req = f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
    if origin is not None:
        req += f"Origin: {origin}\r\n"
    req += "\r\n"
    s.sendall(req.encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = s.recv(1024)
        if not chunk:
            return s, False
        resp += chunk
    return s, b"101" in resp.split(b"\r\n")[0]


def ws_send_text(s, text):
    payload = text.encode('utf-8')
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    n = len(payload)
    if n <= 125:
        header = bytes([0x81, 0x80 | n])
    elif n <= 65535:
        header = struct.pack(">BBH", 0x81, 0x80 | 126, n)
    else:
        header = struct.pack(">BBQ", 0x81, 0x80 | 127, n)
    s.sendall(header + mask + masked)


def ws_recv_text(s, timeout=3):
    s.settimeout(timeout)
    head = s.recv(2)
    if not head or len(head) < 2:
        return None
    n = head[1] & 0x7F
    if n == 126:
        n = struct.unpack(">H", s.recv(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", s.recv(8))[0]
    payload = b""
    while len(payload) < n:
        chunk = s.recv(n - len(payload))
        if not chunk:
            return None
        payload += chunk
    return payload.decode('utf-8')


def closed(s):
    s.settimeout(3)
    try:
        return s.recv(1) == b""
    except socket.timeout:
        return False
    except ConnectionResetError:
        return True


def main():
    global SERVER
    server = SimpleWebSocketServer('127.0.0.1', PORT, on_message, token=TOKEN)
    SERVER = server
    server.start()
    time.sleep(0.3)
    passed = 0

    # 1. 公网 Origin 直接在握手阶段拒绝
    s, ok = ws_connect(origin='https://evil.example.com')
    assert not ok and closed(s), "公网 Origin 应被拒绝"
    s.close(); passed += 1
    print("[PASS] 公网 Origin 拒绝")

    # 2. 未认证：broadcast 不送达；非 hello 首消息视为协议违规 → hello_fail 断开
    s, ok = ws_connect(origin='http://localhost:8000')
    assert ok, "本地 Origin 应放行"
    assert not server.broadcast({'action': 'next'})
    s.settimeout(0.5)
    try:
        leaked = s.recv(1)
        assert leaked == b"", "未认证不应收到广播"
    except socket.timeout:
        pass
    ws_send_text(s, json.dumps({'type': 'sync', 'currentSentence': 'x'}))
    reply = json.loads(ws_recv_text(s))
    assert reply.get('action') == 'hello_fail' and closed(s), "非 hello 首消息应 fail 并断开"
    assert not received, "未认证消息不应进入回调"
    s.close(); passed += 1
    print("[PASS] 广播隔离 + 非 hello 首消息拒绝")

    # 3. 错误 token → hello_fail 并断开
    s, ok = ws_connect(origin='http://127.0.0.1:8000')
    assert ok
    ws_send_text(s, json.dumps({'action': 'hello', 'token': 'wrong'}))
    reply = json.loads(ws_recv_text(s))
    assert reply.get('action') == 'hello_fail' and closed(s), "错误 token 应 fail 并断开"
    s.close(); passed += 1
    print("[PASS] 错误 token 拒绝")

    # 4. 正确 token → hello_ok，sync 进入回调，广播可达
    s, ok = ws_connect(origin='null')
    assert ok, "null Origin (沙箱 iframe) 应放行"
    ws_send_text(s, json.dumps({'action': 'hello', 'token': TOKEN}))
    reply = json.loads(ws_recv_text(s))
    assert reply.get('action') == 'hello_ok', "正确 token 应 hello_ok"
    ws_send_text(s, json.dumps({'type': 'sync', 'currentSentence': '正文'}))
    time.sleep(0.3)
    assert received and json.loads(received[-1])['currentSentence'] == '正文'
    assert server.broadcast({'action': 'next'})
    assert json.loads(ws_recv_text(s)).get('action') == 'next'
    s.close(); passed += 1
    print("[PASS] 正确 token 认证 + sync 回调 + 认证后广播")

    # 5. 超长帧 (>1MB) 直接断开
    s, ok = ws_connect()
    assert ok
    ws_send_text(s, json.dumps({'action': 'hello', 'token': TOKEN}))
    assert json.loads(ws_recv_text(s)).get('action') == 'hello_ok'
    s.sendall(bytes([0x81, 0x80 | 127]) + struct.pack(">Q", 2 * 1024 * 1024) + os.urandom(4))
    assert closed(s), "超长帧应断开"
    s.close(); passed += 1
    print("[PASS] 超长帧断开")

    # 6. 超長握手 (>8KB) 直接断开
    s = socket.create_connection(('127.0.0.1', PORT), timeout=5)
    s.sendall(b"GET / HTTP/1.1\r\nX-Junk: " + b"a" * 9000)
    assert closed(s), "超长握手应断开"
    s.close(); passed += 1
    print("[PASS] 超长握手断开")

    # 7. 全局老板键通道：托盘助手的 WS 客户端（掩码帧 + hello + toggle_boss + 等回执）
    import bar_hotkey_helper as bh
    with tempfile.TemporaryDirectory() as td:
        with open(os.path.join(td, 'thief_bar_bridge.token'), 'w', encoding='utf-8') as f:
            f.write(TOKEN)
        old_port, old_dir = bh.WS_PORT, bh.APP_DIR
        bh.WS_PORT, bh.APP_DIR = PORT, td
        try:
            assert bh.send_boss(verbose=False) == 0, "老板键指令应发送成功"
            assert BOSS['on'] is True, "服务端应收到 toggle_boss"
            assert any('toggle_boss' in t for t in received)
            assert bh.send_boss(verbose=False) == 0
            assert BOSS['on'] is False, "再按一次应退回原来的状态"

            # 密钥不对：握手后 hello 失败，必须报错而不是静默成功
            with open(os.path.join(td, 'thief_bar_bridge.token'), 'w', encoding='utf-8') as f:
                f.write('wrong-token')
            assert bh.send_boss(verbose=False) == 1, "密钥错误应失败"
            os.remove(os.path.join(td, 'thief_bar_bridge.token'))
            assert bh.send_boss(verbose=False) == 1, "没有密钥应失败"
        finally:
            bh.WS_PORT, bh.APP_DIR = old_port, old_dir
    passed += 1
    print("[PASS] 全局老板键 WS 通道")

    server.running = False
    print(f"\n全部 {passed} 项测试通过")


if __name__ == '__main__':
    main()
