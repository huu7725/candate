import { z } from 'zod';
import { hashPassword } from './auth.js';

const adminSchema = z.object({
  ADMIN_NAME: z.string().trim().min(2).max(80).default('Quản trị Cận'),
  ADMIN_EMAIL: z.string().trim().email().max(200),
  ADMIN_PASSWORD: z.string().min(12).max(128),
});

// Run at startup, when the persistent disk is mounted, never during a build.
// Redeploys must preserve existing accounts, passwords and business data.
export async function bootstrapDatabase(db, env = process.env) {
  const activeAdmin = () =>
    db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 LIMIT 1").get();
  if (activeAdmin()) return { created: false };

  if (!env.ADMIN_EMAIL && !env.ADMIN_PASSWORD && env.NODE_ENV !== 'production') {
    return { created: false };
  }
  const result = adminSchema.safeParse({
    ADMIN_NAME: env.ADMIN_NAME,
    ADMIN_EMAIL: env.ADMIN_EMAIL,
    ADMIN_PASSWORD: env.ADMIN_PASSWORD,
  });
  if (!result.success) {
    throw new Error(
      'Cần ADMIN_EMAIL hợp lệ và ADMIN_PASSWORD riêng dài 12–128 ký tự để tạo Admin lần đầu. Thiết lập trong Environment của dịch vụ.'
    );
  }
  const data = result.data;
  const passwordHash = await hashPassword(data.ADMIN_PASSWORD);
  return db
    .transaction(() => {
      if (activeAdmin()) return { created: false };
      if (db.prepare('SELECT id FROM users WHERE email=?').get(data.ADMIN_EMAIL)) {
        throw new Error(
          'ADMIN_EMAIL đã thuộc về một tài khoản. Dùng email mới cho Admin ban đầu; không tự động nâng quyền tài khoản có sẵn.'
        );
      }
      const user = db
        .prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'admin')")
        .run(data.ADMIN_NAME, data.ADMIN_EMAIL.toLowerCase(), passwordHash);
      if (db.prepare('SELECT COUNT(*) AS count FROM categories').get().count === 0) {
        const insert = db.prepare('INSERT INTO categories(name,slug) VALUES (?,?)');
        for (const [name, slug] of [
          ['Sữa & đồ uống', 'sua-do-uong'],
          ['Bánh & ngũ cốc', 'banh-ngu-coc'],
          ['Thực phẩm khô', 'thuc-pham-kho'],
          ['Trà & cà phê', 'tra-ca-phe'],
        ])
          insert.run(name, slug);
      }
      return { created: true, userId: Number(user.lastInsertRowid) };
    })
    .immediate();
}
