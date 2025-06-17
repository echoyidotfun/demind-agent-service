const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5501;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // 处理跨域请求
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 处理 OPTIONS 请求
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // 设置文件路径
  let filePath = "." + req.url;
  if (filePath === "./") {
    filePath = "./streaming-test.html";
  }

  // 获取文件扩展名
  const extname = path.extname(filePath);
  let contentType = MIME_TYPES[extname] || "text/plain";

  // 读取文件
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        // 文件不存在
        fs.readFile("./404.html", (err, content) => {
          if (err) {
            res.writeHead(404);
            res.end("File not found");
          } else {
            res.writeHead(404, { "Content-Type": "text/html" });
            res.end(content, "utf-8");
          }
        });
      } else {
        // 服务器错误
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
        console.error(`Server Error: ${error.code}`);
      }
    } else {
      // 成功返回文件
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

server.listen(PORT, () => {
  console.log(`静态文件服务器运行在 http://localhost:${PORT}/`);
  console.log(`测试页面1: http://localhost:${PORT}/streaming-test.html`);
  console.log(
    `测试页面2: http://localhost:${PORT}/advanced-streaming-test.html`
  );
});
