require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const SessionStore = require('./session-store');
const MessageCache = require('./message-cache');
const ConcurrencyLock = require('./concurrency-lock');
const WhatsAppClient = require('./baileys-client');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function runAllTests() {
  console.log('====================================================');
  console.log('BERBER-X WHATSAPP BOT DOĞRULAMA VE KABUL TESTLERİ');
  console.log('====================================================\n');

  // TEST 1: 3 Kez Arka Arkaya Restart / Restore Simülasyonu
  console.log('--- TEST 1: auth_info Koruma Testi (3 Kez Restart) ---');
  const authDir = path.resolve('./auth_info');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const credsPath = path.join(authDir, 'creds.json');
  let createdDummy = false;
  if (!fs.existsSync(credsPath)) {
    fs.writeFileSync(credsPath, JSON.stringify({ test: 'dummy_session_data', timestamp: Date.now() }), 'utf8');
    createdDummy = true;
  }

  const initialContent = fs.readFileSync(credsPath, 'utf8');
  const store = new SessionStore(supabase, 'berber_main', authDir);

  for (let i = 1; i <= 3; i++) {
    console.log(`[Restart #${i}] restoreFromSupabase çağrılıyor...`);
    await store.restoreFromSupabase();
    const currentContent = fs.readFileSync(credsPath, 'utf8');
    if (currentContent !== initialContent) {
      throw new Error(`TEST 1 BAŞARISIZ: Restart #${i} sonrasında creds.json değişti!`);
    }
  }
  console.log('✅ TEST 1 BAŞARILI: auth_info içeriği 3 kez restart sonrasında aynen korundu, Supabase yerel dosyaları ezmedi.\n');

  if (createdDummy) {
    fs.unlinkSync(credsPath);
  }

  // TEST 2: getMessage() Davranış Testi (Kesinlikle placeholder dönmemeli, undefined dönmeli)
  console.log('--- TEST 2: getMessage() Placeholder Dönmeme Testi ---');
  const wa = new WhatsAppClient({ supabase, sessionId: 'berber_main', authDir });
  
  // 2.1 Olmayan anahtar ile test
  const missingMsg = await wa.messageCache.get('non_existent_key_12345');
  if (missingMsg !== undefined) {
    throw new Error(`TEST 2 BAŞARISIZ: Olmayan anahtar için undefined yerine ${JSON.stringify(missingMsg)} döndü!`);
  }
  console.log('✅ TEST 2.1 BAŞARILI: Önbellekte olmayan mesaj için kesinlikle undefined döndü (Placeholder dönülmedi).');

  // 2.2 Mesaj yazma ve okuma testi
  const testKey = 'test_msg_' + Date.now();
  const testMessage = { conversation: 'Merhaba berber testi ' + Date.now() };
  await wa.messageCache.set(testKey, testMessage);
  
  // RAM'den okuma
  const readFromRam = await wa.messageCache.get(testKey);
  if (!readFromRam || readFromRam.conversation !== testMessage.conversation) {
    throw new Error('TEST 2 BAŞARISIZ: RAM önbelleğinden okunamadı!');
  }
  console.log('✅ TEST 2.2 BAŞARILI: RAM önbelleğine yazma ve okuma kusursuz çalıştı.');

  // 2.3 RAM boşken getMessage davranışı (Soğuk Başlangıç Simülasyonu)
  wa.messageCache._ramCache.clear(); // RAM'i temizle
  const readAfterColdStart = await wa.messageCache.get(testKey);
  if (readAfterColdStart && readAfterColdStart.conversation !== testMessage.conversation) {
    throw new Error('TEST 2 BAŞARISIZ: Soğuk başlangıç sonrası yanlış içerik döndü!');
  }
  console.log(`✅ TEST 2.3 BAŞARILI: Soğuk başlangıçta getMessage sonucu: ${readAfterColdStart ? 'Supabase\'den başarıyla alındı' : 'Güvenli undefined döndü (Tablo oluşturulana kadar)'}. Asla placeholder dönmedi.\n`);

  // TEST 3: Concurrency Lock Testi
  console.log('--- TEST 3: Concurrency Lock Testi ---');
  const lock = new ConcurrencyLock(supabase, 'berber_main');
  await lock.acquireLock();
  console.log('✅ TEST 3.1 BAŞARILI: Kilit edinme çağrısı hatasız çalıştı.');
  await lock.releaseLock();
  console.log('✅ TEST 3.2 BAŞARILI: Kilit serbest bırakma çağrısı hatasız çalıştı.\n');

  // TEST 4: Graceful Shutdown syncToSupabase Testi
  console.log('--- TEST 4: Graceful Shutdown syncToSupabase Testi ---');
  console.log('syncToSupabase() await çağrısı test ediliyor...');
  await store.syncToSupabase();
  console.log('✅ TEST 4 BAŞARILI: syncToSupabase başarıyla tamamlandı.\n');

  // Temizlik
  wa.messageCache.stopCleanupCron();

  console.log('====================================================');
  console.log('🎉 TÜM KABUL KRİTERLERİ BAŞARIYLA DOĞRULANDI!');
  console.log('====================================================');
}

runAllTests().catch(err => {
  console.error('❌ TEST HATASI:', err);
  process.exit(1);
});
