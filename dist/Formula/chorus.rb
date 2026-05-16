class Chorus < Formula
  desc "Multi-CLI agent collaboration toolkit"
  homepage "https://github.com/ghaaf-labs/chorus"
  url "https://registry.npmjs.org/@chorus/cli/-/cli-0.1.0.tgz"
  sha256 "999f4b5dc607c80d7cfd8c25c36edd5c46400995c0cb0655ed92e42b9138e0fd"
  license "MIT"

  depends_on "node@24"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink libexec/"bin/chorus"
  end

  test do
    assert_match "chorus 0.1.0", shell_output("#{bin}/chorus version")
  end
end
