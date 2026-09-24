import { createHash } from 'node:crypto';
import readXlsxFile from 'read-excel-file/node';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const ALIASES = Object.freeze({
  phone: ['phone', 'phone_number', 'mobile', 'رقم', 'الجوال', 'رقم الجوال'],
  displayName: ['name', 'display_name', 'الاسم', 'اسم العميل'],
  consentStatus: ['consent', 'consent_status', 'marketing_consent', 'الموافقة', 'موافقة تسويقية'],
  consentSource: ['consent_source', 'source', 'مصدر الموافقة'],
  consentAt: ['consent_at', 'consent_timestamp', 'timestamp', 'تاريخ الموافقة'],
  consentEvidence: ['consent_evidence', 'evidence', 'دليل الموافقة'],
});

function splitCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); if (row.some((value) => value.trim())) rows.push(row); row = []; field = '';
    } else field += char;
  }
  row.push(field); if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error('Malformed CSV');
  return rows;
}

function mapRows(matrix) {
  if (matrix.length < 2) return [];
  const headers = matrix[0].map((value) => String(value ?? '').trim().toLowerCase());
  const indexes = Object.fromEntries(Object.entries(ALIASES).map(([key, aliases]) =>
    [key, headers.findIndex((header) => aliases.includes(header))]));
  if (indexes.phone < 0) throw new Error('Missing phone column');
  return matrix.slice(1).map((values) => Object.fromEntries(Object.entries(indexes)
    .map(([key, index]) => [key, index < 0 ? '' : values[index] ?? ''])));
}

export async function parseCustomerImport({ filename, base64 }) {
  const safeName = String(filename || '').replace(/[^\p{L}\p{N}_. -]/gu, '').slice(0, 120);
  if (!safeName || typeof base64 !== 'string') throw new Error('Invalid import file');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_IMPORT_BYTES) throw new Error('Invalid import size');
  let matrix;
  if (/\.csv$/i.test(safeName)) matrix = splitCsv(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  else if (/\.xlsx$/i.test(safeName)) {
    matrix = (await readXlsxFile(buffer)).map((row) => row.map((value) =>
      value instanceof Date ? value.toISOString() : value ?? ''));
    if (!matrix.length) throw new Error('Empty workbook');
  } else throw new Error('Only CSV and XLSX are supported');
  return { filename: safeName, fileSha256: createHash('sha256').update(buffer).digest('hex'), rows: mapRows(matrix) };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) return null; chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

export async function handleCampaignApi({ req, res, store, kapsoClient, businessAccountId, planLimit = 2000 }) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (!store) { json(res, 503, { error: 'Campaign database unavailable' }); return; }
  try {
    if (req.method === 'GET' && pathname === '/admin/campaigns/api/summary') {
      json(res, 200, { ...(await store.dashboard()), kapso: { plan: 'Free', monthlyLimit: planLimit,
        used: null, remaining: null, availableCreditUsd: null,
        note: 'لا توفر واجهة Kapso العامة المستخدمة قيمة الرصيد أو الاستهلاك الحالي؛ راجع لوحة Kapso.' } }); return;
    }
    if (req.method === 'POST' && pathname === '/admin/campaigns/api/imports/preview') {
      const body = await bodyJson(req); if (!body) { json(res, 400, { error: 'Invalid request' }); return; }
      const parsed = await parseCustomerImport(body);
      const preview = store.prepareRows(parsed.rows);
      json(res, 200, { filename: parsed.filename, fileSha256: parsed.fileSha256,
        totalRows: preview.totalRows, acceptedRows: preview.accepted.length,
        rejectedRows: preview.rejected.length, duplicateRows: preview.duplicateRows,
        rejectionReasons: Object.fromEntries([...new Set(preview.rejected.map((item) => item.reason))]
          .map((reason) => [reason, preview.rejected.filter((item) => item.reason === reason).length])) }); return;
    }
    if (req.method === 'POST' && pathname === '/admin/campaigns/api/imports/commit') {
      const body = await bodyJson(req); if (!body?.confirmed) { json(res, 400, { error: 'Import confirmation required' }); return; }
      const parsed = await parseCustomerImport(body);
      if (parsed.fileSha256 !== body.expectedSha256) { json(res, 409, { error: 'File changed after review' }); return; }
      json(res, 201, await store.importRows(parsed)); return;
    }
    if (req.method === 'POST' && pathname === '/admin/campaigns/api/templates/sync') {
      const templates = await kapsoClient.listApprovedMarketingTemplates({ businessAccountId });
      json(res, 200, await store.syncTemplates(templates)); return;
    }
    if (req.method === 'POST' && pathname === '/admin/campaigns/api/suppressions') {
      const body = await bodyJson(req); if (!body) { json(res, 400, { error: 'Invalid request' }); return; }
      json(res, 201, await store.suppress(body)); return;
    }
    if (req.method === 'POST' && pathname === '/admin/campaigns/api/campaigns') {
      const body = await bodyJson(req); if (!body) { json(res, 400, { error: 'Invalid request' }); return; }
      json(res, 201, await store.createCampaign(body)); return;
    }
    const match = pathname.match(/^\/admin\/campaigns\/api\/campaigns\/([a-f0-9-]{36})\/(approve|schedule)$/i);
    if (req.method === 'POST' && match) {
      if (match[2] === 'approve') json(res, 200, await store.approveCampaign(match[1]));
      else { const body = await bodyJson(req); json(res, 200, await store.scheduleCampaign(match[1], body?.scheduledAt)); }
      return;
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    const safe = ['Invalid', 'Missing', 'Only', 'Empty', 'Malformed', 'Approved', 'Campaign', 'Kapso']
      .some((prefix) => error.message.startsWith(prefix)) ? error.message : 'Operation failed';
    json(res, 400, { error: safe, code: error.code ?? null });
  }
}

