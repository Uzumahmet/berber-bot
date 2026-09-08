const cron = require('node-cron');

/**
 * WhatsApp Kalıcı & Hibrit Mesaj Önbelleği (RAM + Supabase)
 * 
 * Baileys mesaj iletimi sırasında alıcı cihazın gönderdiği Retry (yeniden çözme)
 * isteklerine doğru orijinal mesajı dönebilmek için kullanılır.
 * 
 * Cold start veya yeniden başlatma sonrası RAM boşalsa bile Supabase
 * whatsapp_message_cache tablosundan orijinal mesaj bulunur ve kalıcı
 * "mesaj bekleniyor" (decrypt failure) hatası önlenir.
 */
class MessageCache {
  constructor(supabaseClient, maxRamEntries = 500) {
    this.supabase = supabaseClient;
    this.maxRamEntries = maxRamEntries;
    this._ramCache = new Map();
    this._supabaseAvailable = true;
    this._cleanupCron = null;
  }

  /**
   * Mesajı RAM'e yazar ve maksimum kapasiteyi korur (LRU)
   */
  _setRam(keyId, message) {
    if (!keyId || !message) return;
    this._ramCache.set(keyId, message);
    if (this._ramCache.size > this.maxRamEntries) {
      const oldestKey = this._ramCache.keys().next().value;
      this._ramCache.delete(oldestKey);
    }
  }

  /**
   * Mesajı önbelleğe kaydeder (hem RAM hem de Supabase'e)
   */
  async set(keyId, message) {
    if (!keyId || !message) return;

    // 1. RAM'e anında kaydet
    this._setRam(keyId, message);

    // 2. Supabase kalıcı depoya kaydet
    if (!this.supabase || !this._supabaseAvailable) return;

    try {
      const { error } = await this.supabase
        .from('whatsapp_message_cache')
        .upsert(
          {
            key_id: keyId,
            message: message,
            created_at: new Date().toISOString()
          },
          { onConflict: 'key_id' }
        );

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('not find the table')) {
          console.warn('[MessageCache] ℹ️ whatsapp_message_cache tablosu henüz mevcut değil. Mesajlar RAM önbelleğinde tutulacak.');
          this._supabaseAvailable = false;
        } else {
          console.warn('[MessageCache] Supabase mesaj önbelleği kayıt uyarısı:', error.message);
        }
      }
    } catch (err) {
      console.warn('[MessageCache] Mesaj önbelleğe yazılamadı:', err.message);
    }
  }

  /**
   * Mesajı getirir (Önce RAM, yoksa Supabase)
   * Bulunamazsa KESİNLİKLE undefined döner!
   */
  async get(keyId) {
    if (!keyId) return undefined;

    // 1. RAM önbelleğinde ara
    if (this._ramCache.has(keyId)) {
      return this._ramCache.get(keyId);
    }

    // 2. Supabase'de ara
    if (!this.supabase || !this._supabaseAvailable) {
      return undefined;
    }

    try {
      const { data, error } = await this.supabase
        .from('whatsapp_message_cache')
        .select('message')
        .eq('key_id', keyId)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('not find the table')) {
          this._supabaseAvailable = false;
        }
        return undefined;
      }

      if (data && data.message) {
        // Sonraki aramalar için RAM'e al
        this._setRam(keyId, data.message);
        return data.message;
      }
    } catch (err) {
      console.warn('[MessageCache] Supabase mesaj arama hatası:', err.message);
    }

    // Cache'te yoksa ASLA placeholder/sabit içerik DÖNÜLMEZ!
    return undefined;
  }

  /**
   * 48 saatten eski kayıtları Supabase'den temizler
   */
  async cleanupOldMessages(hours = 48) {
    if (!this.supabase || !this._supabaseAvailable) return;

    try {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const { error, count } = await this.supabase
        .from('whatsapp_message_cache')
        .delete()
        .lt('created_at', cutoff);

      if (!error) {
        console.log(`[MessageCache] 🧹 ${hours} saatten eski mesaj önbelleği kayıtları temizlendi.`);
      }
    } catch (err) {
      console.warn('[MessageCache] Eski mesajları temizleme hatası:', err.message);
    }
  }

  /**
   * Periyodik temizlik cron'unu başlatır (varsayılan: günde 1 kez gece 03:00 veya her 6 saatte bir)
   */
  startCleanupCron() {
    if (this._cleanupCron) return;

    // Her 6 saatte bir çalıştır: '0 */6 * * *'
    this._cleanupCron = cron.schedule('0 */6 * * *', async () => {
      await this.cleanupOldMessages(48);
    });

    console.log('[MessageCache] Otomatik önbellek temizlik cron\'u başlatıldı (48 saat sınırı, her 6 saatte bir kontrol).');
  }

  stopCleanupCron() {
    if (this._cleanupCron) {
      this._cleanupCron.stop();
      this._cleanupCron = null;
    }
  }
}

module.exports = MessageCache;
