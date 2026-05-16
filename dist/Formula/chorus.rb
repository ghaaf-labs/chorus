class Chorus < Formula
  desc "Multi-CLI agent collaboration toolkit"
  homepage "https://github.com/ghaaf-labs/chorus"
  url "https://registry.npmjs.org/@chorus/cli/-/cli-0.1.0.tgz"
  sha256 "84a123aee485c5bd89a346846615f2437a1721902302a45315ec1e0d8c4e3476"
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
