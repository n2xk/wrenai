# WrenAI 本机开发测试启动与验收手册

当前本机标准环境是 `test-env`：Docker 负责依赖层和 TiDB demo，PM2 负责源码 UI / AI Service。它同时用于日常开发验证和 `docs/业务需求/问数回归测试计划.md` 的严格 UI E2E 回归。

旧的 `dev-up.sh` 仅保留为 dependency-only 高级入口，不再作为主开发路径。

---

## 1. 运行形态

```text
用户 / MCP Playwright
  ↓
test-ui 3002（PM2 + wren-ui 源码）
  ↓
test-ai-service 5555（PM2 + wren-ai-service 源码）
  ↓
Docker 依赖层：engine 8080 / ibis-server 8000 / Trino 8081
  ↓
PostgreSQL 9432 / TiDB demo 4000
```

---

## 2. 首次准备

```bash
cp docker/env/test.example docker/env/test.local
# 编辑 docker/env/test.local，填 OPENROUTER_API_KEY / OPENAI_API_KEY 等
```

`docker/env/test.local` 是本地私密文件，不提交。PM2 配置 `docker/pm2.test.config.cjs` 会优先读取它。

---

## 3. 启动完整开发测试环境

```bash
./docker/scripts/test-env-up.sh
```

成功后应看到：

- Docker 容器：`local-postgres-1`、`local-engine-1`、`local-ibis-server-1`、`local-trino-1`、`local-tidb-demo`
- PM2 进程：`test-ai-service`、`test-ui`

检查：

```bash
./docker/scripts/ps.sh
pm2 status test-ai-service test-ui
curl http://127.0.0.1:5555/health
```

---

## 4. 默认端口

```text
UI:          http://127.0.0.1:3002
AI Service: http://127.0.0.1:5555
TiDB demo:  127.0.0.1:4000，status 127.0.0.1:10080
PostgreSQL: 127.0.0.1:9432
Engine:     127.0.0.1:8080，SQL port 127.0.0.1:7432
Ibis:       127.0.0.1:8000
Trino:      127.0.0.1:8081
```

---

## 5. 应用重启

```bash
# 重启 UI + AI Service
./docker/scripts/test-apps-restart.sh all

# 只重启 UI
./docker/scripts/test-apps-restart.sh ui

# 只重启 AI Service
./docker/scripts/test-apps-restart.sh ai
```

如果 PM2 进程不存在，脚本会自动从 `docker/pm2.test.config.cjs` 启动。

---

## 6. 最小验收

1. 打开：

```text
http://127.0.0.1:3002
```

2. 登录 / 进入当前 workspace。
3. 确认知识库、对话历史、数据看板、数据表页面可打开。
4. 发送一条简单问数，确认：
   - UI 创建 thread / asking task / thread response
   - AI Service 返回结果或明确的补充信息表单
   - 历史对话中可以看到该记录

执行 `docs/业务需求/问数回归测试计划.md` 时必须走严格 UI E2E 口径：优先用 MCP Playwright / Chrome 操作 UI；若使用 API 自动化，也必须使用 UI 同源产品链路 API，并完成 asking task -> thread / thread_response 持久化绑定。

---

## 7. 停止环境

```bash
./docker/scripts/test-env-down.sh
```

这会停止 PM2 管理的测试应用进程、停止 TiDB demo，并 down 掉本地依赖层。

---

## 8. 只启动依赖层（高级 / 诊断）

```bash
./docker/scripts/dev-up.sh
```

它只启动 PostgreSQL、engine、ibis-server、Trino，不启动 TiDB demo，也不启动 UI / AI Service。仅当你明确需要手动用 background terminal 启动源码应用时使用。
