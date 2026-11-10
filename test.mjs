// 统一验证入口: node test.mjs （语法检查 + 全部单测/实测，任一失败则退出码 1）
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const pyEnv = { PYTHONIOENCODING: 'utf-8' };
// 命令均为静态字面量，无外部输入；经 shell 执行以解析 Windows 上的 python.exe
const steps = [
  ['JS 语法检查', `"${process.execPath}" --check st-thief-book.js`, {}],
  ['Python 语法检查', 'python -m py_compile thief_desktop_bar.py bar_hotkey_helper.py', pyEnv],
  ['过滤引擎单测', `"${process.execPath}" test_filter_engine.mjs`, {}],
  ['桌面配置/密钥单测', 'python test_desktop_config.py', pyEnv],
  ['WS 认证实测', 'python test_ws_auth.py', pyEnv],
];

const failed = [];
for (const [name, command, env] of steps) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(command, {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: true,
  });
  if (r.error || r.status !== 0) failed.push(name);
}

if (failed.length) {
  console.error(`\n失败 ${failed.length}/${steps.length}: ${failed.join('、')}`);
  process.exit(1);
}
console.log(`\n全部 ${steps.length} 项检查通过`);