import { kv } from "@vercel/kv";

// 导出 Vercel KV 客户端实例
export const redis = kv;

export default redis;
