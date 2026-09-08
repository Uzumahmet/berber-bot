const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay,
  Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const SessionStore = require('./session-store');

class WhatsAppClient {
  constructor(options = {}) {
    this.supabase = options.supabase;
    this.sessionId = options.sessionId || 'berber_main';
    this.authDir = options.authDir || path.resolve('./auth_info');
    this.sessionStore = new SessionStore(this.supabase, this.sessionId, this.authDir);

    this.sock = null;
    this.status = 'disconnected'; // 'connecting' | 'connected' | 'disconnected'
    this.currentQR = null;
    this.currentQRImage = null;
    this.currentPairingCode = null;
    this.connectedUser = null;
    this.isStarting = false;
    this._reconnectTimer = null;
    this._messageCache = new Map();
  }

  async restart() {
    console.log('[WhatsAppClient] Soket zorla yeniden başlatılıyor...');
    try {
      if (this.sock) {
        this.sock.end(new Error('Manual Restart'));
      }
    } catch(e) {}
    this.isStarting = false;
    this.currentQR = null;
    this.currentQRImage = null;
    this.currentPairingCode = null;
    this.status = 'connecting';
    await delay(1000);
    await this.start();
  }

  async clearAndReset() {
    console.log('[WhatsAppClient] Tüm oturum sıfırlanıyor (temiz başlangıç)...');
    try {
      if (this.sock) {
        this.sock.end(new Error('Manual Reset'));
      }
    } catch (e) {}
    await this.sessionStore.clearSession();
    this.status = 'disconnected';
    this.connectedUser = null;
    this.currentQR = null;
    this.currentQRImage = null;
    this.currentPairingCode = null;
    this.isStarting = false;
    await delay(1500);
    await this.start();
  }


