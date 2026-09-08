const fs = require('fs');
const path = require('path');

/**
 * WhatsApp Oturum Yöneticisi (Supabase + Yerel Dosya Hibrit Kalıcılık)
 * 
 * Neden Hibrit?
 * Baileys kripto kütüphaneleri yerel dosya sisteminde nano-saniye düzeyinde
 * okuma/yazma yapar. Render/Koyeb gibi ücretsiz bulut sunucuları kapandığında
 * geçici disk silinir. Bu modül:
 * 1. Sunucu açılırken Supabase'den kayıtlı anahtarları diske geri yükler.
 * 2. Yeni anahtar oluştukça Supabase'e yedekler.
 * 3. Böylece Samet abi asla tekrar tekrar QR/Eşleşme kodu okutmak zorunda kalmaz!
 */
class SessionStore {
  constructor(supabaseClient, sessionId = 'berber_main', authDir = './auth_info') {
    this.supabase = supabaseClient;
    this.sessionId = sessionId;
    this.authDir = path.resolve(authDir);
    this._syncTimer = null;
    this._supabaseAvailable = true;

    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  /**
   * Sunucu başlangıcında Supabase'den oturum dosyalarını yerel diske çeker.
   */
  async restoreFromSupabase() {
    if (!this.supabase) return;
    try {
      // 1. Yerel auth dizini doluysa (dosya sayısı > 0), Supabase'den geri yüklemeyi TAMAMEN atla!
      // Amaç: Yereldeki daha güncel oturum dosyalarının üzerine eski/stale veri yazılmasını engellemek.
      if (fs.existsSync(this.authDir)) {
        const existingFiles = fs.readdirSync(this.authDir).filter(f => !f.startsWith('.'));
        if (existingFiles.length > 0) {
          console.log(`[SessionStore] ℹ️ Yerel oturum dizini dolu (${existingFiles.length} dosya mevcut). Supabase'den geri yükleme atlanıyor, yerel güncel veriler korunuyor.`);
          return;
        }
      }

      console.log('[SessionStore] Yerel oturum boş. Supabase üzerinden oturum kontrol ediliyor...');
      const { data, error } = await this.supabase
        .from('whatsapp_sessions')
        .select('key_id, data')
        .eq('session_id', this.sessionId);

      if (error) {
        // Tablo henüz oluşturulmamışsa (PGRST205 vb.)
        if (error.code === 'PGRST205' || error.message.includes('not find the table')) {
          console.warn('[SessionStore] ℹ️ Supabase whatsapp_sessions tablosu henüz yok. Oturum yerel diskte tutulacak.');
          this._supabaseAvailable = false;
          return;
        }
        console.warn('[SessionStore] Supabase geri yükleme uyarısı:', error.message);
        return;
      }

      if (data && data.length > 0) {
        console.log(`[SessionStore] Supabase'den ${data.length} adet oturum anahtarı bulundu. Geri yükleniyor...`);
        for (const item of data) {
          const filePath = path.join(this.authDir, item.key_id);
          const content = typeof item.data === 'string' ? item.data : JSON.stringify(item.data, null, 2);
          fs.writeFileSync(filePath, content, 'utf8');
        }
        console.log('[SessionStore] ✅ Oturum başarıyla diske geri yüklendi!');
      } else {
        console.log('[SessionStore] Henüz kayıtlı oturum bulunamadı. Yeni bağlantı bekleniyor.');
      }
    } catch (err) {
      console.warn('[SessionStore] Oturum geri yüklenirken hata (yerel disk kullanılacak):', err.message);
    }
  }

  /**
   * Yerel diskteki oturum anahtarlarını Supabase'e yedekler.
   * Debounce (gecikmeli toplu yedekleme) ile gereksiz istekleri önler.
   */
  scheduleSyncToSupabase() {
    if (!this.supabase || !this._supabaseAvailable) return;

    if (this._syncTimer) clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(async () => {
      await this.syncToSupabase();
    }, 2000); // 2 saniye sonra toplu yedekle
  }

  async syncToSupabase() {
    if (!this.supabase || !this._supabaseAvailable) return;
    try {
      if (!fs.existsSync(this.authDir)) return;
      const files = fs.readdirSync(this.authDir);
      if (files.length === 0) return;

      const records = [];
      for (const filename of files) {
        if (!filename.endsWith('.json')) continue;
        const filePath = path.join(this.authDir, filename);
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          records.push({
            session_id: this.sessionId,
            key_id: filename,
            data: parsed,
            updated_at: new Date().toISOString()
          });
        } catch (e) {
          // Okunamayan geçici dosyaları atla
        }
      }

      if (records.length > 0) {
        const { error } = await this.supabase
          .from('whatsapp_sessions')
          .upsert(records, { onConflict: 'session_id, key_id' });

        if (!error) {
          console.log(`[SessionStore] ☁️ ${records.length} oturum anahtarı Supabase'e güvenle yedeklendi.`);
        } else {
          console.warn(`[SessionStore] ⚠️ Supabase oturum yedekleme reddedildi:`, error.message);
        }
      }
    } catch (err) {
      console.warn('[SessionStore] Supabase yedekleme hatası:', err.message);
    }
  }

  /**
   * Çıkış yapıldığında oturumu temizler
   */
  async clearSession() {
    try {
      if (fs.existsSync(this.authDir)) {
        const files = fs.readdirSync(this.authDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.authDir, file));
        }
      }
      if (this.supabase && this._supabaseAvailable) {
        await this.supabase
          .from('whatsapp_sessions')
          .delete()
          .eq('session_id', this.sessionId);
      }
      console.log('[SessionStore] Oturum dosyaları ve Supabase kayıtları temizlendi.');
    } catch (err) {
      console.error('[SessionStore] Oturum temizleme hatası:', err.message);
    }
  }
}

module.exports = SessionStore;
