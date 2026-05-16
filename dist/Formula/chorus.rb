class Chorus < Formula
  desc "Multi-CLI agent collaboration toolkit"
  homepage "https://github.com/ghaaf-labs/chorus"
  url "https://registry.npmjs.org/@chorus/cli/-/cli-0.1.0.tgz"
  sha256 "dca9d53051c052ad3276047daab93e1e4c7aa997db919d316ab7dd225024c968"
  license "Apache-2.0"

  depends_on "node@24"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink libexec/"bin/chorus"
  end

  test do
    assert_match "chorus 0.1.0", shell_output("#{bin}/chorus version")
  end
end
