---
title: Manuel Test Checklist
tags:
  - kb
  - testing
---

# Manuel Test Checklist

Her release oncesi bu listeyi kontrol et.
`bun run src/index.ts` ile uygulamayi baslat.

## Arama

- [ ] Sarki adi yazinca sonuclar listelenir
- [ ] Bos arama yapinca bir sey olmaz
- [ ] Sonuc bulunamazsa uyari gosterilir
- [ ] `melo -s alors on danse` en yaxsi neticeni birbasa caldirir
- [ ] Player artiq aciq olanda `melo -s alors on danse` eyni prosesde yeni mahnini caldirir
- [ ] Player aciq olmayanda `melo play alors on danse` yeni player basladir ve mahnini caldirir
- [ ] `melo --search "Alors on danse"` uzun option ile eyni qaydada calisir
- [ ] `melo -s` song adi olmadan istifade edilende usage mesaji ve non-zero exit code qaytarir

## CLI Remote Control

- [ ] `melo mute` ve `melo m` mute rejimini toggle edir
- [ ] `melo next` / `melo n` ve `melo prev` / `melo p` queue-history sirasini idare edir
- [ ] `melo pause`, `melo resume` ve `melo toggle` / `melo t` playback halini deyisir
- [ ] `melo volume 50`, `melo volume +10` ve `melo volume -10` sesi dogru limitlerle deyisir
- [ ] `melo seek +10` ve `melo seek -10` nisbi seek edir
- [ ] `melo now` / `melo i` cari mahnini, `melo status` ise player veziyyetini gosterir
- [ ] `melo shuffle on`, `melo shuffle off` ve `melo x` shuffle rejimini idare edir
- [ ] `melo repeat off`, `melo repeat one` ve `melo repeat all` repeat rejimini idare edir
- [ ] `melo favorite` / `melo f` cari mahninin favorite veziyyetini toggle edir
- [ ] `melo download` / `melo d` cari mahnini download edir ve duplicate download baslatmir
- [ ] `melo queue` sirani gosterir, `melo queue clear` sirani temizleyir
- [ ] `melo stop` playback-i dayandirir amma player prosesini aciq saxlayir
- [ ] `melo quit` / `melo q` player-i ve control socket-i temiz baglayir
- [ ] Player aciq olmayanda play/search xaric remote command aydin xeta ve non-zero exit code qaytarir
- [ ] Ikinci `melo` prosesi acilanda movcud player socket-i silinmir

## Arama Sonuclari

- [ ] UP/DOWN ile sonuclar arasinda gezinilir
- [ ] Enter ile secilen sarki calmaya baslar
- [ ] Q ile arama ekranina doner

## Player

- [ ] Secilen sarki basarili sekilde calar
- [ ] Sarki adi ekranda gosterilir
- [ ] Progress bar ilerler
- [ ] Sure bilgisi (gecen/toplam) dogru gosterilir
- [ ] Player ekrani titremeden guncellenir (flicker yok)

## Duraklat / Devam

- [ ] Space ile sarki duraklar
- [ ] Tekrar Space ile devam eder
- [ ] Durum metni degisir (Caliyor / Duraklatildi)

## Seek

- [ ] Sag ok ile 10 saniye ileri sarar
- [ ] Sol ok ile 10 saniye geri sarar

## Sonraki Sarki (N)

- [ ] N ile siradaki sarkiya gecer
- [ ] Queue bossa N bir sey yapmaz

## Onceki Sarki (P)

- [ ] P ile onceki sarkiya doner
- [ ] History bossa P bir sey yapmaz
- [ ] P ile geri donunce N ile tekrar ileriye gidebilir
- [ ] Birden fazla P ile sirayla geriye gidebilir

## Mix / Queue

- [ ] Sarki secildikten sonra mix yuklenir
- [ ] Sirada bekleyen sarkilar ekranda gosterilir
- [ ] Sarki bitince otomatik sonrakine gecer
- [ ] Queue azalinca yeni mix yuklenir

## Favoriler

- [ ] F ile calan sarki favorilere eklenir (kirmizi kalp gosterilir)
- [ ] F ile tekrar basilinca favorilerden cikarilir (kalp kaybolur)
- [ ] L ile favori listesi ekranina gidilir
- [ ] Favori listesinde UP/DOWN ile gezinilir
- [ ] Favori listesinde Enter ile sarki calinir
- [ ] Favori listesinde Q ile player'a geri doner
- [ ] Favoriler uygulama kapatilip acildiktan sonra da korunur
- [ ] Favori yokken L bir sey yapmaz
- [ ] Arama ekraninda (query bos iken) L ile favori listesine gidilir
- [ ] Arama ekraninda favori varsa "L  Favoriler" ipucu gosterilir
- [ ] Arama ekraninda playlist varsa "O  Playlistler" ipucu gosterilir
- [ ] Arama ekraninda (query bos iken) O ile playlist listesine gidilir
- [ ] Playlist yokken O bir sey yapmaz
- [ ] Favori listesinden Q ile arama ekranina geri doner (player yoksa)

