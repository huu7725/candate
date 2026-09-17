import React, { useEffect, useRef, useState } from 'react';
import { api, money, date, roleNames, statusNames } from './api.js';
import Dashboard from './Dashboard.jsx';

export function Package({ type = 'oat', hero = false }) {
  const labels = {
    oat: ['OATSIDE', 'OAT MILK', 'Original', '100% plant based'],
    granola: ['THE NUTS', 'GRANOLA', 'hạt & mật ong', 'Good mornings start here.'],
    juice: ['fresh day', 'ORANGE', '100% nước ép', 'Freshly good.'],
    coffee: ['LÀ VIỆT', 'ARABICA', 'cà phê rang mộc', 'Đà Lạt · Việt Nam'],
    pasta: ['PASTA CASA', 'PENNE', 'whole wheat', '500 g'],
    tea: ['an nhiên', 'HOA CÚC', 'trà thảo mộc', 'Một chút bình yên.'],
  };
  const text = labels[type] || labels.oat;
  return (
    <div className={`package package-${type} ${hero ? 'hero-package' : ''}`} aria-hidden="true">
      <div className="package-top" />
      <div className="package-brand">{text[0]}</div>
      <div className="package-line" />
      <div className="package-title">{text[1]}</div>
      <div className="package-variant">{text[2]}</div>
      <div className="package-window" />
      <div className="package-foot">{text[3]}</div>
    </div>
  );
}

