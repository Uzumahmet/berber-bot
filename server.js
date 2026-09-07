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
  const status = wa.getStatus();
  const defaultPhone = process.env.DEFAULT_PHONE || '05524512619';

  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
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
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; width: 100%; max-width: 480px; padding: 28px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    p { font-size: 14px; color: var(--text-muted); line-height: 1.5; margin-bottom: 20px; }
    .status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 99px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
    .status--connected { background: rgba(37, 211, 102, 0.15); color: #25d366; border: 1px solid rgba(37, 211, 102, 0.3); }
    .status--disconnected { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    .status--connecting { background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .input-group { margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
    input { width: 100%; background: #0b0f19; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; color: #fff; font-size: 15px; outline: none; }
    input:focus { border-color: var(--primary); }
    button { width: 100%; background: var(--primary); color: #0b0f19; border: none; border-radius: 10px; padding: 13px; font-size: 15px; font-weight: 700; cursor: pointer; transition: 0.2s; }
    button:hover { background: var(--primary-hover); }
    .btn-secondary { background: #1e293b; color: #fff; margin-top: 10px; }
    .btn-secondary:hover { background: #334155; }
    .code-box { background: #0b0f19; border: 2px dashed var(--primary); border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; display: none; }
    .code-text { font-size: 32px; font-weight: 800; letter-spacing: 4px; color: var(--primary); font-family: monospace; }
    .steps { font-size: 13px; color: var(--text-muted); text-align: left; margin-top: 14px; line-height: 1.6; }
    .steps ol { padding-left: 18px; }
    .qr-container { text-align: center; margin: 20px 0; display: ${status.qrImage ? 'block' : 'none'}; }
    .qr-container img { border-radius: 12px; border: 4px solid #fff; max-width: 220px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>💈 Berber-X WhatsApp Asistanı</h1>
    <p>Dükkanda bilgisayar olmadan 7/24 otomatik randevu onayı ve hatırlatma gönderen bulut servisi.</p>

    <div id="statusBadge" class="status-badge ${status.connected ? 'status--connected' : (status.status === 'connecting' ? 'status--connecting' : 'status--disconnected')}">
      <span class="pulse"></span>
      <span id="statusText">
        ${status.connected ? 'Bağlı: ' + (status.user?.phone || 'Aktif') : (status.status === 'connecting' ? 'Bağlanıyor...' : 'Bağlantı Yok')}
      </span>
    </div>

    ${status.connected ? `
      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px;">
        <p style="margin: 0; color: #fff; font-size: 14px;">✅ <b>Sistem 7/24 Devrede!</b></p>
        <p style="margin: 6px 0 0; font-size: 12.5px;">Siteden randevu alındığında müşterilere otomatik WhatsApp mesajı ve randevu hatırlatması gönderiliyor.</p>
      </div>
      <button class="btn-secondary" onclick="logout()">Bağlantıyı Kes / Çıkış Yap</button>
    ` : `
      <div class="input-group">
        <label>Samet Abinin WhatsApp Telefon Numarası</label>
        <input type="text" id="phoneInput" value="${defaultPhone}" placeholder="05524512619" />
      </div>
      <button onclick="getPairingCode()">📲 8 Haneli Eşleşme Kodu Al</button>

      <div id="codeBox" class="code-box">
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">WHATSAPP EŞLEŞME KODU:</div>
        <div id="codeDisplay" class="code-text">----</div>
        <div class="steps">
          <b>Kendi Telefonundan Nasıl Bağlanırsın?</b>
          <ol>
            <li>Telefonunda WhatsApp'ı aç.</li>
            <li>Sağ üstteki <b>Üç Nokta</b> veya <b>Ayarlar</b>'a dokun.</li>
            <li><b>Bağlı Cihazlar</b> > <b>Cihaz Bağla</b>'ya bas.</li>
            <li>Alttaki <b>"Telefon numarası ile bağla"</b> yazısına dokun.</li>
            <li>Yukarıdaki 8 haneli kodu telefonuna gir.</li>
          </ol>
        </div>
      </div>

      <div class="qr-container" id="qrBox">
        <p style="font-size: 12px; margin-bottom: 8px;">Veya 2. bir ekrandan QR Kodu Okut:</p>
        <img id="qrImg" src="${status.qrImage || ''}" alt="QR Kod" />
      </div>
    `}
  </div>

  <script>
    async function getPairingCode() {
      const phone = document.getElementById('phoneInput').value;
      if (!phone) return alert('Lütfen telefon numarası girin!');

      const btn = event.target;
      btn.innerText = 'Kod Alınıyor...';
      btn.disabled = true;

      try {
        const res = await fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('codeBox').style.display = 'block';
          document.getElementById('codeDisplay').innerText = data.code;
          btn.innerText = 'Yeni Kod İste';
          btn.disabled = false;
        } else {
          alert('Hata: ' + (data.error || 'Kod alınamadı.'));
          btn.innerText = '📲 8 Haneli Eşleşme Kodu Al';
          btn.disabled = false;
        }
      } catch (err) {
        alert('Bağlantı hatası: ' + err.message);
        btn.innerText = '📲 8 Haneli Eşleşme Kodu Al';
        btn.disabled = false;
      }
    }

    async function logout() {
      if (!confirm('WhatsApp bağlantısını kesmek istediğinize emin misiniz?')) return;
      await fetch('/api/logout', { method: 'POST' });
      location.reload();
    }

    // Durumu 5 saniyede bir otomatik yenile
    setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.connected && !document.getElementById('statusBadge').classList.contains('status--connected')) {
          location.reload();
        }
      } catch (e) {}
    }, 5000);
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
