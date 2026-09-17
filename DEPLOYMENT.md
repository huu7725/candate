# Triển khai Cận đầy đủ trên Render

Ứng dụng cần **Node.js + Express + SQLite**. Render chạy API và phục vụ frontend Vite đã build trên **cùng một URL HTTPS**. Không cần GitHub Pages, không cần CORS, không tạo PostgreSQL hay dịch vụ database khác.

## Vì sao GitHub Pages hiện trang trắng?

Trang `https://huu7725.github.io/candate/` đang phục vụ `index.html` nguồn, trong đó gọi `/src/main.jsx`. Đường dẫn này trả HTTP 404; React chưa được biên dịch và không được tải. Action “pages build and deployment” thành công chỉ có nghĩa GitHub đã xuất bản các tệp, không bảo đảm ứng dụng đã được build bằng Vite hoặc có backend.

Ngay cả khi build Vite và đặt `base: '/candate/'`, Pages vẫn không chạy Express/SQLite. Do đó hướng được chọn là chuyển **toàn bộ ứng dụng** sang Render, giữ `base` mặc định `/`.

## Chi phí

Theo tài liệu Render kiểm tra ngày 17/09/2026, ổ bền vững chỉ gắn được vào dịch vụ trả phí. Blueprint dùng plan `0.5c-512mb` (7 USD/tháng) và ổ 1 GB (0,25 USD/tháng), tổng cơ bản khoảng **7,25 USD/tháng**, chưa bao gồm thuế hoặc phát sinh khác. Workspace Hobby có thể dùng cho cấu hình này. Kiểm tra lại tổng phí Render hiển thị trước khi tạo dịch vụ.

**Không đổi sang Free để lưu SQLite**: filesystem không có persistent disk có thể mất dữ liệu sau restart/redeploy. Dự án này không dùng database bên ngoài.

## Cách triển khai bằng Blueprint

