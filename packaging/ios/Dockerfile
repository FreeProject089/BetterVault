# Application iOS construite avec xtool, sans Mac : Linux, ou Windows avec Docker.
#
#   docker build -t bettervault-ios packaging/ios
#   docker run --rm -it \
#     -v "$PWD:/src:ro" -v "$PWD/release/ios:/out" \
#     -v bettervault-xtool:/root \
#     -v "/chemin/vers/Xcode_27.1.xip:/Xcode.xip:ro" \
#     bettervault-ios
#
# Le volume bettervault-xtool garde le SDK iOS extrait d'Xcode.xip (plusieurs Go,
# une minute de travail) : Xcode.xip n'est plus nécessaire aux constructions suivantes.
FROM swift:6.4-noble

ARG XTOOL_VERSION=1.24.0
ARG XTOOL_SHA256=dbfd9d7216f077c84c171b688c4173c37c23ca76bf7fd185d1a9ae8a53dab59f

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git xz-utils unzip zip \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# xtool est livré en AppImage ; sans FUSE dans un conteneur, on l'extrait une fois
RUN curl -fsSL -o /tmp/xtool.AppImage \
      "https://github.com/xtool-org/xtool/releases/download/${XTOOL_VERSION}/xtool-x86_64.AppImage" \
    && echo "${XTOOL_SHA256}  /tmp/xtool.AppImage" | sha256sum -c - \
    && chmod +x /tmp/xtool.AppImage \
    && cd /opt && /tmp/xtool.AppImage --appimage-extract >/dev/null \
    && mv /opt/squashfs-root /opt/xtool \
    && ln -s /opt/xtool/AppRun /usr/local/bin/xtool \
    && rm /tmp/xtool.AppImage

COPY build.sh /usr/local/bin/build-bettervault-ios
RUN chmod +x /usr/local/bin/build-bettervault-ios
CMD ["build-bettervault-ios"]
