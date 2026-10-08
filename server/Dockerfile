FROM ubuntu:24.04

# add architecture
RUN dpkg --add-architecture i386 \
    && apt-get update >/dev/null

# libcod requirements
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
        g++-multilib \
        git \
    >/dev/null

# speex requirements
ARG enable_speex="false"
RUN if [ "$enable_speex" = "true" ]; then \
        apt-get install -y \
            git \
            libtool \
            build-essential \
            automake \
            g++-multilib \
            libogg-dev \
            libogg-dev:i386 \
            ffmpeg \
        >/dev/null; \
    fi

# cod2 runtime requirements
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
        libstdc++5:i386 \
        netcat-openbsd \
        libmysqlclient-dev:i386 \
        libsqlite3-dev:i386 \
        curl \
    >/dev/null

RUN apt-get clean >/dev/null

# compile speex
RUN if [ "$enable_speex" = "true" ]; then \
        git clone https://gitlab.xiph.org/xiph/speex.git && \
        cd speex && \
        git checkout tags/Speex-1.1.9 -b 1.1.9 && \
        env AUTOMAKE=automake ACLOCAL=aclocal LIBTOOLIZE=libtoolize \
            ./autogen.sh CFLAGS=-m32 CXXFLAGS=-m32 LDFLAGS=-m32 --build=x86_64-pc-linux-gnu --host=i686-pc-linux-gnu >/dev/null && \
        make >/dev/null && \
        make install >/dev/null && \
        ldconfig >/dev/null && \
        cd / && \
        rm -rf /speex && \
        speexdec --version && \
        speexenc --version; \
    fi

# compile libcod: upstream zk_libcod at the pinned commit, plus our patch and extra files
COPY server/UPSTREAM server/hooks.patch /tmp/
RUN git init -q /libcod \
    && git -C /libcod fetch -q --depth 1 https://github.com/ibuddieat/zk_libcod.git "$(cat /tmp/UPSTREAM)" \
    && git -C /libcod checkout -q FETCH_HEAD \
    && git -C /libcod apply /tmp/hooks.patch
COPY server/extra /libcod/code/extra

WORKDIR /libcod/code

ARG cod2_patch="0"
ARG mysql_variant="1"
ARG enable_unsafe="true"
RUN ./doit.sh \
        "$([ "$mysql_variant" = 0 ] && echo nomysql || echo "mysql${mysql_variant}")" \
        "$([ "$enable_speex" = true ] || echo nospeex)" \
        "$([ "$enable_unsafe" = true ] && echo unsafe)"

RUN mkdir /cod2

# Set user and group
ARG user=cod2
ARG group=cod2
ARG uid=1001
ARG gid=1002
RUN groupadd -g ${gid} ${group}
RUN useradd -u ${uid} -g ${group} -s /bin/sh -d /cod2 ${user}

# cod2 server files
WORKDIR /cod2
RUN cp /libcod/code/bin/libcod2.so libcod.so
COPY server/cod2_lnxded/1_${cod2_patch} cod2_lnxded
COPY server/entrypoint.sh ./

# pre-create volume directories
RUN mkdir -p /cod2/main
RUN mkdir -p /cod2/library
RUN mkdir -p /cod2/home

# change owner
RUN chown -R ${user}:${group} /cod2
RUN ls -la /cod2

# cleanup
RUN chmod -R +w /libcod && \
    rm -rf /libcod

# Switch to user
USER ${uid}:${gid}

# check server info every 5 seconds 7 times (check, if your server can change a map without restarting container)
HEALTHCHECK --interval=5s --timeout=3s --retries=7 \
    CMD printf '\377\377\377\377getinfo' | nc -w 1 -u 127.0.0.1 "${COD2_SET_net_port:-28960}" | grep -q .

# start script
ENTRYPOINT /cod2/entrypoint.sh
