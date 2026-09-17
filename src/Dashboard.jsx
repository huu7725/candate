import React, { useEffect, useState } from 'react';
import { api, money, date, roleNames } from './api.js';
import { OrderList } from './App.jsx';

const tabMap = {
  admin: [
    ['products', 'Kho hàng'],
    ['orders', 'Đơn hàng'],
    ['categories', 'Danh mục'],
    ['reviews', 'Đánh giá'],
    ['reports', 'Doanh thu'],
    ['users', 'Tài khoản'],
    ['settings', 'Cấu hình'],
    ['audit', 'Nhật ký'],
  ],
  manager: [
    ['products', 'Kho hàng'],
    ['orders', 'Đơn hàng'],
    ['categories', 'Danh mục'],
    ['reviews', 'Đánh giá'],
  ],
  vendor: [
    ['products', 'Hàng của tôi'],
    ['orders', 'Đơn ký gửi'],
    ['reports', 'Doanh thu của tôi'],
  ],
  shipper: [['orders', 'Giao hàng']],
};

export default function Dashboard({ user, notify, categories, onChange }) {
  const tabs = tabMap[user.role] || [];
  const [tab, setTab] = useState(tabs[0]?.[0] || 'orders');
  return (
    <section className="page-section dashboard">
      <div className="page-heading">
        <p className="eyebrow">KHÔNG GIAN LÀM VIỆC · {roleNames[user.role].toUpperCase()}</p>
        <h1>Xin chào, {user.name}.</h1>
        <p className="muted">
          {user.role === 'shipper'
            ? 'Nhận đơn đã xác nhận và cập nhật quá trình giao hàng.'
            : user.role === 'vendor'
              ? 'Quản lý hàng ký gửi và theo dõi doanh thu của riêng bạn.'
              : 'Quản lý hàng hóa, đơn hàng và chất lượng trải nghiệm tại Cận.'}
        </p>
      </div>
      <div className="dashboard-tabs" role="tablist" aria-label="Chức năng quản lý">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'selected' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dashboard-content" role="tabpanel">
        {tab === 'products' && (
          <Inventory user={user} notify={notify} categories={categories} onChange={onChange} />
        )}
        {tab === 'orders' && <OrderList user={user} notify={notify} />}
        {tab === 'categories' && (
          <Categories categories={categories} notify={notify} onChange={onChange} />
        )}
        {tab === 'reviews' && <Reviews notify={notify} />}
        {tab === 'reports' && <Reports notify={notify} />}
        {tab === 'users' && <Users user={user} notify={notify} />}
        {tab === 'settings' && <Settings notify={notify} onChange={onChange} />}
        {tab === 'audit' && <Audit notify={notify} />}
      </div>
    </section>
  );
}

