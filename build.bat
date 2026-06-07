#!/bin/bash
# Build Hermes Token Monitor on Windows
# Prerequisites: Rust, Node.js, VS Build Tools

set -e

echo "=== Building Hermes Token Monitor ==="

# 1. Set up MSVC environment (adjust paths if VS installed elsewhere)
export VS_INSTALL="C:/Program Files/Microsoft Visual Studio/2022/BuildTools"
export MSVC_VER=$(ls "$VS_INSTALL/VC/Tools/MSVC/" | sort -V | tail -1)
export LIB="$VS_INSTALL/VC/Tools/MSVC/$MSVC_VER/lib/x64"
export LIB="$LIB;C:/Program Files (x86)/Windows Kits/10/Lib/10.0.26100.0/um/x64"
export LIB="$LIB;C:/Program Files (x86)/Windows Kits/10/Lib/10.0.26100.0/ucrt/x64"
export LIBPATH="$LIB"
export INCLUDE="C:/Program Files (x86)/Windows Kits/10/Include/10.0.26100.0/um"
export INCLUDE="$INCLUDE;C:/Program Files (x86)/Windows Kits/10/Include/10.0.26100.0/ucrt"
export INCLUDE="$INCLUDE;C:/Program Files (x86)/Windows Kits/10/Include/10.0.26100.0/shared"
export INCLUDE="$INCLUDE;$VS_INSTALL/VC/Tools/MSVC/$MSVC_VER/include"

# 2. Ensure Rust uses MSVC toolchain
rustup default stable-x86_64-pc-windows-msvc

# 3. Build
cd "$(dirname "$0")"
npm install
npx tauri build

echo "=== Build complete! ==="
echo "Installer: src-tauri/target/release/bundle/nsis/"
echo "MSI: src-tauri/target/release/bundle/msi/"
