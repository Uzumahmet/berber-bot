require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const WhatsAppClient = require('./baileys-client');
const ReminderService = require('./reminder-service');
const RealtimeListener = require('./realtime-listener');

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rkqrlhkdcgspxpgywvtq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrcXJsaGtkY2dzcHhwZ3l3dnRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MDk1NzksImV4cCI6MjEwNDA4NTU3OX0.7M-fQC6zQSNZsrmDEu7dh6kApxpn9aHnCRbCZtXoh18';
const SESSION_ID = process.env.SESSION_ID || 'berber_main';
const AUTH_DIR = process.env.AUTH_DIR || './auth_info';

// 1. Supabase İstemcisi
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. WhatsApp İstemcisi
const wa = new WhatsAppClient({
  supabase,
  sessionId: SESSION_ID,
  authDir: AUTH_DIR
});

// 3. Hatırlatıcı & Realtime Servisleri
const reminderService = new ReminderService(supabase, wa);
const realtimeListener = new RealtimeListener(supabase, wa);

// 4. Express Sunucusu
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ─────────────────────────────────────────────
   API ENDPOINT'LERİ
   ───────────────────────────────────────────── */

// Sağlık kontrolü
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    whatsapp: wa.getStatus()
  });
});

// Durum sorgusu (Admin paneli için)
app.get('/api/status', (req, res) => {
  res.json(wa.getStatus());
});

