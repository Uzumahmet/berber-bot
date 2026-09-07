# 💈 Berber-X WhatsApp Bulut Botu (0 TL - 7/24 Kesintisiz)

Bu mikroservis; dükkanda bilgisayar veya Wi-Fi bulunmadığı koşullarda, **Samet abinin şahsi WhatsApp numarasını** bağlayarak müşterilere **tam otomatik randevu onayı** ve **1 gün / 2 saat kala hatırlatma mesajları** gönderir.

---

## 🚀 ÜCRETSİZ BULUTTA 7/24 YAYINA ALMA (Render.com)

Bu servisi **Render.com** üzerinde **0 TL** ile ömür boyu 7/24 çalıştırmak için şu adımları izleyin:

### Adım 1: GitHub Deposuna Yükleme
`whatsapp-bot` klasörünü içeren projenizi GitHub'a push edin (zaten Git kullanıyorsanız doğrudan görünür).

### Adım 2: Render.com Hesabı Açma
1. [Render.com](https://render.com) adresine gidin ve ücretsiz GitHub hesabınızla giriş yapın.
2. **New +** > **Web Service** seçeneğine tıklayın.
3. GitHub deponuzu seçin.
4. Ayarları şu şekilde yapın:
   * **Root Directory:** `whatsapp-bot`
   * **Runtime:** `Node`
   * **Build Command:** `npm install`
   * **Start Command:** `node server.js`
   * **Instance Type:** `Free`
5. **Environment Variables** (Ortam Değişkenleri) bölümüne şunları ekleyin:
   * `SUPABASE_URL`: `https://rkqrlhkdcgspxpgywvtq.supabase.co`
   * `SUPABASE_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (Projenin Anon Key'i)
   * `SESSION_ID`: `berber_main`
   * `DEFAULT_PHONE`: `05524512619`
6. **Create Web Service** butonuna basın. Birkaç dakika içinde size özel bir adres oluşturulur:  
   👉 `https://berber-whatsapp-bot.onrender.com`

---

## 📲 Samet Abinin Telefonunu Bağlama (Eşleşme Kodu ile)

Samet abi tek bir şahsi telefona sahip olduğu için QR kodu kendi ekranından okutamaz. **8 Haneli Eşleşme Kodu** ile saniyeler içinde bağlanır:

1. Render'ın verdiği adresi (`https://berber-whatsapp-bot.onrender.com`) telefonda veya bilgisayarda açın.
2. Numarayı teyit edip **"📲 8 Haneli Eşleşme Kodu Al"** butonuna basın.
3. Ekranda örneğin `T5QD-Y6TX` gibi 8 haneli bir kod görünecektir.
4. Samet abi telefonunda:
   * **WhatsApp**'ı açar.
   * **Ayarlar (veya sağ üstteki üç nokta)** > **Bağlı Cihazlar** > **Cihaz Bağla**'ya basar.
   * Ekranın altındaki **"Telefon numarası ile bağla"** yazısına dokunur.
   * Ekrandaki 8 haneli kodu girer.
5. **Tebrikler!** Sistem yeşile döner (`Bağlı: +90 552 451 26 19`).

---

## 🛡️ Oturumun Asla Kopmaması (Supabase Session Persistence)

Render'ın ücretsiz sunucuları kapansa veya yeniden başlasa bile, oturum anahtarları otomatik olarak Supabase veritabanına yedeklenir.  
Sunucu yeniden açıldığında oturum saniyeler içinde sessizce geri yüklenir; **Samet abinin tekrar kod girmesine gerek kalmaz!**

---

## ⏰ Hatırlatıcı Kuralları (Otomatik Cron)

* **1 Gün Kala:** Yarın randevusu olan müşterilere otomatik olarak randevu saati ve hatırlatma mesajı gönderilir (`reminder_1day_sent = true` yapılır).
* **2 Saat Kala:** Bugün randevusuna 2-2.5 saat kalan müşterilere randevu saati bildirilir (`reminder_2hours_sent = true` yapılır).
* **Anında Onay:** Siteden randevu alındığı anda müşteriye hoşgeldiniz ve teyit mesajı gönderilir.
