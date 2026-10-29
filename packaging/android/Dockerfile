# APK Android construit dans un conteneur : mêmes versions que la CI (JDK 17,
# NDK 27.1), sans Android Studio ni SDK sur la machine.
#
#   docker build -t bettervault-android packaging/android
#   docker run --rm -v "$PWD:/src:ro" -v "$PWD/release/android:/out" bettervault-android
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl ca-certificates git unzip openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android-sdk
ENV NDK_HOME=/opt/android-sdk/ndk/27.1.12297006
ARG CMDLINE_TOOLS=13114758
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
    && curl -fsSL -o /tmp/tools.zip "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS}_latest.zip" \
    && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
    && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
    && rm /tmp/tools.zip \
    && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null \
    && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager \
         "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" >/dev/null

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

COPY build.sh /usr/local/bin/build-bettervault-android
RUN chmod +x /usr/local/bin/build-bettervault-android
CMD ["build-bettervault-android"]
