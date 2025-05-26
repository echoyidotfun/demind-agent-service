import OpenAI from "openai";

// 初始化 OpenAI 客户端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 为文本生成向量嵌入
 * @param text 需要向量化的文本
 * @returns 向量数组
 */
export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002", // 或最新的嵌入模型
      input: text.replace(/\n/g, " "), // 替换换行符以优化嵌入质量
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("生成文本嵌入失败:", error);
    throw error;
  }
}

/**
 * 批量生成文本嵌入
 * @param texts 需要向量化的文本数组
 * @returns 向量数组的数组
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  // 由于 API 限制，我们按批次处理
  const batchSize = 100;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchEmbeddings = await Promise.all(
      batch.map((text) => getEmbedding(text))
    );
    embeddings.push(...batchEmbeddings);
  }

  return embeddings;
}
