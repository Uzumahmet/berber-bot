function formatTarihTr(tarihStr) {
  try {
    const tarih = new Date(tarihStr + 'T00:00:00');
    const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    const gunler = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    return `${tarih.getDate()} ${aylar[tarih.getMonth()]} ${tarih.getFullYear()}, ${gunler[tarih.getDay()]}`;
  } catch (e) {
    return tarihStr;
  }
}

class RealtimeListener {
  constructor(supabaseClient, whatsAppClient) {
    this.supabase = supabaseClient;
    this.wa = whatsAppClient;
    this.channel = null;
  }

  start() {
    if (!this.supabase) return;

    console.log('[RealtimeListener] Supabase Realtime randevu dinleyicisi kuruluyor...');

    try {
      this.channel = this.supabase
        .channel('bot-appointment-listener')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'berber_appointments' },
          async (payload) => {
            console.log('[RealtimeListener] ⚡ Yeni randevu oluşturuldu (INSERT):', payload.new?.id);
            await this.handleNewAppointment(payload.new);
          }
        )
        .subscribe((status) => {
          console.log(`[RealtimeListener] Realtime bağlantı durumu: ${status}`);
        });
    } catch (err) {
      console.error('[RealtimeListener] Başlatma hatası:', err.message);
    }
  }

  /**
   * Siteden yeni randevu oluşturulduğunda müşteriye tek seferlik anında WhatsApp teyidi gönderir
   * (Kullanıcı Kuralı 1: Sadece randevu yapıldığında mesaj gider)
   */
  async handleNewAppointment(r) {
    if (!r || !r.customer_phone || !this.wa || this.wa.status !== 'connected') {
      console.log('[RealtimeListener] WhatsApp bağlı değil veya telefon numarası yok, atlandı.');
      return;
    }

    const vipEtiket = r.is_vip ? ' ⭐ VIP' : '';
    const tarihTr = formatTarihTr(r.preferred_date);

    const mesaj = `Merhaba ${r.customer_name} 👋\n\n` +
                  `Berberim Saç Tasarım Salonu'ndan${vipEtiket} randevunuz başarıyla oluşturuldu! ✅\n\n` +
                  `📅 Tarih: ${tarihTr}\n` +
                  `⏰ Saat: ${r.preferred_time}\n` +
                  `💈 İşlem: ${r.service_type}\n\n` +
                  `Bizi tercih ettiğiniz için teşekkür ederiz. Randevu saatinizde görüşmek üzere! 💈✂️`;

    try {
      console.log(`[RealtimeListener] Anında onay mesajı gönderiliyor -> ${r.customer_phone}`);
      await this.wa.sendMessage(r.customer_phone, mesaj);
    } catch (err) {
      console.error('[RealtimeListener] Onay mesajı gönderim hatası:', err.message);
    }
  }

  stop() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
    }
  }
}

module.exports = RealtimeListener;