function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-top">
        <h2>{title}</h2>
        <button className="text-button" onClick={onClose}>
          Đóng
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Auth({ onClose, onSuccess }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: data,
      });
      await onSuccess(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={register ? 'Chào bạn mới.' : 'Mừng bạn trở lại.'} onClose={onClose}>
      <p className="muted">Một tài khoản, nhiều lựa chọn ngon lành.</p>
      <form onSubmit={submit} className="form-stack">
        {register && (
          <label>
            Họ và tên
            <input name="name" required minLength={2} maxLength={80} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Mật khẩu
          <input
            name="password"
            type="password"
            required
            minLength={register ? 10 : 1}
            maxLength={128}
            autoComplete={register ? 'new-password' : 'current-password'}
          />
        </label>
        {register && <small>Ít nhất 10 ký tự. Tài khoản mới có vai trò khách hàng.</small>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Đang xử lý…' : register ? 'Tạo tài khoản' : 'Đăng nhập'}
        </button>
      </form>
      <p className="auth-switch">
        {register ? 'Đã có tài khoản?' : 'Lần đầu đến Cận?'}{' '}
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? 'Đăng nhập' : 'Đăng ký'}
        </button>
      </p>
    </Modal>
  );
}

function ProductCard({ product: p, onAdd, onDetail, adding }) {
  return (
    <article className="product-card">
      <button
        className={`product-art art-${p.visual}`}
        onClick={() => onDetail(p.id)}
        aria-label={`Xem ${p.name}`}
      >
        <span className="discount">Giảm {p.discount_percent}%</span>
        <Package type={p.visual} />
        <span className="art-caption">Minh họa sản phẩm</span>
      </button>
      <div className="product-info">
        <p className="product-brand">
          {p.brand} <span>{p.unit}</span>
        </p>
        <button className="product-name" onClick={() => onDetail(p.id)}>
          {p.name}
        </button>
        <div className={`expiry ${p.days_left <= 3 ? 'urgent' : ''}`}>
          <span>
            {p.days_left === 0 ? 'Dùng trong hôm nay' : `Còn ${p.days_left} ngày sử dụng`}
          </span>
          <span>HSD {date(p.expiry_date)}</span>
        </div>
        <div className="price-line">
          <strong>{money(p.price)}</strong>
          <del>{money(p.original_price)}</del>
        </div>
        <div className="product-actions">
          <button className="add-button" onClick={() => onAdd(p)} disabled={adding === p.id}>
            {adding === p.id ? 'Đang thêm…' : 'Thêm vào giỏ'}
          </button>
          <span>Còn {p.stock}</span>
        </div>
      </div>
    </article>
  );
}

function Detail({ product: p, onClose, onAdd, adding }) {
  return (
    <Modal title="Một lựa chọn ngon lành" onClose={onClose} wide>
      <div className="detail-grid">
        <div className={`detail-art art-${p.visual}`}>
          <Package type={p.visual} />
          <span className="art-caption">Bao bì minh họa</span>
        </div>
        <div>
          <p className="eyebrow">
            {p.brand} / {p.unit}
          </p>
          <h2>{p.name}</h2>
          <p>{p.description}</p>
          <div className="detail-expiry">
            <strong>Hạn sử dụng: {date(p.expiry_date)}</strong>
            <span>
              {p.expired
                ? 'Đã hết hạn — ngừng bán'
                : `Còn ${p.days_left} ngày · Giảm ${p.discount_percent}%`}
            </span>
          </div>
          <p className="muted">
            Nhà cung cấp: {p.vendor_name}
            <br />
            Mã lô: {p.lot_code} · Còn {p.stock} sản phẩm
          </p>
          <div className="price-line">
            <strong>{money(p.price)}</strong>
            <del>{money(p.original_price)}</del>
          </div>
          <div className="button-row">
            <button
              className="primary"
              disabled={p.expired || !p.stock || adding === p.id}
              onClick={() => onAdd(p)}
            >
              Thêm vào giỏ
            </button>
            <button
              className="secondary"
              disabled={p.expired || !p.stock || adding === p.id}
              onClick={() => onAdd(p, true)}
            >
              Mua ngay
            </button>
          </div>
          <small>
            Kiểm tra thông tin dị ứng và hướng dẫn bảo quản trên bao bì. Chọn lượng dùng hết trước
            hạn.
          </small>
        </div>
      </div>
      <div className="reviews">
        <h3>Đánh giá từ người đã mua</h3>
        {p.reviews?.length ? (
          p.reviews.map((r, i) => (
            <div key={i}>
              <strong>
                {r.name} · {r.rating}/5 điểm
              </strong>
              <p>{r.content}</p>
            </div>
          ))
        ) : (
          <p className="muted">Sản phẩm chưa có đánh giá được duyệt.</p>
        )}
      </div>
    </Modal>
  );
}

function Cart({ cart, user, onQuantity, onLogin, onCheckout, onShop, busy, config }) {
  return (
    <section className="page-section">
      <div className="page-heading">
        <p className="eyebrow">MUA VỪA ĐỦ, VUI NHIỀU HƠN</p>
        <h1>Giỏ hàng của bạn.</h1>
        <p className="muted">Kiểm tra hạn sử dụng lần cuối trước khi đặt hàng.</p>
        {user && user.role !== 'customer' && (
          <p className="muted">Đăng nhập bằng tài khoản khách hàng để sử dụng giỏ và đặt hàng.</p>
        )}
      </div>
      {!cart.items.length ? (
        <div className="empty">
          <h2>Giỏ hàng đang chờ món ngon.</h2>
          <p>Chọn vài món bạn có thể dùng hết trước hạn.</p>
          <button className="primary" onClick={onShop}>
            Khám phá sản phẩm
          </button>
        </div>
      ) : (
        <div className="checkout-grid">
          <div className="cart-list">
            {cart.items.map((item) => (
              <article className="cart-row" key={item.id}>
                <div className={`cart-art art-${item.visual}`}>
                  <Package type={item.visual} />
                </div>
                <div className="cart-description">
                  <strong>{item.name}</strong>
                  <p>
                    {item.unit} · HSD {date(item.expiry_date)}
                  </p>
                  {(item.expired || !item.active || item.stock < item.quantity) && (
                    <p className="error">
                      Hàng không đủ điều kiện đặt. Vui lòng cập nhật hoặc bỏ khỏi giỏ.
                    </p>
                  )}
                  <div className="quantity">
                    <button
                      disabled={busy || item.quantity <= 1}
                      onClick={() => onQuantity(item, item.quantity - 1)}
                      aria-label={`Giảm số lượng ${item.name}`}
                    >
                      Bớt
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      disabled={busy || item.quantity >= item.stock || item.quantity >= 99}
                      onClick={() => onQuantity(item, item.quantity + 1)}
                      aria-label={`Tăng số lượng ${item.name}`}
                    >
                      Thêm
                    </button>
                    <button className="remove" disabled={busy} onClick={() => onQuantity(item, 0)}>
                      Bỏ
                    </button>
                  </div>
                </div>
                <strong className="row-price">{money((item.price || 0) * item.quantity)}</strong>
              </article>
            ))}
            <button className="text-button" onClick={onShop}>
              Tiếp tục chọn sản phẩm
            </button>
          </div>
          <OrderSummary cart={cart} config={config}>
            <button
              className="primary full"
              disabled={
                busy || cart.items.some((i) => i.expired || !i.active || i.quantity > i.stock)
              }
              onClick={user ? onCheckout : onLogin}
            >
              {user && user.role !== 'customer'
                ? 'Cần tài khoản khách hàng'
                : user
                  ? 'Tiến hành đặt hàng'
                  : 'Đăng nhập để đặt hàng'}
            </button>
            <p className="fine-print">
              Thanh toán khi nhận hàng. Giá và tồn kho được kiểm tra lại khi xác nhận đơn.
            </p>
          </OrderSummary>
        </div>
      )}
    </section>
  );
}

function OrderSummary({ cart, children, config }) {
  return (
    <aside className="order-summary">
      <h2>Đơn hàng của bạn</h2>
      <div>
        <span>Tạm tính</span>
        <strong>{money(cart.subtotal)}</strong>
      </div>
      <div>
        <span>Phí giao hàng</span>
        <strong>{cart.shipping_fee ? money(cart.shipping_fee) : 'Miễn phí'}</strong>
      </div>
      <div className="summary-saving">
        <span>Bạn tiết kiệm</span>
        <strong>{money(cart.savings)}</strong>
      </div>
      <div className="summary-total">
        <span>Tổng thanh toán</span>
        <strong>{money(cart.total)}</strong>
      </div>
      <p className="fine-print">Miễn phí giao hàng từ {money(config.free_shipping_threshold)}.</p>
      {children}
    </aside>
  );
}

function Checkout({ cart, user, config, onComplete, refreshCart, notify }) {
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const order = await api('/orders', {
        method: 'POST',
        body: {
          ...data,
          payment_method: 'cod',
          request_key: key.current,
          expected_total: cart.total,
        },
      });
      onComplete(order.id);
    } catch (err) {
      notify(err.message, 'error');
      await refreshCart();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-section">
      <div className="page-heading">
        <p className="eyebrow">CHỈ CÒN MỘT BƯỚC</p>
        <h1>Gửi món ngon đến bạn.</h1>
      </div>
      <form className="checkout-grid" onSubmit={submit}>
        <div className="checkout-form form-stack">
          <h2>Thông tin nhận hàng</h2>
          <div className="form-columns">
            <label>
              Họ và tên
              <input
                required
                name="recipient"
                minLength={2}
                maxLength={80}
                defaultValue={user.name}
                autoComplete="name"
              />
            </label>
            <label>
              Số điện thoại
              <input
                required
                name="phone"
                type="tel"
                pattern="(0|\+84)[0-9]{9,10}"
                title="Số điện thoại bắt đầu bằng 0 hoặc +84"
                autoComplete="tel"
              />
            </label>
          </div>
          <label>
            Địa chỉ giao hàng
            <textarea
              name="address"
              required
              minLength={10}
              maxLength={300}
              placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố"
              autoComplete="street-address"
            />
          </label>
          <label>
            Ghi chú (không bắt buộc)
            <input name="note" maxLength={500} placeholder="Ví dụ: Gọi trước khi giao hàng" />
          </label>
          <div className="payment">
            <strong>Thanh toán khi nhận hàng (COD)</strong>
            <p>Bạn thanh toán cho nhân viên giao hàng khi nhận đơn.</p>
          </div>
          <h3>Sản phẩm trong đơn</h3>
          {cart.items.map((i) => (
            <div className="checkout-item" key={i.id}>
              <span>
                {i.name} × {i.quantity}
                <small>HSD {date(i.expiry_date)}</small>
              </span>
              <strong>{money(i.price * i.quantity)}</strong>
            </div>
          ))}
          <label className="checkbox">
            <input type="checkbox" required />
            Tôi đã kiểm tra hạn sử dụng và sẽ dùng sản phẩm trước hạn.
          </label>
        </div>
        <OrderSummary cart={cart} config={config}>
          <button
            className="primary full"
            disabled={
              busy ||
              !cart.items.length ||
              cart.items.some((i) => i.expired || !i.active || i.quantity > i.stock)
            }
          >
            {busy ? 'Đang đặt hàng…' : `Đặt hàng · ${money(cart.total)}`}
          </button>
          <p className="fine-print">
            Không cần nhập thông tin thẻ. Bạn có thể hủy khi đơn đang chờ xác nhận.
          </p>
        </OrderSummary>
      </form>
    </section>
  );
}

