#!/usr/bin/env bash
# 码境 CodeScope 环境部署器（macOS / Linux）
# 用法：bash deploy-env.sh gcc gpp clangformat
set -Eeuo pipefail

KNOWN=" node python3 bash gcc gpp java ruby swift go clangformat gofmt black npx latex biber ctex ssh "
if [ "$#" -eq 0 ]; then
  set -- python3 bash gcc gpp clangformat npx
fi

TOOLS=()
for tool in "$@"; do
  case "$KNOWN" in
    *" $tool "*) TOOLS+=("$tool") ;;
    *) printf '忽略未知工具：%s\n' "$tool" ;;
  esac
done

if [ "${#TOOLS[@]}" -eq 0 ]; then
  echo "没有需要部署的工具。"
  exit 0
fi

# macOS 图形环境常缺少登录 shell 的 PATH，先补 TeX 目录，便于正确判断“已安装”
if [ "$(uname -s)" = "Darwin" ]; then
  for texdir in /Library/TeX/texbin /usr/local/texlive/*/bin/*; do
    [ -d "$texdir" ] && case ":$PATH:" in *":$texdir:"*) ;; *) PATH="$texdir:$PATH" ;; esac
  done
  export PATH
fi

# 已经能解析到可执行文件的工具直接跳过，避免在已装 TeX Live / MacTeX 的机器上重复下载 4GB
SKIPPED=()
REMAIN=()
for tool in "${TOOLS[@]}"; do
  case "$tool" in
    node) bin=node ;; npx) bin=npx ;; python3) bin=python3 ;; bash) bin=bash ;;
    gcc) bin=gcc ;; gpp) bin=g++ ;; java) bin=javac ;; ruby) bin=ruby ;; swift) bin=swift ;;
    go|gofmt) bin=go ;; clangformat) bin=clang-format ;; black) bin=black ;;
    latex) bin=xelatex ;; biber) bin=biber ;; ctex) bin=kpsewhich ;; ssh) bin=ssh ;;
    *) bin="$tool" ;;
  esac
  if command -v "$bin" >/dev/null 2>&1; then
    printf '已安装，跳过：%s（%s：%s）\n' "$tool" "$bin" "$(command -v "$bin")"
    SKIPPED+=("$tool")
  else
    REMAIN+=("$tool")
  fi
done
if [ "${#SKIPPED[@]}" -gt 0 ] && [ "${#REMAIN[@]}" -eq 0 ]; then
  echo "所需工具均已安装，无需部署。"
  exit 0
fi
TOOLS=("${REMAIN[@]}")

contains_tool() {
  local wanted="$1" item
  for item in "${TOOLS[@]}"; do [ "$item" = "$wanted" ] && return 0; done
  return 1
}

add_unique() {
  local value="$1" item
  for item in "${PACKAGES[@]:-}"; do [ "$item" = "$value" ] && return; done
  PACKAGES+=("$value")
}

add_cask_unique() {
  local value="$1" item
  for item in "${CASKS[@]:-}"; do [ "$item" = "$value" ] && return; done
  CASKS+=("$value")
}

echo "========================================"
echo " 码境 CodeScope 环境部署"
echo " 系统：$(uname -s) $(uname -m)"
echo " 工具：${TOOLS[*]}"
echo "========================================"

PACKAGES=()
CASKS=()
NEED_BLACK=0
NEED_SWIFT=0

if [ "$(uname -s)" = "Darwin" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "未找到 Homebrew。请先安装：https://brew.sh/zh-cn/"
    exit 2
  fi
  for tool in "${TOOLS[@]}"; do
    case "$tool" in
      node|npx) add_unique node ;;
      python3) add_unique python ;;
      bash) add_unique bash ;;
      gcc|gpp)
        if ! xcode-select -p >/dev/null 2>&1; then
          echo "正在请求安装 Apple Command Line Tools…"
          xcode-select --install || true
          echo "请在系统弹窗完成安装后，再点一次环境检测。"
        fi
        ;;
      java) add_cask_unique temurin ;;
      ruby) add_unique ruby ;;
      go|gofmt) add_unique go ;;
      clangformat) add_unique clang-format ;;
      black) NEED_BLACK=1 ;;
      swift) NEED_SWIFT=1 ;;
      latex|biber|ctex) add_cask_unique mactex-no-gui ;;
      ssh) echo "OpenSSH 客户端由 macOS 自带。" ;;
    esac
  done
  if [ "${#PACKAGES[@]}" -gt 0 ]; then brew install "${PACKAGES[@]}"; fi
  if [ "${#CASKS[@]}" -gt 0 ]; then brew install --cask "${CASKS[@]}"; fi
else
  if command -v apt-get >/dev/null 2>&1; then PM=apt-get
  elif command -v dnf >/dev/null 2>&1; then PM=dnf
  elif command -v yum >/dev/null 2>&1; then PM=yum
  elif command -v pacman >/dev/null 2>&1; then PM=pacman
  elif command -v zypper >/dev/null 2>&1; then PM=zypper
  elif command -v apk >/dev/null 2>&1; then PM=apk
  else echo "未识别到 apt/dnf/yum/pacman/zypper/apk，无法自动部署。"; exit 2
  fi

  for tool in "${TOOLS[@]}"; do
    case "$PM:$tool" in
      apt-get:node|apt-get:npx) add_unique nodejs; add_unique npm ;;
      apt-get:python3) add_unique python3; add_unique python3-pip ;;
      apt-get:bash) add_unique bash ;;
      apt-get:gcc|apt-get:gpp) add_unique build-essential ;;
      apt-get:java) add_unique default-jdk ;;
      apt-get:ruby) add_unique ruby ;;
      apt-get:go|apt-get:gofmt) add_unique golang-go ;;
      apt-get:clangformat) add_unique clang-format ;;
      apt-get:latex) add_unique texlive-xetex; add_unique texlive-latex-extra; add_unique texlive-fonts-recommended; add_unique texlive-lang-chinese ;;
      apt-get:ctex) add_unique texlive-xetex; add_unique texlive-latex-extra; add_unique texlive-fonts-recommended; add_unique texlive-lang-chinese ;;
      apt-get:biber) add_unique biber ;;
      apt-get:ssh) add_unique openssh-client ;;
      dnf:node|dnf:npx|yum:node|yum:npx) add_unique nodejs; add_unique npm ;;
      dnf:python3|yum:python3) add_unique python3; add_unique python3-pip ;;
      dnf:bash|yum:bash) add_unique bash ;;
      dnf:gcc|yum:gcc) add_unique gcc; add_unique make ;;
      dnf:gpp|yum:gpp) add_unique gcc-c++; add_unique make ;;
      dnf:java) add_unique java-21-openjdk-devel ;;
      yum:java) add_unique java-17-openjdk-devel ;;
      dnf:ruby|yum:ruby) add_unique ruby ;;
      dnf:go|dnf:gofmt|yum:go|yum:gofmt) add_unique golang ;;
      dnf:clangformat) add_unique clang-tools-extra ;;
      yum:clangformat) add_unique clang ;;
      dnf:latex|yum:latex) add_unique texlive-xetex; add_unique texlive-collection-latexextra; add_unique texlive-ctex ;;
      dnf:ctex|yum:ctex) add_unique texlive-xetex; add_unique texlive-collection-latexextra; add_unique texlive-ctex ;;
      dnf:biber|yum:biber) add_unique biber ;;
      dnf:ssh|yum:ssh) add_unique openssh-clients ;;
      pacman:node|pacman:npx) add_unique nodejs; add_unique npm ;;
      pacman:python3) add_unique python; add_unique python-pip ;;
      pacman:bash) add_unique bash ;;
      pacman:gcc|pacman:gpp) add_unique base-devel ;;
      pacman:java) add_unique jdk-openjdk ;;
      pacman:ruby) add_unique ruby ;;
      pacman:go|pacman:gofmt) add_unique go ;;
      pacman:clangformat) add_unique clang ;;
      pacman:latex) add_unique texlive-bin; add_unique texlive-latexextra; add_unique texlive-fontsrecommended; add_unique texlive-langchinese ;;
      pacman:ctex) add_unique texlive-bin; add_unique texlive-latexextra; add_unique texlive-fontsrecommended; add_unique texlive-langchinese ;;
      pacman:ssh) add_unique openssh ;;
      pacman:biber) add_unique biber ;;
      zypper:node|zypper:npx) add_unique nodejs; add_unique npm ;;
      zypper:python3) add_unique python3; add_unique python3-pip ;;
      zypper:bash) add_unique bash ;;
      zypper:gcc) add_unique gcc; add_unique make ;;
      zypper:gpp) add_unique gcc-c++; add_unique make ;;
      zypper:java) add_unique java-17-openjdk-devel ;;
      zypper:ruby) add_unique ruby ;;
      zypper:go|zypper:gofmt) add_unique go ;;
      zypper:clangformat) add_unique clang-tools ;;
      zypper:latex) add_unique texlive-xetex; add_unique texlive-latexextra; add_unique texlive-ctex ;;
      zypper:ctex) add_unique texlive-xetex; add_unique texlive-latexextra; add_unique texlive-ctex ;;
      zypper:ssh) add_unique openssh-clients ;;
      zypper:biber) add_unique biber ;;
      apk:node|apk:npx) add_unique nodejs; add_unique npm ;;
      apk:python3) add_unique python3; add_unique py3-pip ;;
      apk:bash) add_unique bash ;;
      apk:gcc|apk:gpp) add_unique build-base ;;
      apk:java) add_unique openjdk17 ;;
      apk:ruby) add_unique ruby ;;
      apk:go|apk:gofmt) add_unique go ;;
      apk:clangformat) add_unique clang-extra-tools ;;
      apk:latex) add_unique texlive-xetex; add_unique texmf-dist-latexextra; add_unique texmf-dist-langchinese ;;
      apk:ctex) add_unique texlive-xetex; add_unique texmf-dist-latexextra; add_unique texmf-dist-langchinese ;;
      apk:ssh) add_unique openssh-client-default ;;
      apk:biber) add_unique biber ;;
      *:black) NEED_BLACK=1 ;;
      *:swift) NEED_SWIFT=1 ;;
    esac
  done

  if [ "${#PACKAGES[@]}" -gt 0 ]; then
    if [ "$(id -u)" -eq 0 ]; then SUDO=();
    elif command -v sudo >/dev/null 2>&1; then SUDO=(sudo);
    else echo "安装系统软件包需要 root 权限，但当前系统没有 sudo。"; exit 2; fi
    case "$PM" in
      apt-get) "${SUDO[@]}" apt-get update; "${SUDO[@]}" apt-get install -y "${PACKAGES[@]}" ;;
      dnf|yum) "${SUDO[@]}" "$PM" install -y "${PACKAGES[@]}" ;;
      pacman) "${SUDO[@]}" pacman -S --needed --noconfirm "${PACKAGES[@]}" ;;
      zypper) "${SUDO[@]}" zypper --non-interactive install "${PACKAGES[@]}" ;;
      apk) "${SUDO[@]}" apk add "${PACKAGES[@]}" ;;
    esac
  fi
fi

if [ "$NEED_BLACK" -eq 1 ]; then
  PYTHON="$(command -v python3 || command -v python || true)"
  if [ -z "$PYTHON" ]; then echo "Python 尚未就绪，暂时无法安装 black。"; exit 2; fi
  "$PYTHON" -m pip install --user black
fi

if [ "$NEED_SWIFT" -eq 1 ]; then
  echo "Swift 需要匹配发行版的官方工具链，请参考：https://swift.org/install/linux/"
fi

echo
echo "✅ 部署命令执行完成。回到环境检测面板点击“重新检测”。"
