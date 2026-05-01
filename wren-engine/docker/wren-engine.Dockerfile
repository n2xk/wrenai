FROM maven:3.9.9-eclipse-temurin-21 AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src/wren-core-legacy
COPY wren-core-legacy/ ./

RUN git init \
    && git config user.email local-build@wren.ai \
    && git config user.name local-build \
    && git add . \
    && git commit -m "local build snapshot" >/dev/null \
    && unset MAVEN_CONFIG \
    && chmod +x mvnw \
    && ./mvnw clean install -B -DskipTests -P exec-jar \
    && WREN_VERSION="$(./mvnw --quiet help:evaluate -Dexpression=project.version -DforceStdout)" \
    && cp "wren-server/target/wren-server-${WREN_VERSION}-executable.jar" /tmp/wren-server-executable.jar

FROM eclipse-temurin:21
LABEL maintainer="https://www.canner.io/"

WORKDIR /usr/src/app

RUN apt update \
    && apt -y install curl gpg lsb-release \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg \
    && echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" | tee /etc/apt/sources.list.d/pgdg.list \
    && apt update \
    && apt -y install postgresql-client-13 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /tmp/wren-server-executable.jar ./wren-server-executable.jar
COPY wren-core-legacy/docker/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

ENV WREN_JAR=wren-server-executable.jar

CMD ./entrypoint.sh ${WREN_JAR} ${MAX_HEAP_SIZE} ${MIN_HEAP_SIZE}
