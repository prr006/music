class YtmusicCli < Formula
  desc "YouTube Music player for your terminal"
  homepage "https://github.com/mammadovziya/ytmusic-player"
  url "https://github.com/mammadovziya/ytmusic-player/archive/refs/tags/v0.3.6.tar.gz"
  sha256 "9b8c71e74a1a2619a2e15a315d13ee2380eefe41b09f258933ca203080e047ce"
  license "MIT"

  depends_on "bun" => :build
  depends_on "mpv"
  depends_on "yt-dlp"

  def install
    system "bun", "install", "--no-save"
    system "bun", "build", "--compile", "src/index.ts", "--outfile", "ytmusic-player"
    bin.install "ytmusic-player"
    bin.install_symlink bin/"ytmusic-player" => "ym"
  end

  test do
    system "#{bin}/ytmusic-player", "--version"
  end
end
