import fs from "fs";
import path from "path";
import { PgVector } from "@mastra/pg";
import { MDocument } from "@mastra/rag";
import dotenv from "dotenv";
import OpenAI from "openai";
import yaml from "js-yaml";
import { getEmbedding } from "../lib/embedding";

// 加载环境变量
dotenv.config();

// 初始化OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

// 初始化向量数据库
const pgVector = new PgVector({
  connectionString: process.env.PG_DATABASE_URL || "",
});

// 默认配置
const defaultConfig = {
  chunkSize: 512,
  chunkOverlap: 50,
  chunkStrategy: "recursive",
  batchSize: 20,
  vectorDimension: 1536, // OpenAI text-embedding-3-small维度为1536
};

// 协议特定配置
const protocolConfigs: Record<string, Partial<typeof defaultConfig>> = {
  uniswap: { chunkSize: 600 },
  aave: { chunkSize: 500, chunkOverlap: 75 },
  compound: { chunkSize: 550 },
};

/**
 * 批量生成嵌入
 */
async function batchGenerateEmbeddings(
  texts: string[],
  config: typeof defaultConfig
): Promise<number[][]> {
  console.log(`为${texts.length}个文档块生成嵌入...`);

  const embeddings: number[][] = [];
  const batchSize = config.batchSize;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    console.log(
      `处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(
        texts.length / batchSize
      )}`
    );

    // OpenAI批处理，一次调用API获取多个嵌入
    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch.map((text) => text.replace(/\n/g, " ")),
      });

      // 提取所有返回的嵌入向量
      const batchEmbeddings = response.data.map((item) => item.embedding);
      embeddings.push(...batchEmbeddings);
    } catch (error) {
      console.error("批量生成嵌入失败:", error);

      // 如果批处理失败，退回到单个处理
      console.log("尝试单个处理...");
      const batchEmbeddings = await Promise.all(
        batch.map((text) => getEmbedding(text))
      );
      embeddings.push(...batchEmbeddings);
    }
  }

  return embeddings;
}

/**
 * 从Markdown文件提取前置元数据
 */
function extractFrontMatter(content: string): {
  metadata: Record<string, any>;
  content: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (match) {
    try {
      const frontMatter = yaml.load(match[1]) as Record<string, any>;
      const contentWithoutFrontMatter = content.slice(match[0].length);
      return { metadata: frontMatter, content: contentWithoutFrontMatter };
    } catch (e) {
      console.warn("解析YAML元数据失败");
    }
  }
  return { metadata: {}, content };
}

/**
 * 递归查找markdown文件
 */
function findMarkdownFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 处理单个文档文件
 */
async function processDocumentFile(
  filePath: string,
  protocolName: string,
  config: typeof defaultConfig
): Promise<any[]> {
  console.log(`处理文件: ${filePath}`);

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { metadata: frontMatter, content: cleanContent } =
      extractFrontMatter(content);

    // 使用文件路径创建分类
    const relativeFilePath = path.relative(
      path.join("docs", protocolName),
      filePath
    );
    const categories = relativeFilePath.split(path.sep).slice(0, -1);
    const fileName = path.basename(filePath, ".md");

    // 根据文件类型选择合适的MDocument方法
    let doc = MDocument.fromMarkdown(cleanContent, {
      metadata: {
        protocol: protocolName,
        source: relativeFilePath,
        title: frontMatter.title || fileName,
        categories: categories.length > 0 ? categories : ["general"],
        ...frontMatter,
      },
    });

    // 分块
    const chunks = await doc.chunk({
      strategy: config.chunkStrategy as any,
      size: config.chunkSize,
      overlap: config.chunkOverlap,
    });

    console.log(`文件 ${fileName} 生成了 ${chunks.length} 个文本块`);
    return chunks;
  } catch (error) {
    console.error(`处理文件 ${filePath} 时出错:`, error);
    return [];
  }
}

/**
 * 保存向量到数据库
 */
