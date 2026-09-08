/**
 * Concurrency Lock Manager (Eşzamanlı Çalışma & Çift Soket Koruması)
 * 
 * Render Free Plan'da harici cron-job tetiklemeleri veya yeniden başlatmalar
 * sırasında aynı anda iki Node.js process'inin çalışıp aynı WhatsApp oturumunu
 * açmasını (çift Baileys soketi çakışması) engeller.
 */
class ConcurrencyLock {
  constructor(supabaseClient, sessionId = 'berber_main') {
    this.supabase = supabaseClient;
    this.sessionId = sessionId;
    this.instanceId = `inst_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this._heartbeatTimer = null;
    this._supabaseAvailable = true;
  }

  /**
   * Başlangıçta kilidi kontrol eder ve alır.
   * Son 30 sn içinde aktif başka bir instance varsa bekler.
   */
  async acquireLock() {
    if (!this.supabase || !this._supabaseAvailable) return;

    try {
      console.log(`[ConcurrencyLock] Kilit kontrol ediliyor (Instance: ${this.instanceId})...`);
      
      const { data, error } = await this.supabase
        .from('whatsapp_instance_locks')
        .select('session_id, instance_id, last_heartbeat')
        .eq('session_id', this.sessionId)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('not find the table')) {
          console.warn('[ConcurrencyLock] ℹ️ whatsapp_instance_locks tablosu henüz mevcut değil. Kilit kontrolü atlanıyor.');
          this._supabaseAvailable = false;
          return;
        }
        console.warn('[ConcurrencyLock] Kilit okuma uyarısı:', error.message);
      }

      if (data && data.instance_id !== this.instanceId && data.last_heartbeat) {
        const lastHeartbeatTime = new Date(data.last_heartbeat).getTime();
        const diffSeconds = Math.round((Date.now() - lastHeartbeatTime) / 1000);

        if (diffSeconds < 30) {
          console.warn(`[ConcurrencyLock] ⚠️ Aktif başka bir instance tespit edildi! (ID: ${data.instance_id}, ${diffSeconds} sn önce aktif).`);
          console.warn('[ConcurrencyLock] ⏳ Çakışan soket bağlantısını önlemek için 10 saniye bekleniyor...');
          await new Promise(res => setTimeout(res, 10000));
        }
      }

      // Kendi kilidimizi oluştur / devral
      await this._updateHeartbeat();
      console.log(`[ConcurrencyLock] ✅ Kilit başarıyla alındı (Instance: ${this.instanceId}).`);

      // Düzenli heartbeat başlat (Her 15 saniyede bir)
      this._startHeartbeat();
    } catch (err) {
      console.warn('[ConcurrencyLock] Kilit alma sırasında hata (devam ediliyor):', err.message);
    }
  }

  /**
   * Kilidin last_heartbeat bilgisini günceller
   */
  async _updateHeartbeat() {
    if (!this.supabase || !this._supabaseAvailable) return;
    try {
      await this.supabase
        .from('whatsapp_instance_locks')
        .upsert(
          {
            session_id: this.sessionId,
            instance_id: this.instanceId,
            last_heartbeat: new Date().toISOString()
          },
          { onConflict: 'session_id' }
        );
    } catch (err) {
      // Sessizce logla
    }
  }

  _startHeartbeat() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(async () => {
      await this._updateHeartbeat();
    }, 15000);
  }

  /**
   * Process kapanırken kilidi temizler
   */
  async releaseLock() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }

    if (!this.supabase || !this._supabaseAvailable) return;

    try {
      console.log(`[ConcurrencyLock] Kilit serbest bırakılıyor (Instance: ${this.instanceId})...`);
      await this.supabase
        .from('whatsapp_instance_locks')
        .delete()
        .eq('session_id', this.sessionId)
        .eq('instance_id', this.instanceId);
    } catch (err) {
      console.warn('[ConcurrencyLock] Kilit serbest bırakma uyarısı:', err.message);
    }
  }
}

module.exports = ConcurrencyLock;
