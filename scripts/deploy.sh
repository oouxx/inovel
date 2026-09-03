#!/usr/bin/env bash
# 部署 novel-reader:提交代码 → GitHub Actions 构建镜像(ghcr.io)→ 服务器经 mihomo 代理拉取 → docker compose 部署
# 用法: bash scripts/deploy.sh [--skip-clean] [--skip-push]
# 环境变量: HOST(ssh 别名,默认 vps-rn) / PORT(宿主端口,默认 8090) / REMOTE_DIR(默认 /opt/novel-reader)
set -euo pipefail

HOST="${HOST:-vps-rn}"
PORT="${PORT:-8090}"
REMOTE_DIR="${REMOTE_DIR:-/opt/novel-reader}"
SKIP_CLEAN=false
SKIP_PUSH=false
for arg in "$@"; do
  case "$arg" in
    --skip-clean) SKIP_CLEAN=true ;;
    --skip-push)  SKIP_PUSH=true ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."
echo "==> 目标: $HOST ($REMOTE_DIR),宿主端口 $PORT"

if [ "$SKIP_CLEAN" = false ]; then
  echo "==> [1/6] 清理测试数据"
  bun run scripts/clean-test-data.ts
else
  echo "==> [1/6] 跳过清理"
fi

if [ "$SKIP_PUSH" = false ]; then
  echo "==> [2/6] 提交并推送代码 (触发 GitHub Actions 构建镜像)"
  git add -A
  git commit -m "deploy: GitHub Actions 构建镜像 + compose 部署流水线" --no-verify || echo "    无新变更,跳过 commit"
  git push origin main
else
  echo "==> [2/6] 跳过推送"
fi

echo "==> [3/6] 等待 GitHub Actions 构建镜像"
sleep 3
RUN_ID=$(gh run list --workflow docker.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
echo "    run: https://github.com/oouxx/inovel/actions/runs/$RUN_ID"
gh run watch "$RUN_ID" --exit-status --interval 15 > /dev/null
echo "    ✓ 镜像构建完成"

echo "==> [4/6] 同步数据与 compose 配置到服务器"
ssh "$HOST" "mkdir -p $REMOTE_DIR/data/novels"
rsync -az --delete --exclude '.DS_Store' data/novels/ "$HOST:$REMOTE_DIR/data/novels/"
# 旧 WAL/SHM 必须先删,防止旧测试数据被重放进新库
ssh "$HOST" "rm -f $REMOTE_DIR/data/novel-reader.db-wal $REMOTE_DIR/data/novel-reader.db-shm"
rsync -az data/novel-reader.db "$HOST:$REMOTE_DIR/data/novel-reader.db"
rsync -az docker-compose.yml "$HOST:$REMOTE_DIR/"
echo "    同步完成"

echo "==> [5/6] 服务器拉取镜像并启动"
# 镜像刚发布可能有同步延迟,重试 3 次
ssh "$HOST" "cd $REMOTE_DIR && PORT=$PORT docker compose pull" \
  || ssh "$HOST" "sleep 15 && cd $REMOTE_DIR && PORT=$PORT docker compose pull" \
  || ssh "$HOST" "sleep 30 && cd $REMOTE_DIR && PORT=$PORT docker compose pull"
ssh "$HOST" "cd $REMOTE_DIR && PORT=$PORT docker compose up -d --remove-orphans"

echo "==> [6/6] 健康检查 (最多 60s)"
ok=""
for i in $(seq 1 30); do
  if ssh "$HOST" "curl -sf http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ -z "$ok" ]; then
  echo "✗ 服务未就绪,查看日志: ssh $HOST 'cd $REMOTE_DIR && docker compose logs --tail 50'"
  exit 1
fi

echo "==> 数据校验:"
ssh "$HOST" "curl -sf http://127.0.0.1:$PORT/api/books" | bun -e "
const d = await new Response(Bun.stdin.stream()).text();
const books = JSON.parse(d);
console.log('  书籍总数: ' + (Array.isArray(books) ? books.length : books.data?.length ?? '?'));
console.log('  标题: ' + (Array.isArray(books) ? books : books.data).map((b) => b.title).join(' / '));
"
SERVER_IP=$(ssh -G "$HOST" | awk '/^hostname /{print $2}')
echo "✓ 部署完成: http://$SERVER_IP:$PORT"