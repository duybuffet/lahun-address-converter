/**
 * generate-mapping.js  v4
 * 
 * API structure confirmed:
 *   merge-history/ward/{old_code} → {
 *     old_ward: { code, name, type, ... }
 *     new_ward: { code:"00097", name:"Hồng Hà", type:"Phường", province_code:"01" }
 *   }
 * 
 * province_code "01" → cần map sang tên tỉnh mới
 * Lấy province list từ tinhthanhpho.com /api/v1/provinces
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY  = process.env.API_KEY || '';
const OUT_FILE = path.join(__dirname, '..', 'data', 'mapping.json');
const DELAY_MS = 80;

if (!API_KEY) {
  console.error('❌  Cần: API_KEY=your_key node scripts/generate-mapping.js');
  process.exit(1);
}

// ── HTTP ─────────────────────────────────────────────────────────

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json', ...headers }, timeout: 20000 }, res => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location)
        return get(res.headers.location, headers).then(resolve).catch(reject);
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: null, raw: d.slice(0, 300) }); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

const api  = p => get(`https://tinhthanhpho.com${p}`, { Authorization: `Bearer ${API_KEY}` });
const open = p => get(`https://provinces.open-api.vn${p}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Normalize ─────────────────────────────────────────────────────

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
const normProv = s => norm(s || '').replace(/^(tinh|thanh pho|tp\.?)\s+/, '').trim();

function guessType(name) {
  const n = norm(name || '');
  if (/^phuong\b/.test(n)) return 'Phường';
  if (/^thi tran\b/.test(n)) return 'Thị trấn';
  return 'Xã';
}

// ── STEP 1: Load province code → name map from tinhthanhpho ───────

async function loadProvinceCodeMap() {
  console.log('📡 Tải danh sách tỉnh/thành mới (34 tỉnh)...');
  // Fetch all pages
  const codeMap = {}; // "01" → "Thành phố Hà Nội"
  let page = 1;
  while (true) {
    const res = await api(`/api/v1/provinces?limit=100&page=${page}`);
    const rows = res.body?.data || [];
    if (rows.length === 0) break;
    for (const p of rows) {
      codeMap[String(p.code)] = p.name;
    }
    if (rows.length < 100) break;
    page++;
    await sleep(200);
  }
  const count = Object.keys(codeMap).length;
  console.log(`   ✅ ${count} tỉnh/thành: ${Object.values(codeMap).slice(0,5).join(', ')}...\n`);
  return codeMap;
}

// ── STEP 2: Load all old wards from provinces.open-api.vn ─────────

async function loadOldWards() {
  console.log('📡 Tải toàn bộ phường/xã CŨ từ provinces.open-api.vn...');
  const res = await open('/api/?depth=3');
  if (!Array.isArray(res.body)) throw new Error('provinces.open-api.vn error: ' + JSON.stringify(res).slice(0,200));

  const wards = [];
  for (const prov of res.body) {
    for (const dist of (prov.districts || [])) {
      for (const w of (dist.wards || [])) {
        wards.push({
          code:     String(w.code).padStart(5, '0'),
          name:     w.name,
          type:     w.ward_type || guessType(w.name),
          district: dist.name,
          province: prov.name,
        });
      }
    }
  }
  console.log(`   ✅ ${wards.length.toLocaleString('vi')} phường/xã cũ\n`);
  return wards;
}

// ── STEP 3: Build mapping ─────────────────────────────────────────

async function buildMapping(wards, provCodeMap) {
  console.log(`⚙️  Building mapping — ${wards.length.toLocaleString()} wards...\n`);

  const mapping = {};
  let merged = 0, unchanged = 0, failed = 0;

  function add(newWardName, newProvName, oldWard) {
    const key = `${norm(newWardName)}|${normProv(newProvName)}`;
    if (!mapping[key]) {
      mapping[key] = {
        ward_new:     newWardName,
        type_new:     guessType(newWardName),
        province_new: newProvName,
        sources: [],
      };
    }
    const dup = mapping[key].sources.some(
      s => s.ward === oldWard.name && s.district === (oldWard.district || '')
    );
    if (!dup) {
      mapping[key].sources.push({
        ward:      oldWard.name,
        ward_type: oldWard.type || guessType(oldWard.name),
        district:  oldWard.district || '',
        province:  oldWard.province || newProvName,
      });
    }
  }

  for (let i = 0; i < wards.length; i++) {
    const ward = wards[i];

    // Progress line
    if (i % 100 === 0 || i === wards.length - 1) {
      const pct = ((i / wards.length) * 100).toFixed(1);
      const remaining = wards.length - i;
      const etaMin = Math.ceil((remaining * DELAY_MS) / 60000);
      process.stdout.write(
        `\r   [${i.toLocaleString()}/${wards.length.toLocaleString()}] ${pct}%` +
        ` | merged:${merged} unchanged:${unchanged} err:${failed} | ETA:${etaMin}m   `
      );
    }

    await sleep(DELAY_MS);

    let retries = 3;
    while (retries-- > 0) {
      try {
        const res = await api(`/api/v1/merge-history/ward/${ward.code}`);

        if (res.status === 429) {
          await sleep(5000); continue; // rate limit, retry
        }

        const data    = res.body?.data;
        const records = Array.isArray(data) ? data : (data ? [data] : []);

        if (records.length === 0) {
          // Ward unchanged
          add(ward.name, ward.province, ward);
          unchanged++;
          break;
        }

        for (const rec of records) {
          // new_ward: { code, name, type, province_code }
          const nw   = rec.new_ward;
          const nwName = nw?.name;
          const nwProvCode = nw?.province_code;
          const nwProvName = nwProvCode ? (provCodeMap[String(nwProvCode)] || ward.province) : ward.province;

          if (nwName) {
            add(nwName, nwProvName, ward);
            merged++;
          } else {
            // Fallback: unchanged
            add(ward.name, ward.province, ward);
            unchanged++;
          }
        }
        break; // success

      } catch (e) {
        if (retries === 0) {
          failed++;
          add(ward.name, ward.province, ward); // identity fallback
        } else {
          await sleep(500);
        }
      }
    }
  }

  console.log(`\n\n   ✅ merged:${merged} | unchanged:${unchanged} | errors:${failed}\n`);
  return mapping;
}

// ── MAIN ─────────────────────────────────────────────────────────

async function main() {
  console.log('🗺️  generate-mapping.js v4\n' + '─'.repeat(50) + '\n');
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  // Quick sanity check
  const probe = await api('/api/v1/merge-history/ward/00001');
  if (probe.status !== 200) {
    console.error('❌ API key sai hoặc hết hạn. Status:', probe.status);
    process.exit(1);
  }
  const rec0 = probe.body?.data?.[0];
  console.log('✅ API OK — sample new_ward:', JSON.stringify(rec0?.new_ward || null));
  console.log();

  const provCodeMap = await loadProvinceCodeMap();
  const wards       = await loadOldWards();
  const mapping     = await buildMapping(wards, provCodeMap);

  // Write
  const count = Object.keys(mapping).length;
  const json  = JSON.stringify(mapping, null, 2);
  fs.writeFileSync(OUT_FILE, json, 'utf8');

  console.log('─'.repeat(50));
  console.log(`✅ ${count.toLocaleString('vi')} entries → ${OUT_FILE}`);
  console.log(`   Size: ${(json.length / 1024).toFixed(0)} KB\n`);

  // Show sample with multiple sources
  const multi = Object.entries(mapping).filter(([,v]) => v.sources.length > 1).slice(0, 5);
  if (multi.length) {
    console.log('Sample (gộp nhiều xã cũ):');
    multi.forEach(([k, v]) => {
      console.log(`  ${v.ward_new} (${v.province_new})`);
      console.log(`    ← ${v.sources.map(s => s.ward + '/' + s.district).join(' | ')}`);
    });
  }
}

main().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1); });
