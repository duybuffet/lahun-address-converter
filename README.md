# 🏠 Address Converter VN 2025
> Chuyển đổi địa chỉ **mới (sau sáp nhập)** → **cũ (trước sáp nhập)** cho toàn bộ 34 tỉnh Việt Nam

---

## Cấu trúc project

```
address-converter/
├── index.html              ← Tool chính (single HTML file)
├── data/
│   └── mapping.json        ← Dữ liệu mapping 3,321 phường/xã mới → cũ
├── scripts/
│   └── generate-mapping.js ← Script sinh mapping.json từ API
└── README.md
```

---

## Bước 1: Sinh file data/mapping.json (QUAN TRỌNG)

File `data/mapping.json` hiện tại chỉ là **sample**. Cần chạy script để lấy full data.

### Option A — Dùng tinhthanhpho.com API (recommended)

```bash
# 1. Đăng ký tại https://tinhthanhpho.com → lấy API key

# 2. Cài Node.js nếu chưa có: https://nodejs.org

# 3. Chạy script
API_KEY=your_api_key_here node scripts/generate-mapping.js

# 4. File data/mapping.json sẽ được tạo (~2-4 MB, ~3,321 entries)
```

### Option B — Dùng VietMap open data (không cần API key)

```bash
# Clone repo của VietMap
git clone https://github.com/vietmap-company/vietnam_administrative_address

# Chạy script convert format
node scripts/convert-vietmap.js  # (tạo thêm file này nếu cần)
```

### Option C — Dùng tinhthanhpho.com bulk export

Truy cập https://tinhthanhpho.com → Export → Download toàn bộ dữ liệu mapping dạng JSON,
sau đó chạy script transform về format của project này.

---

## Bước 2: Deploy lên GitHub Pages

```bash
# 1. Tạo repo trên GitHub (ví dụ: username/address-converter)

# 2. Push code lên
git init
git add .
git commit -m "init address converter"
git remote add origin https://github.com/YOUR_USERNAME/address-converter.git
git push -u origin main

# 3. Vào GitHub → Settings → Pages
#    Source: Deploy from a branch → main → / (root)
#    → Save

# 4. Truy cập: https://YOUR_USERNAME.github.io/address-converter/
```

> ⚠️ **Lưu ý:** GitHub Pages chỉ serve static files. File `mapping.json` sẽ được
> fetch qua đường dẫn `./data/mapping.json` từ `index.html`. Đảm bảo file này
> đã được commit vào repo.

---

## Format mapping.json

```json
{
  "tran nguyen han|hai phong": {
    "ward_new": "Trần Nguyên Hãn",
    "type_new": "Phường",
    "province_new": "Thành phố Hải Phòng",
    "sources": [
      {
        "ward":      "Trần Nguyên Hãn",
        "ward_type": "Phường",
        "district":  "Quận Lê Chân",
        "province":  "Thành phố Hải Phòng"
      },
      {
        "ward":      "Hồ Nam",
        "ward_type": "Phường",
        "district":  "Quận Lê Chân",
        "province":  "Thành phố Hải Phòng"
      }
    ]
  }
}
```

**Key format:** `normalize(ward_name)|normalize(province_name)`
- normalize = bỏ dấu + lowercase + bỏ ký tự đặc biệt
- Ví dụ: `"Trần Nguyên Hãn"` + `"Thành phố Hải Phòng"` → key = `"tran nguyen han|hai phong"`

---

## Logic address parsing

Tool tự động tách phường/xã từ chuỗi địa chỉ tự do:

| Input address | Ward detected |
|---|---|
| `Số 83 Trần Nguyên Hãn phường Trần Nguyên Hãn Thành phố Hải Phòng` | `Phường Trần Nguyên Hãn` |
| `123 Lê Lợi, Phường Bến Nghé, Quận 1` | `Phường Bến Nghé` |
| `Xã Tân Hưng, Huyện Vĩnh Hưng, Long An` | `Xã Tân Hưng` |

---

## Xử lý trường hợp 1 phường mới = nhiều phường cũ

Khi nhiều phường cũ gộp thành 1 phường mới (ví dụ: Trần Nguyên Hãn = Trần Nguyên Hãn + Hồ Nam + Dư Hàng),
tool sẽ trả về **phường cũ đầu tiên trong danh sách** (`sources[0]`) làm old_address,
và đánh dấu `⚠️ N nguồn gộp` trong cột `convert_status`.

Để chính xác hơn, cần thêm logic so sánh số nhà / tọa độ GPS — hiện tại nằm ngoài phạm vi tool này.

---

## Nguồn dữ liệu

- [Nghị quyết 202/2025/QH15](https://chinhphu.vn) — sáp nhập 63→34 tỉnh
- [Nghị quyết 76/2025/UBTVQH15](https://chinhphu.vn) — sắp xếp cấp huyện, xã
- [tinhthanhpho.com API](https://tinhthanhpho.com/api-docs) — free API có mapping data
- [VietMap GitHub](https://github.com/vietmap-company/vietnam_administrative_address) — open data JSON