  async start() {
    if (this.isStarting) return;
    this.isStarting = true;
    this.status = 'connecting';

    try {
      // 1. Supabase'deki kayıtlı oturumu diske geri yükle
      await this.sessionStore.restoreFromSupabase();

      // 2. Baileys çoklu dosya auth durumu
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      console.log(`[WhatsAppClient] Baileys v${version.join('.')} başlatılıyor...`);

      const logger = pino({ level: 'silent' });

      this.sock = makeWASocket({
        version,
        logger,
        auth: state,
        printQRInTerminal: false, // Terminali kirletme, web üzerinden göster
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: true, // Telefon ile senkronizasyonun canlı kalmasını sağlar
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        emitOwnEvents: false,
        getMessage: async (key) => {
          // Alıcının telefonu şifre çözme anahtarı istediğinde (Retry Request) mesajı geri döndürür
          if (this._messageCache && this._messageCache.has(key?.id)) {
            return this._messageCache.get(key.id);
          }
          return {
            conversation: 'BERBER-X Randevu Bilgilendirmesi'
          };
        }
      });

      // Credential güncellemelerini yakala ve Supabase'e yedekle
      this.sock.ev.on('creds.update', async () => {
        await saveCreds();
        this.sessionStore.scheduleSyncToSupabase();
      });

      // Bağlantı durumu güncellemeleri
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQR = qr;
          try {
            this.currentQRImage = await qrcode.toDataURL(qr);
          } catch (e) {
            this.currentQRImage = null;
          }
          console.log('[WhatsAppClient] Yeni QR kod üretildi. Web arayüzünden taranabilir.');
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.currentQR = null;
          this.currentQRImage = null;
          this.currentPairingCode = null;

          const rawId = this.sock.user?.id || '';
          const phone = rawId.split(':')[0] || rawId.split('@')[0];
          this.connectedUser = {
            id: rawId,
            phone: phone ? `+${phone}` : 'Bilinmiyor',
            name: this.sock.user?.name || 'BERBER-X'
          };

          console.log(`[WhatsAppClient] 🟢 WHATSAPP BAĞLANDI! Kullanıcı: ${this.connectedUser.phone} (${this.connectedUser.name})`);
          
          // Bağlantıyı Supabase'e hemen tam yedekle
          await this.sessionStore.syncToSupabase();
        }

        if (connection === 'close') {
          this.status = 'disconnected';
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsAppClient] 🔴 Bağlantı koptu. Sebep kodu: ${statusCode}. Yeniden bağlanılacak mı: ${shouldReconnect}`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('[WhatsAppClient] Kullanıcı oturumu kapattı (Logged out). Oturum sıfırlanıyor...');
            await this.sessionStore.clearSession();
            this.connectedUser = null;
          }

          if (shouldReconnect) {
            if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
            this._reconnectTimer = setTimeout(() => {
              console.log('[WhatsAppClient] Yeniden bağlanılıyor...');
              this.isStarting = false;
              this.start();
            }, 5000);
          }
        }
      });

    } catch (err) {
      console.error('[WhatsAppClient] Başlatma hatası:', err.message);
      this.status = 'disconnected';
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * 8 Haneli Eşleşme Kodu (Pairing Code) İsteği
   * Samet abi tek telefondan bağlanırken QR okutamaz; bu kod ile doğrudan bağlanır!
   */
  async requestPairingCode(rawPhoneNumber) {
    if (!this.sock) {
      await this.start();
      await delay(2000);
    }

    if (this.status === 'connected') {
      throw new Error('Zaten bağlı bir WhatsApp oturumu mevcut.');
    }

    // Telefon numarasını temizle (Örn: 905422628830)
    let phone = String(rawPhoneNumber || '').replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '90' + phone.slice(1);
    if (!phone.startsWith('90')) phone = '90' + phone;

    if (phone.length < 10) {
      throw new Error('Geçersiz telefon numarası! Lütfen en az 10 haneli numara girin.');
    }

    console.log(`[WhatsAppClient] ${phone} için Eşleşme Kodu isteniyor...`);

    // Soket yoksa veya kapalıysa yeniden başlat
    if (!this.sock || this.status === 'disconnected') {
      await this.restart();
      await delay(3000);
    }

    try {
      // 8 karakterli eşleşme kodu üretir (örn: ABCD1234)
      const code = await this.sock.requestPairingCode(phone);
      const formatted = code ? (code.slice(0, 4) + '-' + code.slice(4)) : code;
      this.currentPairingCode = formatted;
      console.log(`[WhatsAppClient] ✅ Eşleşme Kodu Hazır: ${formatted}`);
      return formatted;
    } catch (err) {
      console.warn('[WhatsAppClient] Eşleşme kodu ilk denemede hata verdi, soket sıfırlanıp 1 kez daha deneniyor:', err.message);
      try {
        await this.restart();
        await delay(3500);
        const code = await this.sock.requestPairingCode(phone);
        const formatted = code ? (code.slice(0, 4) + '-' + code.slice(4)) : code;
        this.currentPairingCode = formatted;
        return formatted;
      } catch (retryErr) {
        console.error('[WhatsAppClient] İkinci denemede de eşleşme kodu alınamadı:', retryErr.message);
        throw retryErr;
      }
    }
  }

  /**
   * WhatsApp üzerinden mesaj gönderir
   */
  async sendMessage(toPhone, message) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp bağlı değil! Mesaj gönderilemedi.');
    }

    // Telefonu WhatsApp JID formatına çek (905XXXXXXXXX@s.whatsapp.net)
    let clean = toPhone.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '90' + clean.slice(1);
    if (!clean.startsWith('90')) clean = '90' + clean;
    const jid = `${clean}@s.whatsapp.net`;

    // ── ÇİFT MESAJ ENGELLEME (Anti-Duplicate Deduplication - Son 45 Saniye) ──
    const now = Date.now();
    const msgFingerprint = `${clean}_${message.slice(0, 40).replace(/\s+/g, '')}`;
    if (!this._recentMessages) this._recentMessages = new Map();

    if (this._recentMessages.has(msgFingerprint)) {
      const lastSent = this._recentMessages.get(msgFingerprint);
      if (now - lastSent < 45000) {
        console.warn(`[WhatsAppClient] ⚠️ Çift mesaj engellendi (Son 45 sn içinde bu mesaj zaten iletildi): ${clean}`);
        return { success: true, duplicateBlocked: true };
      }
    }
    this._recentMessages.set(msgFingerprint, now);

    // Bellek temizliği (100 kaydı aşarsa eski kayıtları sil)
    if (this._recentMessages.size > 100) {
      for (const [k, time] of this._recentMessages) {
        if (now - time > 60000) this._recentMessages.delete(k);
      }
    }

    console.log(`[WhatsAppClient] Mesaj gönderiliyor -> ${jid}`);

    // Güvenlik & İnsansı Gecikme (Anti-Ban)
    const randomDelay = Math.floor(Math.random() * 2000) + 1500; // 1.5 - 3.5 sn
    await delay(randomDelay);

    const result = await this.sock.sendMessage(jid, { text: message });
    if (result?.key?.id && result?.message) {
      this._messageCache.set(result.key.id, result.message);
      if (this._messageCache.size > 200) {
        const oldestKey = this._messageCache.keys().next().value;
        this._messageCache.delete(oldestKey);
      }
    }
    console.log(`[WhatsAppClient] ✅ Mesaj başarıyla iletildi: ${clean}`);
    
    // Mesaj sonrası güncellenen kripto oturum anahtarlarını Supabase'e yedekle
    this.sessionStore.scheduleSyncToSupabase();
    return result;
  }

  /**
   * Oturumu kapatır ve verileri sıfırlar
   */
  async logout() {
    console.log('[WhatsAppClient] Oturum kapatılıyor...');
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {}
    
    await this.sessionStore.clearSession();
    this.status = 'disconnected';
    this.connectedUser = null;
    this.currentQR = null;
    this.currentQRImage = null;
    this.currentPairingCode = null;

    // Yeni temiz soket başlat
    setTimeout(() => {
      this.isStarting = false;
      this.start();
    }, 2000);
  }

  /**
   * Canlı durum özeti
   */
  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      user: this.connectedUser,
      hasQR: Boolean(this.currentQRImage),
      qrImage: this.currentQRImage,
      pairingCode: this.currentPairingCode
    };
  }
}

module.exports = WhatsAppClient;
