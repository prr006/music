---
title: Knowledge Base Home
tags:
  - kb
  - project
  - index
aliases:
  - MELO KB
  - Ana Sayfa
---

# MELO Knowledge Base

Bu vault, MELO projesinin urun, mimari, akis ve operasyon bilgisini tek yerde toplar.

## Baslangic

- [[Product Overview]]
- [[Architecture]]
- [[Runtime Flow]]
- [[Data Model]]
- [[Development Workflow]]
- [[Roadmap]]
- `Tasks.base`

> [!note]
> Bu knowledge base, repo icindeki mevcut kod ve dokumantasyon baz alinarak hazirlandi.

## Hedef

- Projeye yeni giren birinin sistemi hizli anlamasi
- Kod tarafindaki sorumluluklari dosya bazinda gorebilmek
- Gelistirme ve release akislarini tek yerde toplamak
- Planlanan isleri mevcut urun davranisindan ayirmak

## Hizli Baglam

- Urun: MELO — terminal ve masaustu YouTube muzik oynatici
- Runtime: Bun + `mpv` + `yt-dlp`
- Giris noktasi: `src/index.ts` (TUI) / `src/backend-headless.ts` (GUI)
- UI: ANSI terminal render katmani (`src/ui.ts`) ve Electron renderer
- Oynatici kontrolu: mpv IPC (`src/melo/playback/mpv-player.ts`)
- Arama ve mix: `yt-dlp` YouTube wrapper (`src/melo/search`, `src/melo/radio`)
- Kalici veri: `~/.config/melo` (ilk acilista eski `ytmusic-cli` klasorunden kopyalanir)

## Kaynaklar

- README: `README.md`
- Release notlari: `CHANGELOG.md`
- Release akisi: [[Releasing]]
- Manuel testler: [[Manual Test Checklist]]
- Task tracker: `Tasks.base`
- Tarihsel kaynak path'ler task notlarindaki `source_path` alaninda tutuluyor
