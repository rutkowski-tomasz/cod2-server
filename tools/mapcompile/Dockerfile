FROM debian:bookworm-slim
RUN dpkg --add-architecture i386 && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    wine wine32 libwine:i386 msitools cabextract xvfb xauth zip ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*
ENV WINEDEBUG=-all WINEARCH=win32 WINEPREFIX=/wine
RUN wineboot -i >/dev/null 2>&1 || true
RUN wget -q -O /usr/local/bin/winetricks https://raw.githubusercontent.com/Winetricks/winetricks/20240105/src/winetricks \
    && chmod +x /usr/local/bin/winetricks \
    && xvfb-run -a winetricks -q d3dx9_27 >/dev/null 2>&1 \
    && test -f /wine/drive_c/windows/system32/d3dx9_27.dll
RUN wget -q -O /tmp/modtools.exe "https://archive.org/download/call-of-duty-2-files/Files/Mod%20Tools/CallofDuty2ModTools.exe" \
    && echo "f58f149811577e1a5bf9e2c174fada43  /tmp/modtools.exe" | md5sum -c - \
    && (xvfb-run -a wine /tmp/modtools.exe /s /b"C:\\extract" /v"/qn" >/dev/null 2>&1 || true) \
    && msiextract -C /tmp/msi "/wine/drive_c/extract/Call of Duty(R) 2 Mod Tools.msi" >/dev/null \
    && mv "/tmp/msi/Program Files/Call of Duty 2" /cod2 \
    && rm -rf /tmp/modtools.exe /tmp/msi /wine/drive_c/extract
WORKDIR /cod2/bin