export function campaignDashboardHtml() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mozzaro WhatsApp Campaigns</title><style>
  :root{font-family:system-ui;background:#f5f2eb;color:#211b16}body{margin:0}.wrap{max-width:1050px;margin:auto;padding:28px}h1{margin:0 0 4px}.note{color:#685f55}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.card{background:#fff;border:1px solid #ddd3c7;border-radius:14px;padding:16px;margin:14px 0}.metric{font-size:26px;font-weight:700}label{display:block;margin-top:9px}input,select,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #bcb1a4}input,select{width:100%;box-sizing:border-box}button{background:#6f1d1b;color:white;cursor:pointer;margin-top:10px}button.secondary{background:#fff;color:#6f1d1b}table{width:100%;border-collapse:collapse}th,td{text-align:right;padding:8px;border-bottom:1px solid #eee}.danger{color:#9b1c1c}.ok{color:#14743c}code{direction:ltr}#app{display:none}</style></head><body><main class="wrap">
  <h1>Mozzaro WhatsApp Campaigns</h1><p class="note">مرحلة الإعداد فقط — الإرسال التسويقي معطّل تقنيًا.</p>
  <section id="login" class="card"><label>رمز إدارة موزارو<input id="token" type="password" autocomplete="current-password"></label><button id="loginButton">دخول آمن</button><p id="loginError" class="danger"></p></section>
  <div id="app"><section class="grid"><div class="card"><div>جهات مؤهلة</div><div id="eligible" class="metric">—</div></div><div class="card"><div>قائمة الحظر</div><div id="suppressed" class="metric">—</div></div><div class="card"><div>القوالب المعتمدة</div><div id="templatesCount" class="metric">—</div></div><div class="card"><div>الإرسال</div><div class="metric danger">معطّل</div></div></section>
  <section class="card"><h2>استيراد العملاء</h2><p>الأعمدة المطلوبة: phone, consent_status, consent_source, consent_at, consent_evidence. تُقبل CSV وXLSX فقط.</p><input id="file" type="file" accept=".csv,.xlsx"><button id="preview">مراجعة الملف</button><button id="commit" disabled>اعتماد الاستيراد</button><pre id="importResult"></pre></section>
  <section class="card"><h2>القوالب</h2><button id="sync">مزامنة القوالب المعتمدة من Kapso</button><table><thead><tr><th>الاسم</th><th>اللغة</th><th>الحالة</th></tr></thead><tbody id="templates"></tbody></table></section>
  <section class="card"><h2>مسودة حملة</h2><label>اسم الحملة<input id="campaignName" maxlength="120"></label><label>القالب<select id="templateSelect"></select></label><button id="draft">إنشاء مسودة وتقدير التكلفة</button><p class="note">الموافقة والجدولة تحفظان في قاعدة البيانات فقط؛ لا يوجد مسار إرسال في هذه النسخة.</p></section>
  <section class="card"><h2>إيقاف التسويق لرقم</h2><label>رقم الجوال<input id="suppressPhone" inputmode="tel"></label><label>سبب الإيقاف<input id="suppressReason" maxlength="240"></label><button id="suppress">إضافة إلى قائمة الإيقاف الدائمة</button></section>
  <section class="card"><h2>الحملات</h2><table><thead><tr><th>الحملة</th><th>الحالة</th><th>المستلمون</th><th>التكلفة المقدّرة</th><th>إجراء</th></tr></thead><tbody id="campaigns"></tbody></table></section>
  <section class="card"><h2>Kapso</h2><p id="kapso"></p></section></div></main><script>
  let token='',lastFile=null,lastHash=null; const q=(s)=>document.querySelector(s);
  async function api(path,options={}){const r=await fetch('/admin/campaigns/api/'+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(options.headers||{})}});const b=await r.json().catch(()=>({error:'تعذر قراءة الرد'}));if(!r.ok)throw new Error(b.error||'فشلت العملية');return b}
  async function load(){const d=await api('summary');q('#eligible').textContent=d.eligibleContacts;q('#suppressed').textContent=d.suppressedContacts;q('#templatesCount').textContent=d.templates.length;q('#kapso').textContent='الخطة: '+d.kapso.plan+' — الحد الشهري: '+d.kapso.monthlyLimit+' رسالة. '+d.kapso.note;q('#templates').innerHTML=d.templates.map(t=>'<tr><td>'+esc(t.name)+'</td><td>'+esc(t.language)+'</td><td>'+esc(t.status)+'</td></tr>').join('');q('#templateSelect').innerHTML=d.templates.filter(t=>t.status==='APPROVED').map(t=>'<option value="'+esc(t.template_id)+'">'+esc(t.name)+' — '+esc(t.language)+'</option>').join('');q('#campaigns').innerHTML=d.campaigns.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(c.status)+'</td><td>'+c.eligible_recipient_count+'</td><td>$'+Number(c.estimated_cost_usd).toFixed(2)+'</td><td>'+(c.status==='draft'?'<button onclick="approve(\''+c.campaign_id+'\')">موافقة المالك</button>':c.status==='approved'?'<button onclick="scheduleCampaign(\''+c.campaign_id+'\')">جدولة معطّلة الإرسال</button>':'—')+'</td></tr>').join('')}
  function esc(v){const e=document.createElement('span');e.textContent=String(v??'');return e.innerHTML}async function fileBody(){const f=q('#file').files[0];if(!f)throw new Error('اختر ملفًا');const a=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return{filename:f.name,base64:btoa(s)}}
  q('#loginButton').onclick=async()=>{token=q('#token').value;try{await load();q('#login').style.display='none';q('#app').style.display='block';q('#token').value=''}catch(e){token='';q('#loginError').textContent='تعذر الدخول'}};
  q('#preview').onclick=async()=>{try{lastFile=await fileBody();const d=await api('imports/preview',{method:'POST',body:JSON.stringify(lastFile)});lastHash=d.fileSha256;q('#commit').disabled=false;q('#importResult').textContent=JSON.stringify(d,null,2)}catch(e){q('#importResult').textContent=e.message}};
  q('#commit').onclick=async()=>{try{const d=await api('imports/commit',{method:'POST',body:JSON.stringify({...lastFile,expectedSha256:lastHash,confirmed:true})});q('#importResult').textContent=JSON.stringify(d,null,2);q('#commit').disabled=true;await load()}catch(e){q('#importResult').textContent=e.message}};
  q('#sync').onclick=async()=>{try{await api('templates/sync',{method:'POST'});await load()}catch(e){alert(e.message)}};
  q('#draft').onclick=async()=>{try{await api('campaigns',{method:'POST',body:JSON.stringify({name:q('#campaignName').value,templateId:q('#templateSelect').value})});await load()}catch(e){alert(e.message)}};
  q('#suppress').onclick=async()=>{if(!confirm('سيبقى هذا الرقم محظورًا من الحملات. متابعة؟'))return;try{await api('suppressions',{method:'POST',body:JSON.stringify({phone:q('#suppressPhone').value,reason:q('#suppressReason').value,source:'owner_dashboard'})});await load()}catch(e){alert(e.message)}};
  window.approve=async(id)=>{if(!confirm('تسجيل موافقة المالك على هذه المسودة؟ الإرسال سيبقى معطّلًا.'))return;try{await api('campaigns/'+id+'/approve',{method:'POST'});await load()}catch(e){alert(e.message)}};
  window.scheduleCampaign=async(id)=>{const scheduledAt=prompt('أدخل الموعد بصيغة ISO، مثال: 2026-10-01T18:00:00+03:00');if(!scheduledAt)return;try{await api('campaigns/'+id+'/schedule',{method:'POST',body:JSON.stringify({scheduledAt})});await load()}catch(e){alert(e.message)}};
  </script></body></html>`;
}
