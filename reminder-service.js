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

function getLocalDateStr(date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
}

class ReminderService {
  constructor(supabaseClient, whatsAppClient) {
    this.supabase = supabaseClient;
    this.wa = whatsAppClient;
    this.task = null;
  }

  start() {
    console.log('[ReminderService] Otomatik hatırlatıcı zamanlayıcısı başlatıldı (Her 15 dakikada bir kontrol).');
    
    // Her 15 dakikada bir çalış
    this.task = cron.schedule('*/15 * * * *', async () => {
      await this.checkAndSendReminders();
    });

    // Başlangıçta da bir kere kontrol et
    setTimeout(() => {
      this.checkAndSendReminders();
    }, 10000);
  }

  async checkAndSendReminders() {
    if (!this.supabase || !this.wa || this.wa.status !== 'connected') {
      return; // WhatsApp bağlı değilse bekle
    }

    try {
      const simdi = new Date();
      const bugunStr = getLocalDateStr(simdi);

      const yarin = new Date(simdi);
      yarin.setDate(simdi.getDate() + 1);
      const yarinStr = getLocalDateStr(yarin);

      /* ═══════════════════════════════════════════════════════════════
         1. HEDEF: YARIN OLACAK RANDEVULAR (1 Gün Kala Hatırlatıcı)
         ═══════════════════════════════════════════════════════════════ */
      const { data: yarinRandevular, error: err1 } = await this.supabase
        .from('berber_appointments')
        .select('*')
        .eq('preferred_date', yarinStr)
        .neq('status', 'reddedildi')
        .eq('reminder_1day_sent', false);

      if (!err1 && yarinRandevular && yarinRandevular.length > 0) {
        console.log(`[ReminderService] 1 Gün Kala Hatırlatma Bekleyen: ${yarinRandevular.length} randevu.`);
        for (const r of yarinRandevular) {
          const tarihTr = formatTarihTr(r.preferred_date);
          const mesaj = `Merhaba ${r.customer_name} 👋\n\n` +
                        `Randevunuza 1 gün kaldı! ⏰\n` +
                        `Yarın (${tarihTr}) saat ${r.preferred_time}'de saç tasarım randevunuz bulunmaktadır. 💈\n\n` +
                        `Randevunuza gelebilecek misiniz? Teyit etmek veya değişiklik için lütfen bize bildiriniz. Görüşmek üzere! 💈✂️`;

          try {
            await this.wa.sendMessage(r.customer_phone, mesaj);
            await this.supabase
              .from('berber_appointments')
              .update({ reminder_1day_sent: true, updated_at: new Date().toISOString() })
              .eq('id', r.id);
            console.log(`[ReminderService] [1 Gün Kala] ID ${r.id} (${r.customer_name}) mesaj gönderildi ✓`);
          } catch (e) {
            console.error(`[ReminderService] [1 Gün Kala] Gönderim hatası (ID ${r.id}):`, e.message);
          }
        }
      }

      /* ═══════════════════════════════════════════════════════════════
         2. HEDEF: BUGÜN 2 SAAT İÇİNDE OLACAK RANDEVULAR
         ═══════════════════════════════════════════════════════════════ */
      const { data: bugunRandevular, error: err2 } = await this.supabase
        .from('berber_appointments')
        .select('*')
        .eq('preferred_date', bugunStr)
        .neq('status', 'reddedildi')
        .eq('reminder_2hours_sent', false);

      if (!err2 && bugunRandevular && bugunRandevular.length > 0) {
        const ikiSaatSonra = new Date(simdi.getTime() + 2 * 60 * 60 * 1000);
        const ikiBucukSaatSonra = new Date(simdi.getTime() + 2.5 * 60 * 60 * 1000);

        const pad = (n) => String(n).padStart(2, '0');
        const altLimitStr = `${pad(simdi.getHours())}:${pad(simdi.getMinutes())}`;
        const ustLimitStr = `${pad(ikiBucukSaatSonra.getHours())}:${pad(ikiBucukSaatSonra.getMinutes())}`;

        const gonderilecekler = bugunRandevular.filter(r => {
          return r.preferred_time >= altLimitStr && r.preferred_time <= ustLimitStr;
        });

        if (gonderilecekler.length > 0) {
          console.log(`[ReminderService] 2 Saat Kala Hatırlatma Bekleyen: ${gonderilecekler.length} randevu.`);
          for (const r of gonderilecekler) {
            const mesaj = `Merhaba ${r.customer_name} 👋\n\n` +
                          `Randevunuza yaklaşık 2 saat kaldı! ⏰\n` +
                          `Bugün saat ${r.preferred_time}'de saç tasarım randevunuz bulunmaktadır.\n\n` +
                          `Tarzınızı yenilemek için sizi bekliyoruz! Görüşmek üzere. 💈✂️`;

            try {
              await this.wa.sendMessage(r.customer_phone, mesaj);
              await this.supabase
                .from('berber_appointments')
                .update({ reminder_2hours_sent: true, updated_at: new Date().toISOString() })
                .eq('id', r.id);
              console.log(`[ReminderService] [2 Saat Kala] ID ${r.id} (${r.customer_name}) mesaj gönderildi ✓`);
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
