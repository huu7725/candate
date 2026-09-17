# Deploy miễn phí: Cloudflare Workers + D1

Đây là cấu hình online mặc định của Cận. **Workers Free** chạy API và phục vụ giao diện; **D1 Free** là SQLite do Cloudflare quản lý, giữ dữ liệu độc lập với các lần deploy. Dùng URL HTTPS `*.workers.dev` miễn phí, không cần mua tên miền hay thuê ổ đĩa Render.

## 1. Những gì được giữ lại

- Giao diện không icon, tìm kiếm, danh mục, lọc hạn dùng và giảm giá tự động.
- Đăng ký/đăng nhập, giỏ khách và ghép giỏ khi đăng nhập, checkout COD.
- Cả năm vai trò Admin, Manager, Customer, Vendor, Shipper.
- Tồn kho theo lô, kiểm tra hết hạn, chống bán vượt kho và đặt trùng.
- Lịch sử đơn, giao hàng, kiểm duyệt đánh giá, báo cáo và quản lý tài khoản.

Backend online dùng Hono/Web APIs phù hợp Workers thay vì Express và native `better-sqlite3`. Backend Express trong `server/` vẫn dùng để chạy local bằng `npm run dev`/`npm start`. Hai môi trường có database và cơ chế lưu mật khẩu riêng, không tự sao chép database hoặc tài khoản demo local sang D1.

## 2. Hạn mức Free

Đối chiếu tài liệu Cloudflare ngày 17/09/2026:

| Tài nguyên          | Hạn mức Free                                                      |
| ------------------- | ----------------------------------------------------------------- |
| Worker API requests | 100.000/ngày cho tài khoản                                        |
| Worker CPU          | 10 ms cho mỗi request; thời gian chờ D1/network không tính là CPU |
| D1 đọc              | 5 triệu dòng/ngày                                                 |
| D1 ghi              | 100.000 dòng/ngày                                                 |
| D1 dung lượng       | 500 MB/database; tổng tối đa 5 GB cho tài khoản Free              |

Giữ tài khoản trên **Workers Free**, không bật Workers Paid. Khi vượt hạn mức Free, API/database có thể từ chối yêu cầu; đây không phải hosting không giới hạn. Theo dõi Usage trong dashboard. Hạn mức đọc/ghi tính theo **số dòng**, bao gồm ảnh hưởng của index, không phải số đơn hàng. Phù hợp phát triển, đồ án và thử nghiệm với lưu lượng nhỏ; cần theo dõi CPU/usage khi bắt đầu có dữ liệu và người dùng thật.

Tài liệu: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## 3. Chuẩn bị trên máy tính

