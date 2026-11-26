# Seminer Özgeçmiş Hazırlayıcı

Bir ismi Wikipedia, Wikidata, akademik veritabanları ve sosyal medyada (Instagram, LinkedIn, X, TikTok, Facebook, YouTube, Threads) arar. Doğru kişiyi fotoğraftan onaylatır ve seminerde okunacak kısa, madde madde ya da akıcı bir tanıtım metni hazırlar.

## Tek tıkla kurulum

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kkyelox/Davet/tree/ozgecmis-hazirlayici/ozgecmis-hazirlayici)

1. [serper.dev](https://serper.dev) adresine üye ol ve API anahtarını kopyala (ücretsiz 2.500 arama, kredi kartı istemiyor).
2. Yukarıdaki düğmeye bas, Cloudflare ve GitHub ile giriş yap.
3. Kurulum ekranı iki şey soracak:
   - `SERPER_KEY`: serper.dev anahtarın
   - `SITE_PASSWORD`: siteyi açarken gireceğin şifre
4. Kurulum bitince sitenin adresi `https://ozgecmis-hazirlayici.<hesabın>.workers.dev` olur. Telefonda aç, şifreni bir kez gir, hazır.

İsteğe bağlı: yapay zekâyla yeniden yazma ve kurum sitelerinden teyit için Cloudflare panelinde Worker'ın **Settings → Variables and Secrets** bölümüne `ANTHROPIC_API_KEY` ekle.

## Yapı

- `public/index.html`: site (tek dosya, mobil uyumlu)
- `src/index.js`: arama sunucusu (`/api/search`), yapay zekâ aracısı (`/api/claude`), şifre kontrolü
- Arama yalnızca arama motorlarının herkese açık gösterdiği profil bilgilerini kullanır: profil adresi, biyografi ve profil fotoğrafı.