## Playlistler

### Playlist Olusturma
- [ ] O ile playlist listesi ekranina gidilir
- [ ] Playlist listesi bos iken "Henuz playlist yok" mesaji gosterilir
- [ ] C ile yeni playlist olusturma ekranina gidilir
- [ ] Isim yazilip Enter ile playlist olusturulur
- [ ] Esc ile playlist olusturma iptal edilir
- [ ] Olusturulan playlist listede gosterilir

### Playlist'e Sarki Ekleme
- [ ] A ile calan sarki icin playlist secici acilir
- [ ] Playlist secici ekraninda sarkinin adi gosterilir
- [ ] UP/DOWN ile playlistler arasinda gezinilir
- [ ] Enter ile secilen playlist'e sarki eklenir
- [ ] Ayni sarki tekrar eklenmeye calisilirsa eklenmez (duplicate korunma)
- [ ] C ile playlist secici ekraninda yeni playlist olusturulabilir
- [ ] Q veya Esc ile playlist secici iptal edilip player'a donulur

### Playlist Goruntuleme
- [ ] O ile playlist listesi ekranina gidilir
- [ ] UP/DOWN ile playlistler arasinda gezinilir
- [ ] Enter ile playlist detayina gidilir
- [ ] Playlist detayinda sarkilar listelenir
- [ ] Bos playlist'te "Bu playlist bos" mesaji gosterilir
- [ ] Playlist detayinda UP/DOWN ile sarkilar arasinda gezinilir
- [ ] Playlist detayinda Enter ile sarki calinir

### Playlist Silme
- [ ] Playlist listesinde D ile playlist silinir
- [ ] Playlist detayinda D ile sarki playlistten silinir

### Playlist Yeniden Adlandirma
- [ ] Playlist listesinde R ile yeniden adlandirma ekranina gidilir
- [ ] Mevcut playlist ismi gosterilir ve uzerine yazilabilir
- [ ] Enter ile yeni isim kaydedilir ve playlist listesine donulur
- [ ] Esc ile isim degisikligi iptal edilir ve playlist listesine donulur
- [ ] Bos isim ile Enter'a basilinca bir sey olmaz
- [ ] Degisiklik uygulama kapatilip acildiktan sonra da korunur (playlists.json)
- [ ] Playlist yokken R bir sey yapmaz

### Playlist Kuyruk Yonetimi
- [ ] Playlist detayinda bir sarki secildiginde, sonraki playlist sarkilari kuyrukta gosterilir
- [ ] Kuyrukta once playlist sarkilari calinir
- [ ] Playlist sarkilari bitince YouTube Mix ile devam edilir
- [ ] Shuffle aktifken playlist sarkilari da karistirilir
- [ ] N ile sonraki sarkiya gecildiginde playlist sirasi korunur
- [ ] Mix'ten gelen sarkilar playlist'teki sarkilarin uzerine yazilmaz

### Playlist Navigasyon
- [ ] Playlist detayinda Q ile playlist listesine doner
- [ ] Playlist listesinde Q ile player'a doner (sarki caliyorsa)
- [ ] Playlist listesinde Q ile arama ekranina doner (sarki calmiyorsa)
- [ ] Playlistler uygulama kapatilip acildiktan sonra da korunur

## Shuffle (Karistirma)

- [ ] X ile shuffle modu acilir (ekranda 🔀 ikonu gosterilir)
- [ ] X ile tekrar basilinca shuffle kapanir (ikon kaybolur)
- [ ] Shuffle acildiginda mevcut kuyruk karistirilir
- [ ] Shuffle aktifken yeni mix yuklendiginde de karistirma uygulanir

## Volume Control

- [ ] + veya = ile ses seviyesi 5 birim artar
- [ ] - veya _ ile ses seviyesi 5 birim azalir
- [ ] Ses seviyesi 0-100 araliginda sinirli kalir
- [ ] Mevcut ses seviyesi player ekraninda gosterilir

## Dil ve Yardim

- [ ] G ile dil secici acilir ve EN/AZ/TR/ES/DE/FR/RU secenekleri listelenir
- [ ] Enter ile secilen dil kaydedilir ve UI metinleri guncellenir
- [ ] H ile player, arama sonuclari ve liste ekranlarinda yardim ekrani acilir
- [ ] Yardim ekranindan Q, Esc veya H ile onceki ekrana donulur