function Inventory({ user, notify, categories, onChange }) {
  const [items, setItems] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [editing, setEditing] = useState(null);
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  async function load() {
    setItems(await api('/manage/products'));
  }
  useEffect(() => {
    load().catch((e) => notify(e.message, 'error'));
    if (user.role !== 'vendor')
      api('/manage/vendors')
        .then(setVendors)
        .catch((e) => notify(e.message, 'error'));
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    const payload = { ...raw };
    ['stock', 'original_price', 'category_id', 'vendor_id'].forEach((k) => {
      if (k in payload) payload[k] = Number(payload[k]);
    });
    if (mode === 'edit') payload.active = raw.active === 'true';
    try {
      const url =
        mode === 'new'
          ? '/manage/products'
          : mode === 'lot'
            ? `/manage/products/${editing.id}/lots`
            : `/manage/products/${editing.id}`;
      await api(url, { method: mode === 'edit' ? 'PATCH' : 'POST', body: payload });
      setMode('');
      setEditing(null);
      await load();
      onChange();
      notify('Đã lưu hàng hóa.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  const filtered = items?.filter((i) =>
    `${i.name} ${i.lot_code}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <>
      <div className="manage-toolbar">
        <label>
          Tìm trong kho
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tên sản phẩm hoặc mã lô"
          />
        </label>
        <button
          className="primary"
          onClick={() => {
            setEditing(null);
            setMode('new');
          }}
        >
          Đăng sản phẩm mới
        </button>
      </div>
      {mode && (
        <form key={`${mode}-${editing?.id}`} onSubmit={save} className="editor form-stack">
          <div className="modal-top">
            <h2>
              {mode === 'new'
                ? 'Đăng sản phẩm'
                : mode === 'lot'
                  ? `Thêm lô: ${editing.name}`
                  : `Sửa lô: ${editing.lot_code}`}
            </h2>
            <button type="button" className="text-button" onClick={() => setMode('')}>
              Đóng
            </button>
          </div>
          <div className="form-columns">
            {mode !== 'lot' && (
              <>
                <label>
                  Tên sản phẩm
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={editing?.name}
                  />
                </label>
                <label>
                  Danh mục
                  <select
                    name="category_id"
                    required
                    defaultValue={editing?.category_id || categories[0]?.id}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {mode === 'new' && (
              <>
                <label>
                  Thương hiệu
                  <input name="brand" maxLength={60} />
                </label>
                <label>
                  Quy cách
                  <input name="unit" required placeholder="Ví dụ: Hộp 1 lít" maxLength={40} />
                </label>
                <label>
                  Bao bì minh họa
                  <select name="visual">
                    {[
                      ['oat', 'Sữa hộp'],
                      ['granola', 'Ngũ cốc'],
                      ['juice', 'Nước ép'],
                      ['coffee', 'Cà phê'],
                      ['pasta', 'Mì Ý'],
                      ['tea', 'Trà'],
                    ].map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                {user.role !== 'vendor' && (
                  <label>
                    Nhà cung cấp
                    <select name="vendor_id" required>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {mode !== 'edit' && (
              <label>
                Mã lô duy nhất
                <input
                  name="lot_code"
                  required
                  minLength={2}
                  maxLength={50}
                  placeholder="Ví dụ: LOT-2026-001"
                />
              </label>
            )}
            <label>
              Hạn sử dụng
              <input
                type="date"
                name="expiry_date"
                required
                defaultValue={mode === 'edit' ? editing.expiry_date : undefined}
              />
            </label>
            <label>
              Giá gốc (VND)
              <input
                type="number"
                name="original_price"
                required
                min={1000}
                max={100000000}
                step={1}
                defaultValue={editing?.original_price}
              />
            </label>
            <label>
              Tồn kho khả dụng
              <input
                type="number"
                name="stock"
                required
                min={0}
                max={100000}
                step={1}
                defaultValue={mode === 'edit' ? editing.stock : 0}
              />
            </label>
            {mode === 'edit' && (
              <label>
                Trạng thái sản phẩm (tất cả lô)
                <select name="active" defaultValue={String(Boolean(editing.active))}>
                  <option value="true">Đang bán</option>
                  <option value="false">Ngừng bán</option>
                </select>
              </label>
            )}
          </div>
          {mode !== 'lot' && (
            <label>
              Mô tả và hướng dẫn bảo quản
              <textarea name="description" maxLength={2000} defaultValue={editing?.description} />
            </label>
          )}
          <p className="fine-print">
            Hàng hết hạn tự động ngừng bán. Hạn của lô đã có đơn được giữ cố định; tạo lô mới khi
            nhập đợt hàng khác. Tồn kho là số lượng còn lại, chưa gồm hàng đã đặt.
          </p>
          <button className="primary" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu hàng hóa'}
          </button>
        </form>
      )}
      {!items ? (
        <p>Đang tải kho hàng…</p>
      ) : (
        <>
          <div className="stats-row">
            <div>
              <span>Lô hàng</span>
              <strong>{items.length}</strong>
            </div>
            <div>
              <span>Hết hạn</span>
              <strong>{items.filter((i) => i.expired).length}</strong>
            </div>
            <div>
              <span>Còn tối đa 3 ngày</span>
              <strong>{items.filter((i) => !i.expired && i.days_left <= 3).length}</strong>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sản phẩm / lô</th>
                  <th>Hạn sử dụng</th>
                  <th>Tồn kho</th>
                  <th>Giá hiện tại</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.name}</strong>
                      <small>
                        {i.lot_code} · {i.vendor_name}
                      </small>
                      <small>{i.active ? 'Đang bán' : 'Ngừng bán'}</small>
                    </td>
                    <td>
                      {date(i.expiry_date)}
                      <small className={i.expired ? 'error' : ''}>
                        {i.expired ? 'Đã hết hạn' : `Còn ${i.days_left} ngày`}
                      </small>
                    </td>
                    <td>{i.stock}</td>
                    <td>
                      {i.expired ? 'Ngừng bán' : money(i.price)}
                      <small>Giá gốc {money(i.original_price)}</small>
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="secondary"
                          onClick={() => {
                            setEditing(i);
                            setMode('edit');
                            window.scrollTo({ top: 150, behavior: 'smooth' });
                          }}
                        >
                          Sửa lô
                        </button>
                        <button
                          className="text-button"
                          onClick={() => {
                            setEditing(i);
                            setMode('lot');
                            window.scrollTo({ top: 150, behavior: 'smooth' });
                          }}
                        >
                          Thêm lô
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <p className="empty">Chưa có lô hàng phù hợp.</p>}
          </div>
        </>
      )}
    </>
  );
}

function Categories({ categories, notify, onChange }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      await api(editing ? `/categories/${editing.id}` : '/categories', {
        method: editing ? 'PATCH' : 'POST',
        body: data,
      });
      setEditing(null);
      form.reset();
      onChange();
      notify('Đã lưu danh mục.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="editor form-stack" key={editing?.id || 'new'} onSubmit={save}>
        <h2>{editing ? 'Sửa danh mục' : 'Thêm danh mục'}</h2>
        <div className="form-columns">
          <label>
            Tên danh mục
            <input name="name" required minLength={2} maxLength={80} defaultValue={editing?.name} />
          </label>
          <label>
            Đường dẫn ngắn
            <input
              name="slug"
              required
              pattern="[a-z0-9-]+"
              maxLength={80}
              placeholder="thuc-pham-kho"
              defaultValue={editing?.slug}
            />
          </label>
        </div>
        <div className="button-row">
          <button className="primary" disabled={busy}>
            Lưu danh mục
          </button>
          {editing && (
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Hủy sửa
            </button>
          )}
        </div>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Tên</th>
              <th>Đường dẫn</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.slug}</td>
                <td>
                  <button className="secondary" onClick={() => setEditing(c)}>
                    Sửa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function Reviews({ notify }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setItems(await api('/manage/reviews'));
  }
  useEffect(() => {
    load().catch((e) => notify(e.message, 'error'));
  }, []);
  async function moderate(id, status) {
    setBusy(true);
    try {
      await api(`/manage/reviews/${id}`, { method: 'PATCH', body: { status } });
      await load();
      notify('Đã kiểm duyệt đánh giá.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h2>Kiểm duyệt đánh giá</h2>
      {!items ? (
        <p>Đang tải…</p>
      ) : !items.length ? (
        <div className="empty">Chưa có đánh giá.</div>
      ) : (
        items.map((r) => (
          <article className="order-card" key={r.id}>
            <div className="order-header">
              <strong>{r.product_name}</strong>
              <span>
                {r.rating}/5 điểm ·{' '}
                {{ pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Đã ẩn' }[r.status]}
              </span>
            </div>
            <p>{r.content}</p>
            <p className="muted">
              {r.customer_name} · {date(r.created_at)}
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || r.status === 'approved'}
                onClick={() => moderate(r.id, 'approved')}
              >
                Duyệt hiển thị
              </button>
              <button
                className="secondary"
                disabled={busy || r.status === 'rejected'}
                onClick={() => moderate(r.id, 'rejected')}
              >
                Ẩn đánh giá
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
function Reports({ notify }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/reports')
      .then(setData)
      .catch((e) => notify(e.message, 'error'));
  }, []);
  return (
    <>
      <h2>Báo cáo doanh thu</h2>
      <p className="muted">
        Doanh thu sản phẩm của đơn đã giao thành công, không gồm phí giao hàng. Thống kê theo ngày
        đặt đơn tại Việt Nam; chưa trừ phí hoặc hoa hồng.
      </p>
      {data ? (
        <>
          <div className="stats-row">
            <div>
              <span>Doanh thu đã thu</span>
              <strong>{money(data.revenue)}</strong>
            </div>
            <div>
              <span>Tổng đơn phát sinh</span>
              <strong>{data.orders}</strong>
            </div>
            <div>
              <span>Sản phẩm đã giao</span>
              <strong>{data.units}</strong>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ngày đặt đơn</th>
                  <th>Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr key={d.day}>
                    <td>{date(d.day)}</td>
                    <td>{money(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.daily.length && (
              <p className="empty">Chưa có đơn giao thành công để ghi nhận doanh thu.</p>
            )}
          </div>
        </>
      ) : (
        <p>Đang tải…</p>
      )}
    </>
  );
}
function Users({ user, notify }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setItems(await api('/admin/users'));
  }
  useEffect(() => {
    load().catch((e) => notify(e.message, 'error'));
  }, []);
  async function save(e, id) {
    e.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/admin/users/${id}`, {
        method: 'PATCH',
        body: { role: data.role, active: data.active === 'true' },
      });
      await load();
      notify('Đã cập nhật tài khoản và thu hồi phiên đăng nhập cũ.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>Quản lý tài khoản</h2>
      <p className="muted">
        Khách hàng tự đăng ký. Quản trị viên cấp vai trò cho nhân sự và nhà cung cấp tại đây.
      </p>
      {!items ? (
        <p>Đang tải…</p>
      ) : (
        items.map((u) => (
          <form
            className="user-row"
            key={`${u.id}-${u.role}-${u.active}`}
            onSubmit={(e) => save(e, u.id)}
          >
            <div>
              <strong>
                {u.name}
                {u.id === user.id ? ' (Bạn)' : ''}
              </strong>
              <small>{u.email}</small>
            </div>
            <label>
              Vai trò
              <select name="role" defaultValue={u.role} disabled={u.id === user.id}>
                {Object.entries(roleNames).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Trạng thái
              <select
                name="active"
                defaultValue={String(Boolean(u.active))}
                disabled={u.id === user.id}
              >
                <option value="true">Hoạt động</option>
                <option value="false">Đã khóa</option>
              </select>
            </label>
            <button className="secondary" disabled={busy || u.id === user.id}>
              Lưu
            </button>
          </form>
        ))
      )}
    </>
  );
}
function Settings({ notify, onChange }) {
  const [data, setData] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/settings')
      .then((d) => {
        setData(d);
        setTiers(d.discount_tiers);
      })
      .catch((e) => notify(e.message, 'error'));
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api('/admin/settings', {
        method: 'PATCH',
        body: {
          shipping_fee: Number(raw.shipping_fee),
          free_shipping_threshold: Number(raw.free_shipping_threshold),
          discount_tiers: tiers,
        },
      });
      onChange();
      notify('Đã lưu cấu hình. Giá giỏ hàng sẽ được kiểm tra lại trước khi đặt.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return !data ? (
    <p>Đang tải…</p>
  ) : (
    <form className="editor form-stack" onSubmit={save}>
      <h2>Cấu hình bán hàng</h2>
      <div className="form-columns">
        <label>
          Phí giao hàng (VND)
          <input
            type="number"
            name="shipping_fee"
            min={0}
            max={1000000}
            required
            defaultValue={data.shipping_fee}
          />
        </label>
        <label>
          Miễn phí giao từ (VND)
          <input
            type="number"
            name="free_shipping_threshold"
            min={0}
            max={100000000}
            required
            defaultValue={data.free_shipping_threshold}
          />
        </label>
      </div>
      <h3>Giảm giá tự động theo hạn</h3>
      <p className="muted">
        Áp dụng mốc ngày nhỏ nhất phù hợp. Ngoài các mốc này bán giá gốc; đã hết hạn thì ngừng bán.
      </p>
      {tiers.map((t, index) => (
        <div className="tier-row" key={index}>
          <label>
            Còn tối đa (ngày)
            <input
              type="number"
              min={0}
              max={365}
              required
              value={t.days}
              onChange={(e) =>
                setTiers((v) =>
                  v.map((r, i) => (i === index ? { ...r, days: Number(e.target.value) } : r))
                )
              }
            />
          </label>
          <label>
            Giảm (%)
            <input
              type="number"
              min={0}
              max={95}
              required
              value={t.percent}
              onChange={(e) =>
                setTiers((v) =>
                  v.map((r, i) => (i === index ? { ...r, percent: Number(e.target.value) } : r))
                )
              }
            />
          </label>
          <button
            className="text-button"
            type="button"
            disabled={tiers.length <= 1}
            onClick={() => setTiers((v) => v.filter((_, i) => i !== index))}
          >
            Bỏ mốc
          </button>
        </div>
      ))}
      <div className="button-row">
        <button
          className="secondary"
          type="button"
          disabled={tiers.length >= 8}
          onClick={() =>
            setTiers((v) => [
              ...v,
              { days: Math.min(365, Math.max(...v.map((t) => t.days)) + 7), percent: 10 },
            ])
          }
        >
          Thêm mốc
        </button>
        <button className="primary" disabled={busy}>
          Lưu cấu hình
        </button>
      </div>
    </form>
  );
}
function Audit({ notify }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api('/admin/audit')
      .then(setRows)
      .catch((e) => notify(e.message, 'error'));
  }, []);
  return (
    <>
      <h2>Nhật ký thao tác</h2>
      <p className="muted">100 thao tác gần nhất của hệ thống.</p>
      {!rows ? (
        <p>Đang tải…</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người thực hiện</th>
                <th>Thao tác</th>
                <th>Đối tượng</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString('vi-VN')}</td>
                  <td>{r.actor_name}</td>
                  <td>{r.action}</td>
                  <td>
                    {r.entity_type} {r.entity_id}
                  </td>
                  <td className="audit-details">{r.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="empty">Chưa có thao tác được ghi nhận.</p>}
        </div>
      )}
    </>
  );
}
