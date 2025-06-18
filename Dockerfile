FROM node:18-bullseye as builder

WORKDIR /app

# 复制依赖相关文件
COPY package*.json ./
COPY prisma ./prisma/

# 安装依赖
RUN npm ci

# 生成 Prisma 客户端（使用--no-engine标志避免需要数据库连接）
RUN npx prisma generate --no-engine

# 复制源代码
COPY . .

# 构建代码
RUN npm run build

# 生产阶段
FROM node:18-bullseye

WORKDIR /app

# 从构建阶段复制必要的文件
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# 设置环境变量
ENV NODE_ENV=production

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["npm", "start"]
