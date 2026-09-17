export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    const error = new Error('Không thể kết nối dịch vụ. Vui lòng thử lại sau.');
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error([data.error, ...(data.details || [])].join(' '));
    error.status = response.status;
    throw error;
  }
  return data;
}
export const money = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value || 0);
export const date = (value) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN') : '';
export const roleNames = {
  admin: 'Quản trị viên',
  manager: 'Quản lý kho',
  customer: 'Khách hàng',
  vendor: 'Nhà cung cấp',
  shipper: 'Giao hàng',
};
export const statusNames = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  shipping: 'Đang giao',
  delivered: 'Thành công',
  failed: 'Giao thất bại',
  cancelled: 'Đã hủy',
};
