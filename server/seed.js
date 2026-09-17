import './env.js';
import { openDatabase } from './db.js';
import { hashPassword } from './auth.js';
import { todayVN } from './pricing.js';
const db = openDatabase();
if (db.prepare('SELECT count(*) AS n FROM users').get().n) {
  console.log('Database đã có dữ liệu; không ghi đè.');
  db.close();
} else {
  const hash = await hashPassword('CanDate2026!');
  const after = (days) => {
    const date = new Date(`${todayVN()}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  db.transaction(() => {
    for (const [role, name] of [
      ['admin', 'Quản trị Cận'],
      ['manager', 'Quản lý kho'],
      ['customer', 'Minh Anh'],
      ['vendor', 'Nhà Xanh Market'],
      ['shipper', 'Nguyễn Thành'],
      ['vendor', 'An Nhiên Foods'],
    ]) {
      const email = name === 'An Nhiên Foods' ? 'vendor2@can.local' : `${role}@can.local`;
      db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)').run(
        name,
        email,
        hash,
        role
      );
    }
    for (const [name, slug] of [
      ['Sữa & đồ uống', 'sua-do-uong'],
      ['Bánh & ngũ cốc', 'banh-ngu-coc'],
      ['Thực phẩm khô', 'thuc-pham-kho'],
      ['Trà & cà phê', 'tra-ca-phe'],
    ])
      db.prepare('INSERT INTO categories(name,slug) VALUES (?,?)').run(name, slug);
    const products = [
      [
        4,
        1,
        'Sữa yến mạch nguyên bản',
        'OATSIDE',
        'Vị béo dịu tự nhiên từ yến mạch rang. Dùng cùng cà phê, ngũ cốc hoặc uống lạnh. Bảo quản nơi khô mát; sau khi mở nắp, giữ lạnh và dùng theo hướng dẫn trên bao bì.',
        'Hộp 1 lít',
        'oat',
        7,
        68000,
        24,
      ],
      [
        6,
        2,
        'Granola hạt & mật ong',
        'THE NUTS',
        'Yến mạch nướng giòn cùng hạnh nhân và mật ong. Thích hợp cho bữa sáng. Có chứa các loại hạt; xem thông tin dị ứng trên nhãn.',
        'Túi 250 g',
        'granola',
        12,
        125000,
        18,
      ],
      [
        4,
        1,
        'Nước ép cam nguyên chất',
        'FRESH DAY',
        'Nước cam vị thanh, không thêm đường. Lắc nhẹ trước khi dùng. Bảo quản lạnh sau khi mở và dùng theo hướng dẫn trên bao bì.',
        'Chai 330 ml',
        'juice',
        3,
        45000,
        12,
      ],
      [
        6,
        4,
        'Cà phê Arabica rang mộc',
        'LÀ VIỆT',
        'Hạt Arabica rang vừa, hương thơm nhẹ và hậu vị ngọt. Giữ túi kín ở nơi khô ráo, tránh ánh nắng trực tiếp.',
        'Túi 200 g',
        'coffee',
        6,
        160000,
        9,
      ],
      [
        6,
        3,
        'Mì Ý lúa mì nguyên cám',
        'PASTA CASA',
        'Mì Ý nguyên cám cho bữa ăn nhanh gọn. Luộc theo hướng dẫn trên bao bì. Có chứa gluten.',
        'Gói 500 g',
        'pasta',
        13,
        78000,
        30,
      ],
      [
        4,
        4,
        'Trà hoa cúc dịu nhẹ',
        'AN NHIÊN',
        'Trà hoa cúc sấy khô, hương vị thanh dịu. Bảo quản kín, khô ráo. Pha với nước nóng theo hướng dẫn trên nhãn.',
        'Hộp 20 túi',
        'tea',
        2,
        95000,
        16,
      ],
      [
        4,
        1,
        'Sữa yến mạch vị cacao',
        'OATSIDE',
        'Yến mạch kết hợp cacao, vị đậm và béo nhẹ. Bảo quản nơi khô mát. Xem hướng dẫn sử dụng sau mở nắp trên nhãn.',
        'Hộp 1 lít',
        'oat',
        11,
        72000,
        20,
      ],
      [
        6,
        2,
        'Granola trái cây nhiệt đới',
        'THE NUTS',
        'Yến mạch giòn cùng trái cây sấy và các loại hạt. Dùng với sữa chua hoặc sữa. Có chứa các loại hạt.',
        'Túi 250 g',
        'granola',
        5,
        135000,
        15,
      ],
    ];
    products.forEach((p, index) => {
      const [vendor, cat, name, brand, description, unit, visual, days, price, stock] = p;
      const r = db
        .prepare(
          'INSERT INTO products(vendor_id,category_id,name,brand,description,unit,visual) VALUES (?,?,?,?,?,?,?)'
        )
        .run(vendor, cat, name, brand, description, unit, visual);
      db.prepare(
        'INSERT INTO inventory(product_id,lot_code,expiry_date,original_price,stock) VALUES (?,?,?,?,?)'
      ).run(r.lastInsertRowid, `CAN-DEMO-${index + 1}`, after(days), price, stock);
    });
  })();
  console.log('Đã tạo 8 sản phẩm mẫu và 6 tài khoản. Mật khẩu demo: CanDate2026!');
  db.close();
}
