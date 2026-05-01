FROM python:3.11-bookworm AS builder

ARG ENV=prod
ENV ENV=$ENV

RUN apt-get update && apt-get -y install curl libpq-dev

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | bash -s -- -y
ENV PATH="/root/.cargo/bin:$PATH"

RUN curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to /usr/bin

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PIP_DEFAULT_TIMEOUT=100 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=1 \
    POETRY_VIRTUALENVS_CREATE=1

RUN pip install poetry==1.8.3

COPY wren-core-py /wren-core-py
COPY wren-core /wren-core
COPY wren-core-base /wren-core-base

WORKDIR /app
COPY ibis-server /app
RUN just install --without dev

FROM python:3.11-slim-bookworm AS runtime

RUN apt-get update \
    && apt-get install -y curl gnupg \
    && curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > /usr/share/keyrings/microsoft-prod.gpg \
    && curl https://packages.microsoft.com/config/debian/12/prod.list | tee /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update

RUN ACCEPT_EULA=Y apt-get -y install unixodbc-dev msodbcsql18

RUN apt-get install -y default-libmysqlclient-dev

RUN apt-get -y install libpq-dev \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    REMOTE_FUNCTION_LIST_PATH=/resources/function_list

COPY --from=builder ${VIRTUAL_ENV} ${VIRTUAL_ENV}
COPY --from=builder /app/app /app/app
COPY --from=builder /app/resources /resources

WORKDIR /app

EXPOSE 8000

CMD ["fastapi", "run"]
