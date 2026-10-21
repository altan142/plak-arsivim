# Plak Arşivim — Kurulum

Uygulamanın adresi: **https://altan142.github.io/plak-arsivim/**

`config.js` boş kaldıkça uygulama "yerel modda" çalışır ve kayıtları sadece o cihazda tutar. Firebase bağlanınca senkron açılır. O sırada yerelde kayıt varsa menüdeki **"Bu cihazdaki kayıtları hesaba taşı"** ile aktarabilirsiniz.

## 1. GitHub Pages
Repo: https://github.com/altan142/plak-arsivim → **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main**, **/ (root)** → **Save**.

## 2. Senkron için Firebase

### 2.1 Proje
https://console.firebase.google.com → **Proje oluştur** → ad: `plak-arsivim` → Google Analytics kapalı → oluştur.

### 2.2 Google ile giriş
**Build → Authentication → Get started → Sign-in method → Google → Enable** → destek e-postası seçin → **Save**.

### 2.3 Veritabanı
**Build → Firestore Database → Create database** → Avrupa konumu → **Production mode**.
**Rules** sekmesine `firestore.rules` dosyasının içeriğini yapıştırın → **Publish**. Bu kural plaklarınızı sadece sizin hesabınızın okuyup yazmasını sağlar.

### 2.4 Siteyi yetkilendirme
**Authentication → Settings → Authorized domains → Add domain** → `altan142.github.io`

### 2.5 Ayarları uygulamaya koyma
**Project settings → Your apps → Web (`</>`)** → takma ad `plak-arsivim` → **Register app**. Görünen `firebaseConfig` nesnesini `config.js` içindeki `window.FIREBASE_CONFIG = null;` yerine yazın.
`apiKey` gizli değildir; güvenliği 2.3'teki kural sağlar.

## 3. Cihazlara kurma
- **Bilgisayar (Chrome / Edge):** adresi açın → adres çubuğundaki **Yükle** simgesi.
- **Android (Chrome):** **⋮ → Uygulamayı yükle / Ana ekrana ekle**.
- **iPhone (Safari):** **Paylaş → Ana Ekrana Ekle**.

## Kullanım
- Plak eklerken albüm adı ve sanatçı yeterli. **Bilgileri ve kapağı bul** sonuçları kaydetmeden önce gösterir; ◀ ▶ ile başka kapak seçilir. Butona basmadan kaydederseniz bilgiler arka planda doldurulur.
- Kaynaklar: **MusicBrainz** (tarih, şarkı listesi, plak şirketi), **Wikidata/Wikipedia** (tür, yapımcı, link, özet), **Cover Art Archive** ve **iTunes** (kapak).
- **Menü → Eksik kapak ve bilgileri bul:** eksikleri tek seferde tamamlar.
- **Menü → Yedek indir:** tüm arşivi `.json` olarak indirir.
- İnternet yokken de açılır; değişiklikler bağlantı gelince eşitlenir.

## Güncelleme
Dosyalar bu repoda. Bir dosya değişince uygulama bir sonraki açılışta yeni sürümü alır.
