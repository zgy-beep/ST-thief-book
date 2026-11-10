// 将 st-thief-book.js 同步打包进酒馆助手导入包 st-thief-book.json 的 content 字段
// 用法: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(dir, 'st-thief-book.js'), 'utf8').replace(/\r\n/g, '\n');
const py = readFileSync(join(dir, 'thief_desktop_bar.py'), 'utf8');
// 版本号曾各自漂移（JS v3.1 / 桌面 v2.7），构建时强制对齐
const jsVer = js.match(/\(v(\d+\.\d+)[^)]*\)/)?.[1];
const pyVer = py.match(/\(v(\d+\.\d+)\)/)?.[1];
if (jsVer && pyVer && jsVer !== pyVer) {
  console.error(`版本不一致: st-thief-book.js v${jsVer} / thief_desktop_bar.py v${pyVer}，请先对齐`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(dir, 'st-thief-book.json'), 'utf8'));
pkg.content = js;
writeFileSync(join(dir, 'st-thief-book.json'), JSON.stringify(pkg, null, 2).replace(/\n/g, '\r\n'));
console.log(`已同步 st-thief-book.json (content ${js.length} 字符)`);