1. Vào [Render Dashboard](https://dashboard.render.com/), đăng nhập và kết nối GitHub.
2. Chọn **New → Blueprint** và chọn repository **`huu7725/candate`**, nhánh **`main`**. Nếu Render hỏi đường dẫn Blueprint, dùng `render.yaml` ở thư mục gốc.
3. Render đọc cấu hình trong [render.yaml](render.yaml): Web Service Node.js, Singapore, disk 1 GB, build/test, start và health check.
4. Điền hai biến mà Render yêu cầu:
   - `ADMIN_EMAIL`: email bạn muốn dùng đăng nhập quản trị.
   - `ADMIN_PASSWORD`: mật khẩu riêng từ 12 đến 128 ký tự. Không dùng `CanDate2026!`; không gửi mật khẩu vào chat hoặc commit vào Git.
5. Kiểm tra gói máy chủ và phí disk, rồi tạo/triển khai Blueprint trên Render.
6. Chờ service báo **Live**. Mở **URL `.onrender.com` mà Render cấp** trên trang service. Tên URL có thể thêm hậu tố nếu `candate` đã được dùng.
7. Mở `<URL-của-bạn>/api/health`; kết quả đúng là `{"status":"ok"}`. Tại trang chủ, chọn **Tài khoản**, đăng nhập bằng email/mật khẩu bước 4; trang quản trị sẽ mở.

Sau khi có link Render, dùng link này để chia sẻ website. Link `huu7725.github.io/candate/` cũ không tự đổi thành dịch vụ Render. Có thể vào GitHub **Settings → Pages → Unpublish site** để bỏ trang trắng cũ; việc này không ảnh hưởng repository hay Render.

## Nếu tạo Web Service thủ công

| Trường                        | Giá trị                                                 |
| ----------------------------- | ------------------------------------------------------- |
| Repository                    | `https://github.com/huu7725/candate`                    |
| Branch                        | `main`                                                  |
| Service type / Runtime        | Web Service / Node                                      |
| Root Directory                | Để trống                                                |
| Build Command                 | `npm ci --include=dev && npm test && npm run build`     |
| Start Command                 | `npm start`                                             |
| Health Check Path             | `/api/health`                                           |
| Instance                      | Gói trả phí có hỗ trợ disk; Blueprint dùng `0.5c-512mb` |
| Disk name / Mount path / Size | `candate-data` / `/var/data` / `1 GB`                   |

Biến môi trường:

| Biến               | Giá trị                     |
| ------------------ | --------------------------- |
| `NODE_VERSION`     | `22.23.2`                   |
| `NODE_ENV`         | `production`                |
| `HOST`             | `0.0.0.0`                   |
| `DATABASE_PATH`    | `/var/data/candate.sqlite`  |
| `TRUST_PROXY_HOPS` | `1`                         |
| `ADMIN_NAME`       | `Quản trị Cận`              |
| `ADMIN_EMAIL`      | Email Admin của bạn         |
| `ADMIN_PASSWORD`   | Mật khẩu riêng 12–128 ký tự |

Render tự cấp `PORT`; ứng dụng đọc biến này. Không cần đặt `APP_ORIGIN` khi frontend và API dùng cùng URL. Nếu bạn đã đặt biến này thì dùng origin HTTPS chính xác, không có dấu `/` cuối, ví dụ `https://ten-service.onrender.com`.

Disk chỉ được mount khi service chạy; vì thế tạo schema/Admin diễn ra ở **start**, không phải build hoặc pre-deploy. Không thêm `npm run seed` vào bất kỳ lệnh deploy nào. Seed demo bị chặn trong môi trường production.

## Khởi tạo dữ liệu và tài khoản

Lần chạy đầu tạo **một Admin và bốn danh mục**. Chưa có sản phẩm, đơn hàng hoặc các tài khoản demo; dữ liệu SQLite trên máy tính không nằm trong Git nên không tự được đưa lên Render.

Để sử dụng đầy đủ các vai trò:

1. Đăng nhập Admin, vào **Tài khoản** để quản lý người dùng.
2. Các nhân sự/nhà cung cấp tự đăng ký trên website; mặc định là Customer.
3. Admin đổi vai trò tương ứng sang Manager, Vendor hoặc Shipper. Sau khi đổi, tài khoản cần đăng nhập lại vì phiên cũ bị thu hồi.
4. Tại **Kho hàng → Đăng sản phẩm mới**, Admin/Manager chọn nhà cung cấp, danh mục, mã lô, HSD, giá và tồn kho. Vendor có thể tự đăng hàng của mình.
5. Dùng tài khoản Customer để mua thử; Manager xác nhận; Shipper nhận và hoàn tất đơn.

Ở các lần restart/redeploy sau, tài khoản Admin, mật khẩu và dữ liệu hiện có được giữ nguyên. Khi Admin đã tồn tại, hai biến bootstrap không ghi đè mật khẩu. Có thể xóa `ADMIN_PASSWORD` khỏi Environment sau khi khởi tạo thành công nếu giữ nguyên database; nếu tạo một database mới hoàn toàn, cần cung cấp lại email/mật khẩu khởi tạo. Việc đổi biến này **không phải** chức năng đổi mật khẩu tài khoản.

## Dữ liệu bền vững và cập nhật mã

SQLite và các tệp `-wal`/`-shm` đều được ghi dưới `/var/data`, cùng disk. Giữ một service instance dùng disk này. Push commit mới lên `main` để Render deploy lại theo thiết lập auto-deploy của service; không xóa/tạo lại disk khi cập nhật mã.

Disk bảo đảm dữ liệu còn qua deploy; vẫn cần backup định kỳ bằng SQLite backup API khi đưa vào vận hành. Chỉ sao chép riêng file `.sqlite` khi đang ghi có thể bỏ sót dữ liệu trong WAL. Không đưa database chứa thông tin khách hàng lên GitHub.

## Kiểm tra lỗi thường gặp

| Triệu chứng / log                    | Cách xử lý                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Pages xanh nhưng trang trắng         | Mở link Render; Pages đang xuất bản mã nguồn và không có API                                    |
| Không tìm thấy cổng mở               | Kiểm tra `HOST=0.0.0.0`, Start Command là `npm start`; app dùng `PORT` Render cấp               |
| `Cần ADMIN_EMAIL hợp lệ...`          | Điền đủ email và mật khẩu riêng 12–128 ký tự trong Environment rồi redeploy                     |
| `ADMIN_EMAIL đã thuộc về...`         | Chọn email mới cho Admin đầu tiên; ứng dụng không tự nâng quyền tài khoản cũ                    |
| `Chưa có frontend build`             | Build Command phải có `npm ci --include=dev` và `npm run build`                                 |
| `SQLITE_CANTOPEN` hoặc lỗi quyền ghi | Kiểm tra disk mount `/var/data` và `DATABASE_PATH=/var/data/candate.sqlite`                     |
| Trang hiện nhưng không có sản phẩm   | Đăng nhập Admin và nhập sản phẩm/lô thật; dữ liệu demo local không tự chuyển lên                |
| Đăng nhập xong không giữ phiên       | Mở URL HTTPS của Render; production dùng cookie `Secure`                                        |
| Lỗi rate limit hoặc IP sau proxy     | Đặt `TRUST_PROXY_HOPS=1` trên Render; không dùng cấu hình này khi chạy trực tiếp không có proxy |

## Tài liệu chính thức đã đối chiếu

- [GitHub Pages là dịch vụ static](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
- [Vite: build và triển khai GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages)
- [Render: triển khai Express](https://render.com/docs/deploy-node-express-app)
- [Render: cấu hình Blueprint](https://render.com/docs/blueprint-spec)
- [Render: host và port của Web Service](https://render.com/docs/web-services#port-binding)
- [Render: persistent disk](https://render.com/docs/disks)
- [Render: bảng giá](https://render.com/pricing)
