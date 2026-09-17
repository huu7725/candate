import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { adminInsertSQL } from './setup-lib.js';

if (Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('Cloudflare CLI cần Node.js 22 trở lên. Cài Node 22 LTS rồi mở terminal mới.');
const local = process.argv.includes('--local');
const target = local ? '--local' : '--remote';
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
const varsPath = path.resolve('.dev.vars');
function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: process.cwd(),
    windowsHide: true,
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      'Cloudflare CLI chưa hoàn tất. Xem thông báo bên trên, kiểm tra đăng nhập và thử lại.'
    );
  return result;
}
function readSecret() {
  const value = fs.existsSync(varsPath)
    ? fs.readFileSync(varsPath, 'utf8').match(/^AUTH_SECRET="?([a-f0-9]{64})"?\s*$/m)?.[1]
    : null;
  if (!value)
    throw new Error(
      'Chưa có khóa riêng .dev.vars. Chạy npm run cf:secret trước. Không tạo khóa mới nếu database đã có tài khoản; cần giữ đúng khóa cũ.'
    );
  return value;
}
async function hidden(question) {
  if (!process.stdin.isTTY)
    throw new Error(
      'Nhập mật khẩu trong terminal tương tác, hoặc đặt biến CF_ADMIN_PASSWORD cho lệnh này.'
    );
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    }
    function onData(buffer) {
      for (const ch of buffer.toString('utf8')) {
        if (ch === '\u0003') {
          finish(new Error('Đã hủy.'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          finish();
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= ' ') value += ch;
      }
    }
    process.stdin.on('data', onData);
  });
}

async function main() {
  if (process.argv[2] === 'secret') {
    if (!local && !fs.existsSync(varsPath)) {
      const existing = cli(['secret', 'list', '--format', 'json'], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      if (JSON.parse(existing.stdout).some((item) => item.name === 'AUTH_SECRET')) {
        throw new Error(
          'Worker đã có AUTH_SECRET nhưng máy này thiếu .dev.vars. Khôi phục file khóa cũ trước; lệnh dừng để tránh làm mất khả năng đăng nhập.'
        );
      }
    }
    if (!fs.existsSync(varsPath))
      fs.writeFileSync(varsPath, `AUTH_SECRET=${randomBytes(32).toString('hex')}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
    const secret = readSecret();
    if (!local)
      cli(['secret', 'put', 'AUTH_SECRET'], {
        input: secret + '\n',
        stdio: ['pipe', 'inherit', 'inherit'],
      });
    console.log(local ? 'Đã chuẩn bị khóa cục bộ.' : 'Đã thiết lập AUTH_SECRET trên Worker.');
    console.log(
      'Giữ bản sao .dev.vars ở nơi riêng tư. File được Git bỏ qua; không đăng lên GitHub. Chạy lại lệnh sẽ dùng đúng khóa này, không tự đổi khóa.'
    );
    return;
  }
  if (process.argv[2] !== 'admin') throw new Error('Dùng npm run cf:secret hoặc npm run cf:admin.');
  const secret = readSecret();
  const check = cli(
    [
      'd1',
      'execute',
      'candate-db',
      target,
      '--command',
      "SELECT id,email FROM users WHERE role='admin' LIMIT 1",
      '--json',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const parsed = JSON.parse(check.stdout);
  const existing = parsed.flatMap((r) => r.results || []);
  if (existing.length) {
    console.log(`Đã có Admin ${existing[0].email}; giữ nguyên tài khoản và mật khẩu.`);
    return;
  }
  let name = process.env.CF_ADMIN_NAME || 'Quản trị Cận';
  let email = process.env.CF_ADMIN_EMAIL;
  let password = process.env.CF_ADMIN_PASSWORD;
  if (!email) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    email = await rl.question('Email Admin: ');
    const typed = await rl.question('Tên Admin (Enter để dùng Quản trị Cận): ');
    if (typed) name = typed;
    rl.close();
  }
  if (!password) {
    password = await hidden('Mật khẩu riêng (12–128 ký tự, không hiển thị): ');
    const confirm = await hidden('Nhập lại mật khẩu: ');
    if (password !== confirm) throw new Error('Hai mật khẩu không giống nhau.');
  }
  const sql = await adminInsertSQL({ name, email, password }, secret);
  const filename = path.resolve(`cloudflare/admin-${randomBytes(8).toString('hex')}.sql`);
  try {
    fs.writeFileSync(filename, sql, { flag: 'wx', mode: 0o600 });
    cli(['d1', 'execute', 'candate-db', target, '--file', filename, '--yes'], { stdio: 'inherit' });
  } finally {
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
  }
  console.log(
    'Đã khởi tạo Admin. Mở URL workers.dev của ứng dụng và đăng nhập bằng thông tin vừa nhập.'
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
