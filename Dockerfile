# syntax=docker/dockerfile:1
# ---- 折页阅读顺序校样 Web 应用镜像 ----
FROM node:20-alpine

WORKDIR /app

# 仅先拷贝依赖清单，利用层缓存安装依赖
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 拷贝应用代码
COPY server.js ./
COPY public ./public
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh \
  && mkdir -p /app/data

# 标签 / 备注 / 列表筛选：
#  - 方案与标签/备注持久化在命名卷 DATA_DIR（/app/data），容器重建不丢失；
#  - 写入走临时文件 + rename 原子替换，并发或失败时不会出现半截存档；
#  - 存档列表筛选（标签交集 / 名称关键词 / since）均为只读查询，不产生额外文件。
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

EXPOSE 3000

# 依赖准备与初始化（数据目录、自检）在容器启动时执行
ENTRYPOINT ["./entrypoint.sh"]
