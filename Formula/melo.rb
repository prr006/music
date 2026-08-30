class Melo < Formula
  desc "MELO — YouTube music player for your terminal"
  homepage "https://github.com/prr006/music"
  url "https://github.com/prr006/music/archive/refs/tags/v0.3.6.tar.gz"
  sha256 "9b8c71e74a1a2619a2e15a315d13ee2380eefe41b09f258933ca203080e047ce"
  license "MIT"

  depends_on "bun" => :build
  depends_on "mpv"
  depends_on "yt-dlp"

  def install
    system "bun", "install", "--no-save"
    system "bun", "build", "--compile", "src/index.ts", "--outfile", "melo"
    bin.install "melo"
  end

  test do
    system "#{bin}/melo", "--version"
  end
end
