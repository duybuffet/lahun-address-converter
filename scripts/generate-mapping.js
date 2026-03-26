/**
 * generate-mapping.js  v6
 *
 * Generates province-level mapping: old province (63) → new province (34)
 *
 * Strategy:
 *   1. Load old provinces from provinces.open-api.vn
 *   2. Load new provinces from tinhthanhpho.com
 *   3. For each old province, pick a sample ward and call merge-history
 *      to find which new province it maps to
 *
 * Output: { "ha noi": { "province_old": "Thành phố Hà Nội", "province_new": "Hà Nội" }, ... }
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY  = process.env.API_KEY || '';
const OUT_FILE = path.join(__dirname, '..', 'data', 'mapping.json');
const DELAY_MS = 100;

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

// ── STEP 1: Load new province code → name map ────────────────────

async function loadNewProvinceCodeMap() {
  console.log('📡 Tải danh sách tỉnh/thành mới từ tinhthanhpho.com...');
  const codeMap = {}; // "01" → "Hà Nội"
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
  console.log(`   ✅ ${Object.keys(codeMap).length} tỉnh/thành\n`);
  return codeMap;
}

// ── STEP 2: Load old provinces + sample ward codes ────────────────

async function loadOldProvinces() {
  console.log('📡 Tải danh sách tỉnh/thành CŨ từ provinces.open-api.vn...');
  const res = await open('/api/?depth=3');
  if (!Array.isArray(res.body)) throw new Error('provinces.open-api.vn error');

  const provinces = [];
  for (const prov of res.body) {
    // Collect a few sample ward codes to probe merge-history
    const sampleWardCodes = [];
    for (const dist of (prov.districts || [])) {
      for (const w of (dist.wards || [])) {
        sampleWardCodes.push(String(w.code).padStart(5, '0'));
        if (sampleWardCodes.length >= 3) break;
      }
      if (sampleWardCodes.length >= 3) break;
    }
    provinces.push({
      name: prov.name,
      sampleWardCodes,
    });
  }
  console.log(`   ✅ ${provinces.length} tỉnh/thành cũ\n`);
  return provinces;
}

// ── STEP 3: Build province mapping ────────────────────────────────

async function buildMapping(oldProvinces, newProvCodeMap) {
  console.log(`⚙️  Building province mapping — ${oldProvinces.length} tỉnh...\n`);

  const mapping = {};
  let mapped = 0, unchanged = 0, failed = 0;

  for (const prov of oldProvinces) {
    let newProvName = null;

    // Try sample ward codes to find new province
    for (const code of prov.sampleWardCodes) {
      await sleep(DELAY_MS);
      try {
        const res = await api(`/api/v1/merge-history/ward/${code}`);
        if (res.status === 429) { await sleep(5000); continue; }

        const data = res.body?.data;
        const records = Array.isArray(data) ? data : (data ? [data] : []);

        if (records.length > 0) {
          const nw = records[0].new_ward;
          const provCode = nw?.province_code;
          if (provCode && newProvCodeMap[String(provCode)]) {
            newProvName = newProvCodeMap[String(provCode)];
            break;
          }
        }
      } catch (_) {}
    }

    const key = normProv(prov.name);

    if (newProvName && normProv(newProvName) !== normProv(prov.name)) {
      mapping[key] = { province_old: prov.name, province_new: newProvName };
      mapped++;
      console.log(`  ✅ ${prov.name} → ${newProvName}`);
    } else if (newProvName) {
      mapping[key] = { province_old: prov.name, province_new: newProvName };
      unchanged++;
      console.log(`  = ${prov.name} → ${newProvName} (unchanged)`);
    } else {
      // Fallback: keep same name
      mapping[key] = { province_old: prov.name, province_new: prov.name };
      failed++;
      console.log(`  ❌ ${prov.name} → không tìm được (giữ nguyên)`);
    }
  }

  console.log(`\n   ✅ mapped:${mapped} | unchanged:${unchanged} | errors:${failed}\n`);
  return mapping;
}

// ── MAIN ─────────────────────────────────────────────────────────

async function main() {
  console.log('🗺️  generate-mapping.js v6 (province: old → new)\n' + '─'.repeat(50) + '\n');
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  // Quick sanity check
  const probe = await api('/api/v1/merge-history/ward/00001');
  if (probe.status !== 200) {
    console.error('❌ API key sai hoặc hết hạn. Status:', probe.status);
    process.exit(1);
  }
  console.log('✅ API OK\n');

  const newProvCodeMap = await loadNewProvinceCodeMap();
  const oldProvinces   = await loadOldProvinces();
  const mapping        = await buildMapping(oldProvinces, newProvCodeMap);

  // Write
  const count = Object.keys(mapping).length;
  const json  = JSON.stringify(mapping, null, 2);
  fs.writeFileSync(OUT_FILE, json, 'utf8');

  console.log('─'.repeat(50));
  console.log(`✅ ${count} entries → ${OUT_FILE}`);
  console.log(`   Size: ${(json.length / 1024).toFixed(1)} KB\n`);
}

main().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1); });
