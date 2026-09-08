-- ==============================================================================
-- Berber-X WhatsApp Bot - Supabase Ek Tabloları
-- 
-- Bu SQL betiğini Supabase Dashboard -> SQL Editor alanında çalıştırabilirsiniz.
-- Tablolar henüz oluşturulmamış olsa bile uygulama graceful fallback ile
-- çalışmaya devam eder; tablolar eklendiğinde tam kapasite devreye girer.
-- ==============================================================================

-- 1. Kalıcı Mesaj Önbelleği Tablosu
-- Baileys yeniden başladığında veya alıcı cihaz retry (yeniden şifre çözme)
-- istediğinde orijinal mesaj içeriğinin kaybolmasını engeller.
CREATE TABLE IF NOT EXISTS public.whatsapp_message_cache (
  key_id TEXT PRIMARY KEY,
  message JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 48 saatten eski kayıtları hızlı temizlemek için indeks
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_cache_created_at 
  ON public.whatsapp_message_cache(created_at);

-- 2. Concurrency (Eşzamanlı Başlatma) Kilidi Tablosu
-- Render free plan veya harici cron-job kaynaklı çift process / soket
-- çakışmalarını önlemek için kullanılır.
CREATE TABLE IF NOT EXISTS public.whatsapp_instance_locks (
  session_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  last_heartbeat TIMESTAMPTZ DEFAULT NOW()
);

-- Güvenlik / RLS (Row Level Security) - Anon key ile okuma/yazma izni
ALTER TABLE public.whatsapp_message_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_instance_locks ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_message_cache' AND policyname = 'Anon all whatsapp_message_cache'
  ) THEN
    CREATE POLICY "Anon all whatsapp_message_cache" ON public.whatsapp_message_cache FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_instance_locks' AND policyname = 'Anon all whatsapp_instance_locks'
  ) THEN
    CREATE POLICY "Anon all whatsapp_instance_locks" ON public.whatsapp_instance_locks FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
