const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay
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
        browser: ['Berber-X Randevu', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        emitOwnEvents: false
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
            name: this.sock.user?.name || 'Berberim'
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

    // Telefonu sadece rakamlara temizle (Örn: 905524512619)
    let phone = rawPhoneNumber.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '90' + phone.slice(1);
    if (!phone.startsWith('90')) phone = '90' + phone;

    console.log(`[WhatsAppClient] ${phone} için Eşleşme Kodu isteniyor...`);

    try {
      // 8 karakterli eşleşme kodu üretir (örn: ABCD1234)
      const code = await this.sock.requestPairingCode(phone);
      // Okunabilirlik için XXXX-XXXX formatına çevir
      const formatted = code ? (code.slice(0, 4) + '-' + code.slice(4)) : code;
      this.currentPairingCode = formatted;
      console.log(`[WhatsAppClient] ✅ Eşleşme Kodu Hazır: ${formatted}`);
      return formatted;
    } catch (err) {
      console.error('[WhatsAppClient] Eşleşme kodu alma hatası:', err.message);
      throw err;
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

    console.log(`[WhatsAppClient] Mesaj gönderiliyor -> ${jid}`);

    // Güvenlik & İnsansı Gecikme (Anti-Ban)
    const randomDelay = Math.floor(Math.random() * 2000) + 1500; // 1.5 - 3.5 sn
    await delay(randomDelay);

    const result = await this.sock.sendMessage(jid, { text: message });
    console.log(`[WhatsAppClient] ✅ Mesaj başarıyla iletildi: ${clean}`);
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