export function OrderList({ user, notify, reloadToken = 0 }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  async function load() {
    try {
      setOrders(await api('/orders'));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [reloadToken]);
  async function change(id, status) {
    setBusy(true);
    try {
      await api(`/orders/${id}/status`, { method: 'PATCH', body: { status } });
      await load();
      notify('Đã cập nhật đơn hàng.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function submitReview(e) {
    e.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api('/reviews', {
        method: 'POST',
        body: { product_id: review.product_id, rating: Number(data.rating), content: data.content },
      });
      setReview(null);
      notify('Đã gửi đánh giá, chờ kiểm duyệt.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  const staff = ['admin', 'manager'].includes(user.role);
  return (
    <div className="order-list">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!orders && !error && <p role="status">Đang tải đơn hàng…</p>}
      {orders?.length === 0 && (
        <div className="empty">
          <h3>Chưa có đơn hàng.</h3>
          <p>Các đơn phù hợp với tài khoản của bạn sẽ hiển thị tại đây.</p>
        </div>
      )}
      {orders?.map((o) => (
        <article className="order-card" key={o.id}>
          <div className="order-header">
            <div>
              <strong>Đơn CAN-{String(o.id).padStart(5, '0')}</strong>
              <small>{date(o.created_at)}</small>
            </div>
            <span className={`status status-${o.status}`}>{statusNames[o.status]}</span>
          </div>
          {o.items.map((i, index) => (
            <div className="order-item" key={index}>
              <span>
                {i.product_name} × {i.quantity}
                <small>HSD {date(i.expiry_date)}</small>
              </span>
              <div>
                <strong>{money(i.unit_price * i.quantity)}</strong>
                {user.role === 'customer' && o.status === 'delivered' && (
                  <button className="text-button" onClick={() => setReview(i)}>
                    Viết đánh giá
                  </button>
                )}
              </div>
            </div>
          ))}
          {o.recipient && (
            <p className="muted">
              {o.recipient} · {o.phone}
              <br />
              {o.address}
              {o.note && (
                <>
                  <br />
                  Ghi chú: {o.note}
                </>
              )}
            </p>
          )}
          <div className="order-bottom">
            <strong>
              {user.role === 'vendor' ? 'Giá trị hàng của bạn' : 'Tổng thanh toán'}:{' '}
              {money(o.total ?? o.items.reduce((s, i) => s + i.quantity * i.unit_price, 0))}
            </strong>
            <div className="button-row">
              {user.role === 'customer' && o.status === 'pending' && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => change(o.id, 'cancelled')}
                >
                  Hủy đơn
                </button>
              )}
              {staff && ['pending', 'failed'].includes(o.status) && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => change(o.id, 'confirmed')}
                >
                  {o.status === 'failed' ? 'Giao lại' : 'Xác nhận đơn'}
                </button>
              )}
              {staff && ['pending', 'confirmed', 'failed'].includes(o.status) && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => change(o.id, 'cancelled')}
                >
                  Hủy đơn
                </button>
              )}
              {user.role === 'shipper' && o.status === 'confirmed' && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => change(o.id, 'shipping')}
                >
                  Nhận đơn và giao
                </button>
              )}
              {user.role === 'shipper' && o.status === 'shipping' && (
                <>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => change(o.id, 'delivered')}
                  >
                    Giao thành công · Đã thu tiền
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => change(o.id, 'failed')}
                  >
                    Giao thất bại
                  </button>
                </>
              )}
            </div>
          </div>
        </article>
      ))}
      {review && (
        <Modal title={`Đánh giá ${review.product_name}`} onClose={() => setReview(null)}>
          <form onSubmit={submitReview} className="form-stack">
            <label>
              Điểm đánh giá
              <select name="rating" defaultValue="5">
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n}/5 điểm
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nhận xét
              <textarea name="content" required minLength={5} maxLength={1000} />
            </label>
            <button className="primary" disabled={busy}>
              Gửi đánh giá
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

const emptyCart = { items: [], subtotal: 0, shipping_fee: 0, total: 0, savings: 0 };
function readGuest() {
  try {
    const stored = JSON.parse(localStorage.getItem('can-cart') || '[]');
    return Array.isArray(stored)
      ? stored
          .filter(
            (i) =>
              Number.isInteger(i.id) &&
              Number.isInteger(i.quantity) &&
              i.quantity > 0 &&
              i.quantity <= 99
          )
          .slice(0, 99)
      : [];
  } catch {
    return [];
  }
}
export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState('home');
  const [auth, setAuth] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [config, setConfig] = useState({ free_shipping_threshold: 199000, shipping_fee: 25000 });
  const [filters, setFilters] = useState({
    q: '',
    category: '',
    expiry: 'all',
    sort: 'recommended',
    page: 1,
  });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [productError, setProductError] = useState('');
  const [detail, setDetail] = useState(null);
  const [cart, setCart] = useState(emptyCart);
  const [guest, setGuest] = useState(readGuest);
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [success, setSuccess] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const toastTimer = useRef();
  const catalog = useRef();
  function notify(message, type = 'success') {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }
  async function refreshCart() {
    try {
      setCart(await api('/cart'));
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all([api('/auth/me'), api('/categories'), api('/settings')])
      .then(async ([session, cats, settings]) => {
        if (cancelled) return;
        setUser(session.user);
        setCategories(cats);
        setConfig(settings);
        if (session.user?.role === 'customer') setCart(await api('/cart'));
      })
      .catch((e) => {
        if (!cancelled) notify(e.message, 'error');
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    const saved = readGuest();
    if (saved.length)
      Promise.all(
        saved.map(async (i) => ({ ...(await api(`/products/${i.id}`)), quantity: i.quantity }))
      )
        .then((items) => {
          if (!cancelled) setGuest(items);
        })
        .catch(() => {
          if (!cancelled)
            notify(
              'Không thể cập nhật giỏ đã lưu. Giá sẽ được kiểm tra lại khi đăng nhập.',
              'error'
            );
        });
    return () => {
      cancelled = true;
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem('can-cart', JSON.stringify(guest));
  }, [guest]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setProductError('');
      const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== ''));
      try {
        const data = await api(`/products?${query}`, { signal: controller.signal });
        setProducts(data.items);
        setTotal(data.total);
      } catch (e) {
        if (e.name !== 'AbortError') setProductError(e.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, refresh]);
  useEffect(() => {
    if (view !== 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);
  const guestSubtotal = guest.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
  const guestFee =
    guest.length && guestSubtotal < config.free_shipping_threshold ? config.shipping_fee : 0;
  const activeCart =
    user?.role === 'customer'
      ? cart
      : {
          ...emptyCart,
          items: guest,
          subtotal: guestSubtotal,
          shipping_fee: guestFee,
          total: guestSubtotal + guestFee,
          savings: guest.reduce(
            (s, i) => s + (i.original_price - (i.price || i.original_price)) * i.quantity,
            0
          ),
        };
  const count = activeCart.items.reduce((s, i) => s + i.quantity, 0);
  function shop() {
    setView('home');
    setTimeout(() => catalog.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }
  async function onAdd(product, buyNow = false) {
    if (user && user.role !== 'customer') {
      notify('Hãy dùng tài khoản khách hàng để mua sắm.', 'error');
      return;
    }
    if (adding !== null) return;
    setAdding(product.id);
    try {
      const old = activeCart.items.find((i) => i.id === product.id)?.quantity || 0;
      if (old >= Math.min(product.stock, 99)) throw new Error('Bạn đã chọn đủ số lượng hiện có.');
      if (user)
        setCart(await api(`/cart/${product.id}`, { method: 'PUT', body: { quantity: old + 1 } }));
      else
        setGuest((prev) => [
          ...prev.filter((i) => i.id !== product.id),
          { ...product, quantity: old + 1 },
        ]);
      if (buyNow) {
        setDetail(null);
        setView('cart');
      } else notify(`Đã thêm ${product.name} vào giỏ.`);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setAdding(null);
    }
  }
  async function quantity(item, n) {
    setBusy(true);
    try {
      if (user) setCart(await api(`/cart/${item.id}`, { method: 'PUT', body: { quantity: n } }));
      else
        setGuest((prev) =>
          n
            ? prev.map((i) => (i.id === item.id ? { ...i, quantity: n } : i))
            : prev.filter((i) => i.id !== item.id)
        );
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function login(newUser) {
    setUser(newUser);
    setAuth(false);
    if (newUser.role === 'customer') {
      try {
        if (guest.length) {
          setCart(
            await api('/cart/merge', {
              method: 'POST',
              body: { items: guest.map((i) => ({ id: i.id, quantity: i.quantity })) },
            })
          );
          setGuest([]);
        } else setCart(await api('/cart'));
      } catch (e) {
        await refreshCart();
        notify(`Đã đăng nhập. ${e.message} Giỏ trước đăng nhập vẫn được giữ lại.`, 'error');
        return;
      }
      notify(`Chào ${newUser.name}, mừng bạn đến Cận.`);
    } else setView('dashboard');
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
      setUser(null);
      setCart(emptyCart);
      setView('home');
      notify('Đã đăng xuất.');
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  async function showDetail(id) {
    try {
      setDetail(await api(`/products/${id}`));
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  function info() {
    setView('home');
    setTimeout(
      () => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }),
      50
    );
  }
  function setFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value, page: 1 }));
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Đến nội dung chính
      </a>
      <div className="announcement">
        Món ngon còn hạn. Giá tốt mỗi ngày.{' '}
        <span>Miễn phí giao hàng từ {money(config.free_shipping_threshold)}</span>
      </div>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="logo"
            onClick={() => {
              setView('home');
              window.scrollTo({ top: 0 });
            }}
            aria-label="Cận, trang chủ"
          >
            cận<span>.</span>
          </button>
          <nav aria-label="Điều hướng chính">
            <button className={view === 'home' ? 'active' : ''} onClick={shop}>
              Khám phá sản phẩm
            </button>
            <button onClick={info}>Cách Cận hoạt động</button>
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                <button
                  className="account"
                  onClick={() => setView(user.role === 'customer' ? 'orders' : 'dashboard')}
                >
                  {user.role === 'customer' ? 'Đơn hàng' : roleNames[user.role]}
                </button>
                <button className="logout" onClick={logout}>
                  Đăng xuất
                </button>
              </>
            ) : (
              <button className="account" disabled={!ready} onClick={() => setAuth(true)}>
                Tài khoản
              </button>
            )}
            <button className="cart-button" onClick={() => setView('cart')}>
              Giỏ hàng <span>{count}</span>
            </button>
          </div>
        </div>
      </header>
      <main id="main">
        {view === 'home' && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span className="mini-rule" /> ÍT LÃNG PHÍ. THÊM GIÁ TRỊ.
                </p>
                <h1>
                  Ngon lành hôm nay.
                  <br />
                  <em>Nhẹ ví mỗi ngày.</em>
                </h1>
                <p className="hero-description">
                  Những món ngon vẫn còn trọn vị, với mức giá dễ thương hơn. Cùng Cận chọn vừa đủ,
                  dùng đúng lúc.
                </p>
                <div className="hero-cta">
                  <button className="primary" onClick={shop}>
                    Khám phá ưu đãi
                  </button>
                  <span>
                    Tiết kiệm đến{' '}
                    {Math.max(
                      ...(config.discount_tiers || [{ percent: 80 }]).map((t) => t.percent)
                    )}
                    %
                  </span>
                </div>
                <div className="hero-note">
                  <span>Hạn sử dụng rõ ràng</span>
                  <span>Giá tốt thật lòng</span>
                  <span>Mua sắm có ý thức</span>
                </div>
              </div>
              <div className="hero-scene">
                <div className="scene-heading">
                  GOOD FOOD.
                  <br />
                  <i>BETTER CHOICES.</i>
                </div>
                <div className="scene-oval" />
                <div className="hero-granola">
                  <Package type="granola" hero />
                </div>
                <div className="hero-oat">
                  <Package type="oat" hero />
                </div>
                <div className="hero-juice">
                  <Package type="juice" hero />
                </div>
                <div className="scene-stamp">
                  <span>VẪN NGON.</span>
                  <strong>
                    Giá nhẹ
                    <br />
                    hơn nhiều.
                  </strong>
                  <span>CẬN, CHƯA HẾT HẠN.</span>
                </div>
                <p className="scene-caption">
                  Một lựa chọn nhỏ. Một thay đổi tốt.<span>Bao bì minh họa</span>
                </p>
              </div>
            </section>
            <section className="promise-strip" aria-label="Cam kết">
              <div>
                <strong>Còn hạn, còn ngon</strong>
                <span>Hạn sử dụng hiển thị trên từng sản phẩm</span>
              </div>
              <div>
                <strong>Càng cận, càng tiết kiệm</strong>
                <span>Ưu đãi theo số ngày sử dụng còn lại</span>
              </div>
              <div>
                <strong>Đặt nhanh, nhận gọn</strong>
                <span>Thanh toán khi nhận hàng, không cần thẻ</span>
              </div>
            </section>
            <section className="catalog" ref={catalog}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">CHỌN MÓN BẠN THÍCH</p>
                  <h2>Giá tốt, đừng để lỡ.</h2>
                </div>
                <p>
                  Vừa đủ cho bạn.
                  <br />
                  Bớt lãng phí cho hành tinh.
                </p>
              </div>
              <div className="catalog-toolbar">
                <div className="category-tabs" aria-label="Danh mục">
                  <button
                    className={!filters.category ? 'selected' : ''}
                    onClick={() => setFilter('category', '')}
                  >
                    Tất cả sản phẩm
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      className={String(c.id) === filters.category ? 'selected' : ''}
                      onClick={() => setFilter('category', String(c.id))}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
                <label className="search-label">
                  <span className="sr-only">Tìm kiếm sản phẩm</span>
                  <input
                    type="search"
                    placeholder="Tìm món ngon của bạn…"
                    value={filters.q}
                    onChange={(e) => setFilter('q', e.target.value)}
                  />
                </label>
              </div>
              <div className="filter-row">
                <div>
                  <span className="filter-label">Hạn sử dụng còn</span>
                  <div className="expiry-tabs">
                    {[
                      ['all', 'Tất cả'],
                      ['3', '0–3 ngày'],
                      ['7', '0–7 ngày'],
                      ['14', '0–14 ngày'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={filters.expiry === value ? 'selected' : ''}
                        onClick={() => setFilter('expiry', value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="sort-label">
                  Sắp xếp:
                  <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)}>
                    <option value="recommended">Cận gợi ý</option>
                    <option value="price_asc">Giá thấp đến cao</option>
                    <option value="expiry">Hạn gần nhất</option>
                    <option value="discount">Giảm nhiều nhất</option>
                  </select>
                </label>
              </div>
              <div aria-live="polite" className="results-label">
                {loading ? 'Đang tìm món ngon…' : `${total} lựa chọn đang chờ bạn`}
              </div>
              {productError ? (
                <div className="empty">
                  <p className="error">{productError}</p>
                  <button className="secondary" onClick={() => setRefresh((n) => n + 1)}>
                    Thử lại
                  </button>
                </div>
              ) : !loading && !products.length ? (
                <div className="empty">
                  <h3>Chưa tìm thấy món phù hợp.</h3>
                  <button
                    className="text-button"
                    onClick={() =>
                      setFilters({
                        q: '',
                        category: '',
                        expiry: 'all',
                        sort: 'recommended',
                        page: 1,
                      })
                    }
                  >
                    Xóa bộ lọc
                  </button>
                </div>
              ) : (
                <div className={`product-grid ${loading ? 'is-loading' : ''}`}>
                  {products.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      onAdd={onAdd}
                      onDetail={showDetail}
                      adding={adding}
                    />
                  ))}
                </div>
              )}
              {total > 24 && (
                <div className="pagination">
                  <button
                    className="secondary"
                    disabled={filters.page <= 1}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
                  >
                    Trang trước
                  </button>
                  <span>
                    Trang {filters.page} / {Math.ceil(total / 24)}
                  </span>
                  <button
                    className="secondary"
                    disabled={filters.page * 24 >= total}
                    onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
                  >
                    Trang sau
                  </button>
                </div>
              )}
            </section>
            <section id="how-it-works" className="how-section">
              <div>
                <p className="eyebrow">CẬN MỘT CHÚT, TỐT THÊM NHIỀU</p>
                <h2>
                  Đồ ngon xứng đáng
                  <br />
                  được dùng hết.
                </h2>
                <p>
                  “Cận date” là sản phẩm gần đến hạn sử dụng, vẫn còn trong thời gian sử dụng ghi
                  trên bao bì. Bạn biết rõ mình mua gì, còn bao lâu và tiết kiệm bao nhiêu.
                </p>
              </div>
              <div className="how-steps">
                {[
                  ['01', 'Chọn món, xem hạn', 'Hạn sử dụng và mức giảm luôn ở ngay trước mắt.'],
                  ['02', 'Mua vừa đủ dùng', 'Chọn số lượng phù hợp với thời gian còn lại.'],
                  ['03', 'Nhận hàng, tận hưởng', 'Bảo quản đúng hướng dẫn và dùng trước hạn.'],
                ].map(([n, title, desc]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        {view === 'cart' && (
          <>
            {user?.role === 'customer' && guest.length > 0 && (
              <div className="cart-recovery">
                <p>
                  Giỏ trước đăng nhập có {guest.length} lô chưa được ghép. Bạn có thể thử lại hoặc
                  bỏ phần giỏ này để dùng giỏ tài khoản.
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        setCart(
                          await api('/cart/merge', {
                            method: 'POST',
                            body: { items: guest.map((i) => ({ id: i.id, quantity: i.quantity })) },
                          })
                        );
                        setGuest([]);
                        notify('Đã ghép giỏ hàng.');
                      } catch (e) {
                        notify(e.message, 'error');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Thử ghép lại
                  </button>
                  <button className="text-button" onClick={() => setGuest([])}>
                    Bỏ giỏ trước đăng nhập
                  </button>
                </div>
              </div>
            )}
            <Cart
              cart={activeCart}
              user={user}
              config={config}
              onQuantity={quantity}
              onLogin={() => setAuth(true)}
              onCheckout={() => setView('checkout')}
              onShop={shop}
              busy={busy || Boolean(user && user.role !== 'customer')}
            />
          </>
        )}
        {view === 'checkout' && user?.role === 'customer' && (
          <Checkout
            cart={cart}
            user={user}
            config={config}
            notify={notify}
            refreshCart={refreshCart}
            onComplete={(id) => {
              setSuccess(id);
              setCart(emptyCart);
              setView('success');
              setRefresh((n) => n + 1);
            }}
          />
        )}
        {view === 'success' && (
          <section className="success-page">
            <p className="eyebrow">CẢM ƠN BẠN ĐÃ CHỌN CẬN</p>
            <h1>Món ngon đang được chuẩn bị.</h1>
            <p>
              Đơn hàng <strong>CAN-{String(success).padStart(5, '0')}</strong> đã được ghi nhận.
              <br />
              Bạn sẽ thanh toán khi nhận hàng.
            </p>
            <div className="button-row">
              <button className="primary" onClick={() => setView('orders')}>
                Theo dõi đơn hàng
              </button>
              <button className="secondary" onClick={shop}>
                Tiếp tục mua sắm
              </button>
            </div>
          </section>
        )}
        {view === 'orders' && user && (
          <section className="page-section">
            <div className="page-heading">
              <p className="eyebrow">XIN CHÀO, {user.name.toUpperCase()}</p>
              <h1>Những đơn hàng của bạn.</h1>
            </div>
            <OrderList user={user} notify={notify} />
          </section>
        )}
        {view === 'dashboard' && user && (
          <Dashboard
            user={user}
            notify={notify}
            categories={categories}
            onChange={() => {
              setRefresh((n) => n + 1);
              api('/categories')
                .then(setCategories)
                .catch((e) => notify(e.message, 'error'));
              api('/settings')
                .then(setConfig)
                .catch((e) => notify(e.message, 'error'));
            }}
          />
        )}
      </main>
      <footer>
        <div>
          <button
            className="logo"
            onClick={() => {
              setView('home');
              window.scrollTo({ top: 0 });
            }}
          >
            cận<span>.</span>
          </button>
          <p>
            Ngon lành, giá nhẹ.
            <br />
            Bớt lãng phí từ những lựa chọn mỗi ngày.
          </p>
        </div>
        <div>
          <strong>Mua sắm cùng Cận</strong>
          <button onClick={shop}>Khám phá sản phẩm</button>
          <button onClick={info}>Hiểu về hàng cận date</button>
        </div>
        <div>
          <strong>Minh bạch từ đầu</strong>
          <p>
            Hạn dùng rõ ràng trên từng lô.
            <br />
            Thanh toán khi nhận hàng.
            <br />
            Dùng trước hạn, bảo quản đúng cách.
          </p>
        </div>
        <div className="footer-bottom">
          Cận Market · 2026<span>Bản demo · Sản phẩm và bao bì minh họa</span>
        </div>
      </footer>
      {auth && <Auth onClose={() => setAuth(false)} onSuccess={login} />}{' '}
      {detail && (
        <Detail product={detail} onClose={() => setDetail(null)} onAdd={onAdd} adding={adding} />
      )}
      {toast && (
        <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)}>Đóng</button>
        </div>
      )}
    </>
  );
}
