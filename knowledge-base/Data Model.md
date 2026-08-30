---
title: Data Model
tags:
  - kb
  - data
  - persistence
---

# Data Model

## Track

Kaynak: `src/types.ts`

```ts
interface Track {
  id: string;
  title: string;
  url: string;
  duration?: number;
  uploader?: string;
}
```

## Playlist

```ts
interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: string;
}
```

## Diskte Tutulan Veriler

- `~/.config/melo/favorites.json`
- `~/.config/melo/playlists.json`
- `~/.config/melo/history.json`
- `~/.config/melo/downloads.json`
- `~/.config/melo/settings.json`

## Veri Davranislari

- Favoriler `Track[]` olarak saklanir
- Playlistler `Playlist[]` olarak saklanir
- Playlist id degeri `Date.now().toString(36)` ile uretilir
- Ayni track ayni playlist'e iki kez eklenmez

## Sinirlar

> [!warning]
> Dosya tabanli persistence basit ve yeterli, ancak eszamanli yazim, schema versioning ve bozuk JSON recovery gibi durumlar icin gelismis koruma sunmuyor.

## Muhtemel Evrim Alanlari

- `config.json` eklenerek genel ayarlarin ayrilmasi
- Dil tercihi gibi kullanici ayarlarinin kalici hale getirilmesi
- Daha net migration/versionlama yapisi
