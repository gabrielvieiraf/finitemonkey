class Finitemonkey < Formula
  desc "Hooks that stop coding agents from saying done before the tests pass"
  homepage "https://github.com/gabrielvieiraf/finitemonkey"
  version "1.2.3"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/gabrielvieiraf/finitemonkey/releases/download/v1.2.3/finitemonkey-1.2.3-darwin-arm64.tar.gz"
      sha256 "9d843a1f0386a330c8deac4d726da60043612f6e3e8be6a37ff4fee107e20e60"
    end
    on_intel do
      url "https://github.com/gabrielvieiraf/finitemonkey/releases/download/v1.2.3/finitemonkey-1.2.3-darwin-x64.tar.gz"
      sha256 "2d3f87d72391553b2216efeea93bb21b2a939f5061958637076b59a7cda358cd"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/gabrielvieiraf/finitemonkey/releases/download/v1.2.3/finitemonkey-1.2.3-linux-arm64.tar.gz"
      sha256 "cc75cc9092eba60a7692cc557b490cc88bbf8b0b3e608ae1b4f67b76b7225b70"
    end
    on_intel do
      url "https://github.com/gabrielvieiraf/finitemonkey/releases/download/v1.2.3/finitemonkey-1.2.3-linux-x64.tar.gz"
      sha256 "931862b39dc9e8e9146118e66532aacf7b9daef9847b695ce9e74708a281a7e9"
    end
  end

  def install
    bin.install "finitemonkey"
    bin.install_symlink "finitemonkey" => "fm"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/finitemonkey --version")
  end
end
