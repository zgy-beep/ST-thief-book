// 将 st-thief-book.js 同步打包进酒馆助手导入包 st-thief-book.json 的 content 字段
// 用法: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(dir, 'st-thief-book.js'), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(readFileSync(join(dir, 'st-thief-book.json'), 'utf8'));
pkg.content = js;
writeFileSync(join(dir, 'st-thief-book.json'), JSON.stringify(pkg, null, 2).replace(/\n/g, '\r\n'));
console.log(`已同步 st-thief-book.json (content ${js.length} 字符)`);