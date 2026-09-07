const cron = require('node-cron');

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

/**
 * Türkiye Saat Dilimi (UTC+3) Yardımcıları
 * Render sunucusu UTC'de çalıştığı için Türkiye saatini her zaman UTC+3 olarak hesaplar
 */
function getTurkeyDate() {
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(utcMs + (3 * 60 * 60 * 1000));
}

function getTurkeyDateStr(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

class ReminderService {
  constructor(supabaseClient, whatsAppClient) {
    this.supabase = supabaseClient;
    this.wa = whatsAppClient;
    this.task = null;
  }

  start() {
    console.log('[ReminderService] Otomatik hatırlatıcı zamanlayıcısı başlatıldı (Her 2 dakikada bir kontrol - UTC+3 Türkiye Saati).');
    
    // Her 2 dakikada bir kontrol et
    this.task = cron.schedule('*/2 * * * *', async () => {
      await this.checkAndSendReminders();
    });

    // Başlangıçta da 5 saniye sonra ilk kontrolü yap
    setTimeout(() => {
      this.checkAndSendReminders();
    }, 5000);
  }

  async checkAndSendReminders() {
    if (!this.supabase || !this.wa || this.wa.status !== 'connected') {
      return; // WhatsApp bağlı değilse bekle
    }

    try {
      const trNow = getTurkeyDate();
      const bugunStr = getTurkeyDateStr(trNow);
      const suankiSaat = trNow.getHours();
      const suankiDakika = suankiSaat * 60 + trNow.getMinutes();

      const yarinDate = new Date(trNow.getTime() + (24 * 60 * 60 * 1000));
      const yarinStr = getTurkeyDateStr(yarinDate);

      /* ═══════════════════════════════════════════════════════════════
         1. HEDEF: YARIN OLACAK RANDEVULAR (1 Gün Kala Hatırlatıcı)
         Gündüz saatlerinde (09:00 - 21:00 arası) gönderilir.
         ═══════════════════════════════════════════════════════════════ */
      if (suankiSaat >= 9 && suankiSaat <= 21) {
        const { data: yarinRandevular, error: err1 } = await this.supabase
          .from('berber_appointments')
          .select('*')
          .eq('preferred_date', yarinStr)
          .neq('status', 'reddedildi')
          .neq('status', 'iptal')
          .eq('reminder_1day_sent', false);

        if (!err1 && yarinRandevular && yarinRandevular.length > 0) {
          for (const r of yarinRandevular) {
            // Eğer randevu bugün son 3 saat içinde oluşturulduysa, henüz yeni onay mesajı aldığından beklet
            const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
            const olusturulmaFarkDakika = (Date.now() - createdMs) / 60000;
            if (olusturulmaFarkDakika < 180) {
              continue;
            }

            const vipEtiket = r.is_vip ? ' ⭐ VIP' : '';
            const tarihTr = formatTarihTr(r.preferred_date);
            const mesaj = `Merhaba ${r.customer_name} 👋\n\n` +
                          `Randevunuza 1 gün kaldı! ⏰\n` +
                          `Yarın (${tarihTr}) saat ${r.preferred_time}'de saç tasarım${vipEtiket} randevunuz bulunmaktadır. 💈\n\n` +
                          `Randevunuza gelebilecek misiniz? Teyit etmek veya değişiklik için lütfen bize bildiriniz. Görüşmek üzere! 💈✂️`;

            try {
              await this.wa.sendMessage(r.customer_phone, mesaj);
              await this.supabase
                .from('berber_appointments')
                .update({ reminder_1day_sent: true, updated_at: new Date().toISOString() })
                .eq('id', r.id);
              console.log(`[ReminderService] [1 Gün Kala] ID ${r.id} (${r.customer_name} - ${r.preferred_time}) mesaj gönderildi ✓`);
            } catch (e) {
              console.error(`[ReminderService] [1 Gün Kala] Gönderim hatası (ID ${r.id}):`, e.message);
            }
          }
        }
      }

      /* ═══════════════════════════════════════════════════════════════
         2. HEDEF: BUGÜN 2 SAAT KALAN RANDEVULAR
         Randevuya 130 dakika veya daha az kalanlar (başlangıç saatine kadar)
         ═══════════════════════════════════════════════════════════════ */
      const { data: bugunRandevular, error: err2 } = await this.supabase
        .from('berber_appointments')
        .select('*')
        .eq('preferred_date', bugunStr)
        .neq('status', 'reddedildi')
        .neq('status', 'iptal')
        .eq('reminder_2hours_sent', false);

      if (!err2 && bugunRandevular && bugunRandevular.length > 0) {
        for (const r of bugunRandevular) {
          if (!r.preferred_time) continue;

          const [h, m] = r.preferred_time.split(':').map(Number);
          const randevuDakika = h * 60 + m;
          const farkDakika = randevuDakika - suankiDakika;

          // Randevuya 2 saat 10 dk (130 dk) veya daha az kaldıysa ve henüz randevu saati geçmediyse (-10 dk tolerans)
          if (farkDakika <= 130 && farkDakika >= -10) {
            // Eğer randevu son 20 dakika içinde oluşturulduysa hemen 2. mesajı atma
            const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
            const olusturulmaFarkDakika = (Date.now() - createdMs) / 60000;
            if (olusturulmaFarkDakika < 20) {
              continue;
            }

            const vipEtiket = r.is_vip ? ' ⭐ VIP' : '';
            const mesaj = `Merhaba ${r.customer_name} 👋\n\n` +
                          `Randevunuza yaklaşık 2 saat kaldı! ⏰\n` +
                          `Bugün saat ${r.preferred_time}'de saç tasarım${vipEtiket} randevunuz bulunmaktadır.\n\n` +
                          `Tarzınızı yenilemek için sizi bekliyoruz! Görüşmek üzere. 💈✂️`;

            try {
              await this.wa.sendMessage(r.customer_phone, mesaj);
              await this.supabase
                .from('berber_appointments')
                .update({ reminder_2hours_sent: true, updated_at: new Date().toISOString() })
                .eq('id', r.id);
              console.log(`[ReminderService] [2 Saat Kala] ID ${r.id} (${r.customer_name} - ${r.preferred_time}) mesaj gönderildi ✓`);
            } catch (e) {
              console.error(`[ReminderService] [2 Saat Kala] Gönderim hatası (ID ${r.id}):`, e.message);
            }
          }
        }
      }

    } catch (globalErr) {
      console.error('[ReminderService] Hatırlatıcı döngü hatası:', globalErr.message);
    }
  }

  stop() {
    if (this.task) this.task.stop();
  }
}

module.exports = ReminderService;