// 8 Haneli Eşleşme Kodu İsteği (Tek telefondan bağlantı için)
app.post('/api/pair', async (req, res) => {
  try {
    const phone = req.body.phone || process.env.DEFAULT_PHONE || '05524512619';
    const code = await wa.requestPairingCode(phone);
    res.json({ success: true, phone, code });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manuel mesaj gönderim API'si
app.post('/api/send', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ success: false, error: 'to ve message zorunludur.' });
    }
    const result = await wa.sendMessage(to, message);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Soketi zorla yenileme (Taze QR ve Eşleşme için)
app.post('/api/restart', async (req, res) => {
  try {
    await wa.restart();
    res.json({ success: true, message: 'Soket yeniden başlatıldı.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Oturumu tamamen sıfırlama (Temiz sıfırdan başlama)
app.post('/api/reset', async (req, res) => {
  try {
    await wa.clearAndReset();
    res.json({ success: true, message: 'Oturum sıfırlandı ve temiz soket başlatıldı.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Oturumu kapatma
app.post('/api/logout', async (req, res) => {
  try {
    await wa.logout();
    res.json({ success: true, message: 'Oturum kapatıldı.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// QR Kod JSON
app.get('/api/qr', (req, res) => {
  const status = wa.getStatus();
  res.json({
    connected: status.connected,
    qrImage: status.qrImage,
    pairingCode: status.pairingCode
  });
});

/* ─────────────────────────────────────────────
   KULLANICI DOSTU BAĞLANTI WEB ARAYÜZÜ (Mobil & Web)
   ───────────────────────────────────────────── */
app.get('/', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  const status = wa.getStatus();
  const defaultPhone = process.env.DEFAULT_PHONE || '05422628830';

  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Berber-X | WhatsApp Bot Yönetimi</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card: #151d2f;
      --primary: #25d366;
      --primary-hover: #20ba59;
      --text: #ffffff;
      --text-muted: #94a3b8;
      --border: #1e293b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; width: 100%; max-width: 480px; padding: 28px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: center; }
    .top-actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
    .btn-action { background: #1e293b; color: #cbd5e1; border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.2s; display: inline-flex; align-items: center; gap: 5px; }
    .btn-action:hover { background: #334155; color: #fff; }
    h1 { font-size: 20px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 10px; }
    p { font-size: 13.5px; color: var(--text-muted); line-height: 1.5; margin-bottom: 16px; }
    .status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 99px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    .status--connected { background: rgba(37, 211, 102, 0.15); color: #25d366; border: 1px solid rgba(37, 211, 102, 0.3); }
    .status--disconnected { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    .status--connecting { background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .input-group { margin-bottom: 14px; text-align: left; }
    label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
    input { width: 100%; background: #0b0f19; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; color: #fff; font-size: 15px; outline: none; }
    input:focus { border-color: var(--primary); }
    button.btn-main { width: 100%; background: var(--primary); color: #0b0f19; border: none; border-radius: 10px; padding: 13px; font-size: 15px; font-weight: 700; cursor: pointer; transition: 0.2s; }
    button.btn-main:hover { background: var(--primary-hover); }
    .btn-secondary { width: 100%; background: #1e293b; color: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 10px; transition: 0.2s; }
    .btn-secondary:hover { background: #334155; }
    .code-box { background: #0b0f19; border: 2px dashed var(--primary); border-radius: 12px; padding: 20px; text-align: center; margin: 16px 0; display: none; }
    .code-text { font-size: 32px; font-weight: 800; letter-spacing: 4px; color: var(--primary); font-family: monospace; }
    .steps { font-size: 13px; color: var(--text-muted); text-align: left; margin-top: 14px; line-height: 1.6; }
    .steps ol { padding-left: 18px; }
    .qr-container { text-align: center; margin: 16px 0; }
    .qr-container img { border-radius: 12px; border: 4px solid #fff; max-width: 220px; min-height: 180px; display: inline-block; background: #fff; }
    .toast-box { display:none; padding:12px 16px; border-radius:10px; font-size:13.5px; margin-bottom:16px; text-align:center; font-weight: 500; }
    .toast--err { background:rgba(239,68,68,0.15); color:#fca5a5; border:1px solid rgba(239,68,68,0.3); }
    .toast--suc { background:rgba(37,211,102,0.15); color:#86efac; border:1px solid rgba(37,211,102,0.3); }
    .toast--info { background:rgba(59,130,246,0.15); color:#93c5fd; border:1px solid rgba(59,130,246,0.3); }
  </style>
</head>
<body>
  <div class="card">
    <!-- Üst Kontrol & Zorla Yenileme Çubuğu -->
    <div class="top-actions">
      <button type="button" class="btn-action" onclick="forcePageReload()" title="Sayfayı Tarayıcı Önbelleğini Atlayarak Yeniler">
        🔄 Zorla Yenile
      </button>
      <button type="button" class="btn-action" onclick="forceResetSession()" title="Tüm bağlantı artıklarını temizler ve sıfırdan başlar" style="color: #f87171;">
        🧹 Sıfırla &amp; Temiz Başlat
      </button>
    </div>

    <h1>💈 Berber-X WhatsApp Asistanı</h1>
    <p>Dükkanda bilgisayar olmadan 7/24 otomatik randevu onayı ve hatırlatma gönderen bulut servisi.</p>

    <!-- Bildirim Kutusu (Sayfayı kilitlemeyen bildirimler) -->
    <div id="toastBox" class="toast-box"></div>

    <div id="statusBadge" class="status-badge ${status.connected ? 'status--connected' : (status.status === 'connecting' ? 'status--connecting' : 'status--disconnected')}">
      <span class="pulse"></span>
      <span id="statusText">
        ${status.connected ? '🟢 Bağlı: ' + (status.user?.phone || 'Aktif') : (status.status === 'connecting' ? '🟡 Bağlanıyor / QR Bekleniyor...' : '🔴 Bağlantı Yok')}
      </span>
    </div>

    ${status.connected ? `
      <div style="background: rgba(37,211,102,0.06); border: 1px solid rgba(37,211,102,0.2); border-radius: 12px; padding: 18px; margin-bottom: 16px;">
        <p style="margin: 0; color: #fff; font-size: 15px;">✅ <b>WhatsApp 7/24 Devrede!</b></p>
        <p style="margin: 8px 0 0; font-size: 13px; color: var(--text-muted);">Müşteriler randevu aldığında veya randevu saati yaklaştığında sistem bu telefondan otomatik WhatsApp mesajı gönderir.</p>
      </div>
      <button class="btn-secondary" onclick="logout()" style="color: #ef4444; border-color: rgba(239,68,68,0.3);">Bağlantıyı Kes / Çıkış Yap</button>
    ` : `
      <div class="qr-container" id="qrBox">
        <div style="display:flex; justify-content:center; align-items:center; gap:8px; margin-bottom:10px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#25d366;"></span>
          <b style="font-size:13px; color:#25d366;">Canlı QR Kod (Otomatik Güncellenir)</b>
        </div>
        
        <img id="qrImg" src="${status.qrImage || ''}" alt="QR Kod Bekleniyor..." />
        
        <div style="margin-top:10px; display:flex; justify-content:center; gap:8px;">
          <button type="button" id="refreshQrBtn" class="btn-action" onclick="manualRefreshQR()" style="padding:8px 16px; font-size:13px;">
            🔄 Taze QR Kod Üret
          </button>
        </div>
        <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">
          * WhatsApp &gt; Bağlı Cihazlar &gt; Cihaz Bağla diyerek kamerayı bu koda tutun.
        </p>
      </div>

      <div style="margin:18px 0 14px; border-top:1px solid var(--border); padding-top:14px;">
        <span style="font-size:12px; color:var(--text-muted); background:var(--card); padding:0 8px; font-weight: 600;">VEYA KOD İLE BAĞLAN</span>
      </div>

      <div class="input-group">
        <label>WhatsApp Telefon Numaranız</label>
        <input type="text" id="phoneInput" value="${defaultPhone}" placeholder="0542 262 88 30" />
      </div>
      <button id="pairBtn" class="btn-main" onclick="getPairingCode()">📲 8 Haneli Eşleşme Kodu Al</button>

      <div id="codeBox" class="code-box">
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">WHATSAPP EŞLEŞME KODU:</div>
        <div id="codeDisplay" class="code-text">----</div>
        <button type="button" class="btn-action" onclick="copyCode()" style="margin: 8px auto 0; display: inline-flex;">📋 Kodu Kopyala</button>
        <div class="steps">
          <b>Telefonundan Nasıl Bağlanırsın?</b>
          <ol>
            <li>Telefonunda WhatsApp'ı aç.</li>
            <li>Sağ üstteki <b>Üç Nokta</b> veya <b>Ayarlar</b>'a dokun.</li>
            <li><b>Bağlı Cihazlar</b> &gt; <b>Cihaz Bağla</b>'ya bas.</li>
            <li>Alttaki <b>"Telefon numarası ile bağla"</b> yazısına dokun.</li>
            <li>Yukarıdaki 8 haneli kodu telefonuna gir.</li>
          </ol>
        </div>
      </div>
    `}
  </div>

  <script>
    function showToast(msg, type = 'err') {
      const t = document.getElementById('toastBox');
      if (!t) return;
      t.className = 'toast-box ' + (type === 'suc' ? 'toast--suc' : (type === 'info' ? 'toast--info' : 'toast--err'));
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 7000);
    }

    function forcePageReload() {
      showToast('Sayfa zorla yenileniyor...', 'info');
      const cleanUrl = window.location.origin + window.location.pathname + '?v=' + Date.now();
      window.location.replace(cleanUrl);
    }

    async function forceResetSession() {
      const btn = event.target;
      if (btn) btn.innerText = 'Sıfırlanıyor...';
      showToast('Bağlantı oturumu sıfırlanıyor, lütfen bekleyin...', 'info');
      try {
        const res = await fetch('/api/reset', { method: 'POST' });
        const data = await res.json();
        showToast('Sıfırlandı! Yeni taze QR kodu alınıyor...', 'suc');
        setTimeout(() => {
          forcePageReload();
        }, 1500);
      } catch (e) {
        showToast('Sıfırlama hatası: ' + e.message);
        if (btn) btn.innerText = '🧹 Sıfırla & Temiz Başlat';
      }
    }

    async function manualRefreshQR() {
      const btn = document.getElementById('refreshQrBtn');
      if (btn) btn.innerText = 'Taze Kod Üretiliyor...';
      try {
        await fetch('/api/restart', { method: 'POST' });
        showToast('Taze QR kodu üretiliyor, lütfen bekleyin...', 'info');
        setTimeout(async () => {
          const res = await fetch('/api/status?t=' + Date.now());
          const data = await res.json();
          if (data.qrImage) {
            const img = document.getElementById('qrImg');
            if (img) img.src = data.qrImage;
            showToast('Yeni QR kod hazır, okutabilirsiniz!', 'suc');
          }
          if (btn) btn.innerText = '🔄 Taze QR Kod Üret';
        }, 2000);
      } catch (e) {
        showToast('Yenileme hatası: ' + e.message);
        if (btn) btn.innerText = '🔄 Taze QR Kod Üret';
      }
    }

    async function getPairingCode() {
      const phone = document.getElementById('phoneInput').value;
      if (!phone) return showToast('Lütfen telefon numarası girin!');

      const btn = document.getElementById('pairBtn');
      btn.innerText = 'Kod Alınıyor (10-15 sn sürebilir)...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success && data.code) {
          document.getElementById('codeBox').style.display = 'block';
          document.getElementById('codeDisplay').innerText = data.code;
          btn.innerText = 'Yeni Kod İste';
          btn.disabled = false;
          showToast('Eşleşme kodunuz hazır: ' + data.code, 'suc');
        } else {
          showToast('Eşleşme hatası: ' + (data.error || 'Kod üretilemedi. QR kodu okutmayı deneyin.'));
          btn.innerText = '📲 8 Haneli Eşleşme Kodu Al';
          btn.disabled = false;
        }
      } catch (err) {
        showToast('Sunucu bağlantı hatası: ' + err.message);
        btn.innerText = '📲 8 Haneli Eşleşme Kodu Al';
        btn.disabled = false;
      }
    }

    function copyCode() {
      const code = document.getElementById('codeDisplay').innerText;
      if (code && code !== '----') {
        navigator.clipboard.writeText(code.replace('-', ''));
        showToast('Kod panoya kopyalandı!', 'suc');
      }
    }

    async function logout() {
      showToast('Çıkış yapılıyor...', 'info');
      await fetch('/api/logout', { method: 'POST' });
      setTimeout(() => { forcePageReload(); }, 1000);
    }

    // Durumu ve QR Kodunu 2.5 saniyede bir otomatik sorgula ve güncelle
    setInterval(async () => {
      try {
        const res = await fetch('/api/status?t=' + Date.now());
        const data = await res.json();
        if (data.connected) {
          const badge = document.getElementById('statusBadge');
          if (badge && !badge.classList.contains('status--connected')) {
            forcePageReload();
          }
        } else if (data.qrImage) {
          const img = document.getElementById('qrImg');
          if (img && img.src !== data.qrImage) {
            img.src = data.qrImage;
          }
        }
      } catch (e) {}
    }, 2500);
  </script>
</body>
</html>
  `);
});

/* ─────────────────────────────────────────────
   SUNUCUYU VE ARKA PLAN SERVİSLERİNİ BAŞLAT
   ───────────────────────────────────────────── */
app.listen(PORT, async () => {
  console.log(`[BerberBot] 🚀 Sunucu ${PORT} portunda çalışıyor: http://localhost:${PORT}`);
  
  // WhatsApp soketini başlat
  await wa.start();

  // Hatırlatıcı cron ve realtime dinleyicisini başlat
  reminderService.start();
  realtimeListener.start();
});