1. Tạo tài khoản tại [Cloudflare Dashboard](https://dash.cloudflare.com/), chọn gói miễn phí.
2. Cài **Node.js 22 LTS trở lên**, khuyến nghị `22.23.2`. Kiểm tra `node -v`; nếu đang là v20, cập nhật Node và mở terminal mới. Wrangler của dự án cần Node >=22.
3. Mở terminal tại thư mục dự án, cập nhật mã và cài dependencies:

```powershell
git pull origin main
npm ci
```

Nếu vừa nâng Node, cần chạy lại `npm ci` để native SQLite của bản local khớp phiên bản Node. Các bước bên dưới dùng database Cloudflare riêng, không đụng `data/market.sqlite`.

## 4. Đăng nhập Cloudflare và tạo D1

```powershell
npm run cf:login
npm run cf:db:create
```

Lệnh đầu mở browser để bạn đăng nhập và cấp quyền cho Wrangler. Lệnh thứ hai tạo **`candate-db`** và cập nhật binding **`DB`** trong `wrangler.jsonc` với `database_id` thật.

Mở `wrangler.jsonc` và kiểm tra chỉ có **một** binding `DB`, ID không còn là `00000000-0000-0000-0000-000000000000`. Nếu CLI chỉ in cấu hình mà chưa ghi file, chép `database_id` nó trả về vào mục `d1_databases[0].database_id`. ID database không phải mật khẩu. Nếu database đã được tạo từ lần trước, dùng ID database đó, không tạo thêm.

Sau đó tạo bảng bằng migration:

```powershell
npm run cf:migrate
```

Chấp nhận xác nhận áp dụng migration khi CLI hỏi. Lần đầu tạo schema và bốn danh mục. Những lần sau chỉ áp dụng migration mới, không reset dữ liệu.

## 5. Deploy website và tạo khóa đăng nhập

```powershell
npm run cf:deploy
npm run cf:secret
```

`cf:deploy` build React đúng mode Cloudflare vào `dist-cloudflare`, rồi upload frontend + Worker. Nếu tài khoản chưa có subdomain Workers, làm theo hướng dẫn CLI/dashboard để chọn một subdomain miễn phí. Mở URL HTTPS mà CLI in ra, dạng `https://candate.<ten-cua-ban>.workers.dev`.

`cf:secret` tự tạo khóa ngẫu nhiên **AUTH_SECRET**, lưu bản local trong `.dev.vars` đã bị Git bỏ qua, rồi đặt khóa đó thành Worker Secret. Lệnh không in khóa lên terminal. Nếu `.dev.vars` đã có khóa, lệnh dùng lại đúng khóa cũ. Lần deploy đầu chưa có secret, chức năng đăng nhập/đăng ký chỉ hoạt động sau khi lệnh này hoàn tất.

**Giữ bản sao `.dev.vars` riêng tư**. Không commit hoặc đưa nó lên GitHub. Không tự tạo lại/đổi AUTH_SECRET sau khi đã có tài khoản: khóa này tham gia xác thực mật khẩu, đổi khóa làm các mật khẩu hiện có không còn xác thực được. Khi chuyển máy, dùng lại đúng khóa từ bản sao; không dùng khóa mới với database cũ.

## 6. Tạo Admin riêng

```powershell
npm run cf:admin
```

Nhập email, tên và mật khẩu Admin (12–128 ký tự). Mật khẩu nhập trong terminal được ẩn. Script tạo hash, gửi câu lệnh khởi tạo tới D1 và xóa file SQL tạm sau khi chạy. Không truyền mật khẩu trong command line hoặc gửi vào chat.

Script chỉ tạo Admin đầu tiên; nếu đã có Admin thì giữ nguyên. Không reset mật khẩu, không tự nâng quyền tài khoản Customer trùng email. Sau đó mở website, chọn **Tài khoản** và đăng nhập bằng thông tin vừa đặt.

Ban đầu website **chưa có sản phẩm**; đây là database mới, không phải lỗi. Nhân sự/nhà cung cấp đăng ký trước, Admin đổi vai trò trong trang **Tài khoản**. Admin/Manager/Vendor thêm sản phẩm và lô; Customer mua hàng; Manager xác nhận; Shipper giao. Không có mật khẩu demo công khai trên D1.

## 7. Kiểm tra website và cập nhật sau này

- Mở `<URL-workers.dev>/api/health`: kết quả đúng là `{"status":"ok"}`.
- Đăng nhập Admin, thêm Vendor, thêm một lô còn hạn; dùng Customer thử đặt COD.
- Link chia sẻ là **Workers URL** vừa được cấp. Link GitHub Pages cũ không chạy backend này.
- Khi thay mã, chạy `npm run cf:deploy` lại. Nếu có migration mới, chạy `npm run cf:migrate` trước.
- Không chạy `cf:db:create` hoặc đổi AUTH_SECRET mỗi lần deploy. Database D1 được giữ nguyên.
- Sao lưu D1 bằng chức năng export/Time Travel của Cloudflare; không upload bản sao dữ liệu khách hàng lên repository.

Không cần tạo dịch vụ Render. Blueprint Render cũ được chuyển vào `deploy/render.paid.yaml`, chỉ là lựa chọn trả phí dự phòng. Nếu trước đó bạn đã tự tạo dịch vụ Render trả phí, dừng/xóa dịch vụ trong Render sau khi kiểm tra và chuyển dữ liệu cần giữ; sửa repository không tự hủy phí dịch vụ đã tạo.

## 8. Kiểm thử Cloudflare cục bộ

```powershell
npm run cf:secret -- --local
npm run cf:migrate:local
npm run cf:admin -- --local
npm run cf:dev
```

Mở `http://localhost:8787`. D1 local lưu trong `.wrangler/` (Git bỏ qua), độc lập D1 online. `--local` không gọi database/secret online.

Kiểm thử tự động:

```powershell
npm test
npm run test:cf
```

Bộ `test:cf` bundle Worker và chạy trên **workerd + D1 local qua Miniflare**, không cần đăng nhập Cloudflare và không ghi database online. Có kiểm tra RBAC, KDF/credential, giảm giá, checkout nguyên tử, tranh chấp tồn kho, đặt lặp, nhận đơn đồng thời, doanh thu, đánh giá và giới hạn đăng nhập.

## 9. Kiến trúc và giới hạn thực tế

```text
Browser — React static assets
   |
   | /api, cùng origin HTTPS
   v
Cloudflare Worker — Hono, session, RBAC, validation
   |
   v
D1 — SQLite, schema và dữ liệu bền vững
```

`cloudflare/migrations/0001_market.sql` chứa schema D1, giữ bảng inventory với `expiry_date`. D1 hỗ trợ SQLite SQL nhưng không hỗ trợ API đồng bộ/transaction callback của better-sqlite3.

Checkout dùng `DB.batch()` (giao dịch D1) và bảng `operation_guards`: nếu giá, cart, tồn kho, hạn hoặc quyền thay đổi giữa lần đọc và ghi, một CHECK thất bại làm rollback toàn bộ batch. Chỉ hoàn kho một lần khi hủy. Mỗi checkout dùng số truy vấn cố định, không chạy một query cho từng sản phẩm trong giỏ. Chuyển trạng thái đơn có guard chống hai Shipper nhận cùng đơn và chống hoàn kho hai lần. D1 cũng chặn hoàn tất giao hàng nếu hàng đã hết hạn. [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Để không chạy password KDF nặng trong CPU 10 ms của Workers Free, browser dùng Web Crypto **PBKDF2-HMAC-SHA256, 600.000 vòng** với salt theo email đã chuẩn hóa. Giá trị dẫn xuất chỉ gửi qua HTTPS, không lưu ở localStorage. Worker lưu verifier HMAC có salt ngẫu nhiên và pepper AUTH_SECRET. Credential dẫn xuất là tương đương mật khẩu: không log, không chia sẻ. Backend Express local vẫn dùng scrypt; tài khoản giữa hai backend không tự tương thích. Đây không phải giao thức PAKE; HTTPS là bắt buộc trên bản online.

Session dùng token ngẫu nhiên, DB chỉ lưu hash, cookie HttpOnly/SameSite và Secure trên HTTPS. Cloudflare đảm nhiệm TLS và cung cấp IP cho giới hạn 40 lần đăng nhập/đăng ký trong mỗi cửa sổ 15 phút. Admin không có đường dẫn khởi tạo công khai; thao tác khởi tạo dùng Wrangler đã đăng nhập.

## 10. Khắc phục lỗi

| Lỗi                                             | Cách xử lý                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Wrangler requires Node.js >=22`                | Cập nhật Node, mở terminal mới, chạy `npm ci`                                       |
| Database ID vẫn toàn số 0                       | Chạy `cf:db:create` hoặc điền ID database đã có vào `wrangler.jsonc`                |
| `no such table`                                 | Chạy `npm run cf:migrate` cho online hoặc `cf:migrate:local` cho local              |
| Trang chủ được nhưng đăng nhập báo lỗi server   | Chạy `npm run cf:secret`; xem log Worker, kiểm tra AUTH_SECRET                      |
| Đăng nhập sai sau khi thay máy/đổi secret       | Khôi phục đúng AUTH_SECRET đã dùng tạo tài khoản; không tạo khóa mới                |
| Email/mật khẩu đúng trên local nhưng sai online | D1 online là database riêng; dùng Admin đã tạo bằng `cf:admin`                      |
| Trang hiển thị nhưng chưa có sản phẩm           | Thêm nhà cung cấp/sản phẩm bằng tài khoản Admin; demo local không được copy tự động |
| HTTP 429                                        | Đợi giới hạn đăng nhập hết hạn; kiểm tra lượng yêu cầu                              |
| D1 quota/Worker CPU limit                       | Kiểm tra Usage, giảm tải và truy vấn; không bật Paid nếu muốn giữ chi phí 0         |
| Vẫn thấy trang trắng GitHub Pages               | Mở đúng URL `workers.dev`, không dùng URL `github.io` cũ                            |

Các bước tạo resource và deploy online do bạn thực hiện trong tài khoản Cloudflare của mình. Repository chỉ cung cấp cấu hình và công cụ, chưa liên kết với một tài khoản Cloudflare cụ thể.
