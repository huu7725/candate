import { z } from 'zod';
export const roles = ['admin', 'manager', 'customer', 'vendor', 'shipper'];
export const staff = ['admin', 'manager'];
export const integer = z.number().int();
export const idSchema = z.coerce.number().int().positive();
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, 'Ngày không hợp lệ');
export const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  brand: z.string().trim().max(60).default(''),
  description: z.string().trim().max(2000).default(''),
  unit: z.string().trim().min(1).max(40),
  category_id: integer.positive(),
  vendor_id: integer.positive().optional(),
  visual: z.enum(['oat', 'granola', 'juice', 'coffee', 'pasta', 'tea']),
  expiry_date: dateSchema,
  original_price: integer.min(1000).max(100000000),
  stock: integer.min(0).max(100000),
  lot_code: z.string().trim().min(2).max(50),
});
export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
});
export const orderSchema = z.object({
  recipient: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+84|0)[0-9]{9,10}$/, 'Số điện thoại không hợp lệ'),
  address: z.string().trim().min(10).max(300),
  note: z.string().trim().max(500).default(''),
  payment_method: z.literal('cod'),
  request_key: z.string().uuid(),
  expected_total: integer.min(0),
});
export const settingsSchema = z.object({
  shipping_fee: integer.min(0).max(1000000),
  free_shipping_threshold: integer.min(0).max(100000000),
  discount_tiers: z
    .array(z.object({ days: integer.min(0).max(365), percent: integer.min(0).max(95) }))
    .min(1)
    .max(8)
    .refine((v) => new Set(v.map((t) => t.days)).size === v.length, 'Mốc ngày phải khác nhau')
    .refine((v) => {
      const sorted = [...v].sort((a, b) => a.days - b.days);
      return sorted.every((t, i) => i === 0 || t.percent <= sorted[i - 1].percent);
    }, 'Hàng gần hết hạn hơn phải được giảm nhiều hơn hoặc bằng'),
});
export const credentialSchema = z.object({
  email: z.string().trim().email().max(200),
  credential: z.string().regex(/^[a-f0-9]{64}$/),
  credential_version: z.literal('cf-v1'),
});
export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function sellable(lot, quantity) {
  if (!lot.active || lot.expired) fail(409, `${lot.name} đã ngừng bán hoặc hết hạn.`);
  if (quantity > lot.stock) fail(409, `${lot.name} chỉ còn ${lot.stock} sản phẩm.`);
}
