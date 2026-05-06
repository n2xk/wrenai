# WrenAI 本机开发测试快速恢复

适合场景：

- 想最快恢复当前本机开发测试环境
- 需要跑问数、图表、看板、数据表等 UI E2E 验证
- 需要使用 TiDB demo 和 PM2 管理的源码 UI / AI Service

当前标准入口是 `test-env`。旧的 `dev-up.sh` 只保留为 dependency-only 高级入口，不再作为主开发路径。

完整说明见：`docs/local-source-acceptance.md` 和 `docker/README.md`。

---

## 1. 准备本地私密配置

```bash
cp docker/env/test.example docker/env/test.local
# 编辑 docker/env/test.local，填 OPENROUTER_API_KEY / OPENAI_API_KEY 等
```

`docker/env/test.local` 不提交。它会被 PM2 配置读取，用于 `test-ui` 和 `test-ai-service`。

---

## 2. 启动本机开发测试环境

```bash
./docker/scripts/test-env-up.sh
```

这会启动：

- Docker：PostgreSQL、engine、ibis-server、Trino、TiDB demo
- PM2：`test-ai-service`、`test-ui`

默认访问：

```text
UI:          http://127.0.0.1:3002
AI Service: http://127.0.0.1:5555
TiDB demo:  127.0.0.1:4000
PostgreSQL: 127.0.0.1:9432
Engine:     127.0.0.1:8080
Ibis:       127.0.0.1:8000
Trino:      127.0.0.1:8081
```

---

## 3. 常用操作

```bash
# 查看 Docker 依赖层
./docker/scripts/ps.sh

# 查看 PM2 应用
pm2 status test-ai-service test-ui

# 重启 UI + AI Service
./docker/scripts/test-apps-restart.sh all

# 只重启 UI
./docker/scripts/test-apps-restart.sh ui

# 只重启 AI Service
./docker/scripts/test-apps-restart.sh ai

# 停止完整开发测试环境
./docker/scripts/test-env-down.sh
```

---

## 4. 健康检查

```bash
curl http://127.0.0.1:5555/health
```

预期：

```json
{"status":"ok"}
```

打开：

```text
http://127.0.0.1:3002
```

---

## 5. 只启动依赖层（高级 / 诊断）

仅当你明确需要手动用 background terminal 启动 UI / AI Service 时才用：

```bash
./docker/scripts/dev-up.sh
```

它只启动 PostgreSQL、engine、ibis-server、Trino，不启动 TiDB，也不启动 UI / AI Service。