async function saveToVectorDatabase(
  chunks: any[],
  embeddings: number[][],
  protocolName: string,
  config: typeof defaultConfig
): Promise<void> {
  const indexName = `defi_${protocolName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")}`;

  try {
    // 检查索引是否存在
    try {
      const indexes = await pgVector.listIndexes();
      if (indexes.includes(indexName)) {
        console.log(`向量索引 ${indexName} 已存在`);
      } else {
        throw new Error("Index not found");
      }
    } catch (e) {
      // 创建新索引
      console.log(`创建向量索引 ${indexName}...`);
      await pgVector.createIndex({
        indexName,
        dimension: config.vectorDimension,
        metric: "cosine",
        indexConfig: {
          type: "hnsw",
          hnsw: {
            m: 16,
            efConstruction: 64,
          },
        },
      });
    }

    // 分批上传向量和元数据
    const batchSize = config.batchSize; // 复用已有的batchSize配置
    let totalUploadedCount = 0;

    for (let i = 0; i < embeddings.length; i += batchSize) {
      const embeddingBatch = embeddings.slice(i, i + batchSize);
      const chunkBatch = chunks.slice(i, i + batchSize);

      const metadataBatch = chunkBatch.map((chunk) => ({
        ...chunk.metadata,
        chunk_id: chunk.id,
        text:
          chunk.text.substring(0, 200) + (chunk.text.length > 200 ? "..." : ""),
      }));

      console.log(
        `上传批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          embeddings.length / batchSize
        )} 到索引 ${indexName} (数量: ${embeddingBatch.length})...`
      );

      await pgVector.upsert({
        indexName,
        vectors: embeddingBatch,
        metadata: metadataBatch,
      });
      totalUploadedCount += embeddingBatch.length;
    }

    console.log(
      `成功将 ${totalUploadedCount} 个向量分批保存到索引 ${indexName}`
    );
  } catch (error) {
    console.error(`保存向量到数据库失败:`, error);
  }
}

/**
 * 处理单个协议的所有文档
 */
async function processProtocol(protocolName: string): Promise<void> {
  console.log(`===== 开始处理协议: ${protocolName} =====`);

  // 合并默认配置和协议特定配置
  const config = {
    ...defaultConfig,
    ...(protocolConfigs[protocolName] || {}),
  };

  const protocolDir = path.join("docs", protocolName);
  if (!fs.existsSync(protocolDir)) {
    console.error(`协议目录不存在: ${protocolDir}`);
    return;
  }

  // 查找所有markdown文件
  const mdFiles = findMarkdownFiles(protocolDir);
  console.log(`发现 ${mdFiles.length} 个文档文件`);

  let allChunks: any[] = [];

  // 批量处理文件
  for (let i = 0; i < mdFiles.length; i += config.batchSize) {
    const batch = mdFiles.slice(i, i + config.batchSize);
    const batchResults = await Promise.all(
      batch.map((file) => processDocumentFile(file, protocolName, config))
    );
    allChunks = allChunks.concat(batchResults.flat());
  }

  // 提取所有块的文本
  const chunkTexts = allChunks.map((chunk) => chunk.text);

  // 批量生成嵌入
  const embeddings = await batchGenerateEmbeddings(chunkTexts, config);

  // 保存到向量数据库
  await saveToVectorDatabase(allChunks, embeddings, protocolName, config);

  console.log(`===== 协议 ${protocolName} 处理完成 =====`);
}

/**
 * 主函数：处理所有协议文档或指定协议
 */
async function main(specificProtocols?: string[]): Promise<void> {
  try {
    const docsDir = path.resolve("docs");

    if (!fs.existsSync(docsDir)) {
      console.error("docs目录不存在");
      return;
    }

    // 获取所有协议目录
    const entries = fs.readdirSync(docsDir, { withFileTypes: true });
    const protocolDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    // 确定要处理的协议
    const protocols = specificProtocols || protocolDirs;
    console.log(`将处理以下协议: ${protocols.join(", ")}`);

    // 按顺序处理每个协议
    for (const protocol of protocols) {
      await processProtocol(protocol);
    }

    console.log("所有协议处理完成!");
  } catch (error) {
    console.error("处理过程中出错:", error);
  } finally {
    // 关闭数据库连接
    await pgVector.disconnect();
  }
}

// 命令行处理
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    main(args).catch(console.error);
  } else {
    main().catch(console.error);
  }
}

export { main };