## Gizlilik / Guvenlik

- [ ] `yt-dlp` arama, mix ve indirme komutlari user config, cache ve cookies olmadan calisir
- [ ] `mpv` user config, disk cache, resume file, cookies ve watch history olmadan baslar
- [ ] `MELO_PROXY` ayarlandiginda yt-dlp proxy argumani alir

## Windows

- [ ] Temiz Windows ortaminda `npm install -g melo` eksik `mpv` ve `yt-dlp` bagimliliklarini `winget` ile kurmaya calisir
- [ ] npm lifecycle scriptleri `--ignore-scripts` ile kapatildiginda eksik bagimliliklar `melo` ilk calismada kurulur
- [ ] Kurulumdan sonra uygulama ayni terminal oturumunda `mpv` ve `yt-dlp` executable'larini bulur
- [ ] `MELO_SKIP_AUTO_INSTALL=1` ayarliyken eksik bagimlilik varsa uygulama otomatik kurulum yapmadan manuel kurulum mesaji verir
- [ ] `npm install -g melo` sonrasi `melo` komutu uygulamayi baslatir
- [ ] Ilk sarki secildiginde mpv IPC hatasi olmadan calmaya baslar
- [ ] Favoriler, playlistler ve ayarlar `%APPDATA%\melo` altinda kalici olur

## macOS

- [ ] Temiz macOS ortaminda `npm install -g melo` eksik `mpv` ve `yt-dlp` bagimliliklarini Homebrew ile kurar
- [ ] `npm install -g melo` sonrasi `melo` komutu uygulamayi baslatir
- [ ] npm lifecycle scriptleri `--ignore-scripts` ile kapatildiginda eksik bagimliliklar `melo` ilk calismada kurulur
- [ ] Apple Silicon kurulumunda `melo-darwin-arm64` paketi kullanilir
- [ ] Intel kurulumunda `melo-darwin-x64` paketi kullanilir
- [ ] Ilk sarki secildiginde mpv IPC socket hatasi olmadan calmaya baslar

## Release Packaging

- [ ] `bun run check:packaging` root ve platform package metadata uyumunu dogrular
- [ ] `bun run check:tarballs` tum platform tarball'larinda executable oldugunu dogrular
- [ ] `bun run check:control-cli` compiled CLI-dan control socket-e command ve error response-larini dogrular
- [ ] `bun run check:npm-install` temiz npm kurulumunu, dependency lifecycle scriptini ve CLI versiyasini dogrular
- [ ] CI Linux, macOS ve Windows native binary smoke testlerini tamamlar
- [ ] Homebrew formula URL ve SHA256 deyerleri son GitHub release ile eslesir
- [ ] npm'deki `melo` ve tum platform paketleri yeni surumu gosterir
- [ ] Temiz global npm kurulumunda `melo --version` yayinlanan surumle eslesir

## Genel

- [ ] Bos Favorites ve Downloads ekranlarinda Enter veya ox duymeleri crash yaratmir
- [ ] Playlist listesinde yeni playlist yaradildiqdan sonra secim yeni playlist uzerinde qalir
- [ ] S ile player'dan arama ekranina doner
- [ ] Q ile uygulamadan temiz cikis yapar
- [ ] Ctrl+C ile uygulamadan cikis yapar

## Lightweight MELO (Tauri / WebView2)

- [ ] `npm --prefix gui run package:lightweight` produces a Windows NSIS installer
- [ ] Installer installs a MELO executable without Electron or a bundled Chromium runtime
- [ ] App launches on a clean Windows machine with WebView2 present
- [ ] No Python installation is required
- [ ] No system `yt-dlp` is required
- [ ] No system `mpv` is required
- [ ] Bundled `yt-dlp.exe` is used (remove `yt-dlp` from PATH and retest)
- [ ] Bundled `mpv.exe` is used (remove `mpv` from PATH and retest)
- [ ] Search works
- [ ] Playback works through mpv
- [ ] Next / previous / stop work
- [ ] Queue add/remove/play-next/reorder and play-from-queue work
- [ ] Favorites persist in the MELO config dir on Windows
- [ ] Playlists (including reorder, add/remove, play) persist in the MELO config dir
- [ ] Settings persist and close/minimize behavior is honoured
- [ ] Shuffle, repeat, volume and seek work
- [ ] Titlebar minimize hides to the tray; tray Show restores the window
- [ ] Closing the main window hides to the tray when configured
- [ ] Tray Quit exits and cleans up mpv / yt-dlp child processes
- [ ] Second launch focuses the existing single instance
- [ ] No orphaned `mpv.exe` or `yt-dlp.exe` remains after exit
- [ ] `node scripts/measure-package-size.js` reports installed/unpacked size and installer size separately
