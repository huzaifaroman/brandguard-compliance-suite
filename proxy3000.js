const http = require("http");

const server = http.createServer((req, res) => {
  const options = {
    hostname: "0.0.0.0",
    port: 5000,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxy.on("error", () => {
    res.writeHead(502);
    res.end("Backend not ready");
  });

  req.pipe(proxy, { end: true });
});

server.listen(3000, "0.0.0.0", () => {
  console.log("Proxy :3000 → :5000 ready");
});
