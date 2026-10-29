# Paquets Linux (.deb, .rpm, .AppImage) construits dans un conteneur, sans rien
# installer sur la machine : utile depuis Windows ou macOS, ou sans droits sudo.
#
#   docker build -t bettervault-linux packaging/linux
#   docker run --rm -v "$PWD:/src:ro" -v "$PWD/release/linux:/out" bettervault-linux
#
# Ubuntu 22.04, comme la CI : une glibc ancienne, donc des paquets qui
# s'installent aussi sur les distributions plus anciennes que la machine de build.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates git file xdg-utils rpm \
      libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libdbus-1-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable

COPY build.sh /usr/local/bin/build-bettervault
RUN chmod +x /usr/local/bin/build-bettervault
CMD ["build-bettervault"]
